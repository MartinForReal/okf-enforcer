import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "../validator";
import { validateProvidedContent } from "../validation";

const settings = { ...DEFAULT_SETTINGS, warnTrustFields: true, warnMissingFields: [] };
const context = { now: new Date("2026-07-01T09:00:00Z"), pluginVersion: "fixture" };
const supplied = (path: string, content: string) => validateProvidedContent({path, content}, settings, context);
const note = (fields: string, body = "") => `---\ntype: Metric\n${fields}\n---\n${body}`;

test("reserved files, dot paths and optional shapes stay distinct from concepts", () => {
  for (const name of ["log.md", "nested/log.md", "nested/index.md"]) {
    assert.equal(supplied(name, note("title: Hi")).conformance, "non-conformant");
  }
  for (const name of [".private.md", "notes/.backup/index.md"]) {
    assert.throws(() => supplied(name, "text"), {code:"invalid-request"});
  }
  assert.equal(supplied("Index.md", note("x-example: true")).conformance, "conformant");
  assert.deepEqual(supplied("log.md", "## 2026-11-01\n* Updated.\n\n```md\n## Example heading\n```\n").diagnostics, []);
  const shapes = supplied("m.md", note('verified: {by: human:Joe}\nsources: {title: no resource}\nstatus: future-status\nsuperseded_by: a.md\ntags: [one, 2]'));
  assert.equal(shapes.conformance, "conformant");
  for (const key of ["verified", "sources", "future-status", "superseded_by", "tags"]) assert.ok(shapes.diagnostics.some(d => d.message.includes(key)), key);
});

test("root metadata is optional; an unquoted known version gets quoting advice but no false rejection", () => {
  assert.deepEqual(supplied("index.md", '---\ntitle: Bundle\nlicense: MIT OR Apache-2.0\nx-bundle: {nested: [a, b]}\n---\n').diagnostics, []);
  const root = supplied("index.md", '---\nokf_version: 0.3\nlicense: {wrong: shape}\n---\n');
  assert.equal(root.conformance, "conformant");
  assert.match(root.diagnostics.map(d => d.message).join(), /quote/i);
  assert.match(root.diagnostics.map(d => d.message).join(), /license/);
});

test("§10 checks the actual first fenced block in the Computation section, not example headings", () => {
  const calc = (body: string, fields = "") => supplied("calc.md", `---\ntype: Attested Computation\nruntime: local\nparameters: {name: x, type: custom, x-local: ok}\n${fields}\n---\n${body}`);
  assert.deepEqual(calc("## Computation ##\n### Details\n~~~~sql\nselect 1\n~~~~").diagnostics, []);
  for (const body of ["## Computation\n## Different\n```sql\nselect 1\n```", "````md\n# Computation\n```sql\nselect 1\n```\n````"]) {
    assert.match(calc(body).diagnostics.map(d => d.message).join(), /not attestable/i);
  }
  assert.match(calc("# Computation\n```sql\nselect 1\n```", "computation: file.sql").diagnostics.map(d => d.message).join(), /takes precedence/i);
  const invalid = supplied("a.md", "---\ntype: Attested Computation\nparameters: {name: x}\n---\n");
  assert.equal(invalid.conformance, "conformant");
  assert.match(invalid.diagnostics.map(d => d.message).join(), /name and type/i);
});

test("published Acme Retail examples pass supplied-content validation as authored", () => {
  for (const name of ["index.md", "log.md", "metrics/gross-margin-legacy.md", "computations/gross-margin-period.md"]) {
    const content = readFileSync(path.resolve("tests/fixtures/acme_retail", name), "utf8");
    const report = supplied(name, content);
    assert.equal(report.conformance, "conformant", name);
    assert.deepEqual(report.diagnostics, [], name);
  }
});

test("§5 signals accept singleton and empty families, open actor schemes, and UTC dates", () => {
  const content = note(`generated: {by: acme:bot, at: 2026-07-01}
verified: {by: "team:Finance", at: 2026-07-01T09:00:00Z}
sources: {resource: all orders this year, author: org:Finance, last_modified: 2026-06-30, usage_window: {from: 2026-05-01, to: 2026-06-01}, x-local: true}
tags: "one,tag"
status: []
superseded_by: null
stale_after: ""`);
  assert.deepEqual(supplied("m.md", content).diagnostics, []);
  assert.deepEqual(supplied("m.md", note("verified: []\nsources: ''\ngenerated: null")).diagnostics, []);
});

test("freshness compares full instants, warns on impossible dates and missing offsets, not absent deadlines", () => {
  const warnings = (value: string) => supplied("m.md", note(`stale_after: ${value}`)).diagnostics.map(d => d.message);
  assert.deepEqual(warnings("2026-07-01T05:00:00.0001-04:00"), []);
  for (const value of ["2026-07-01T11:00:00+02:00", "2026-07-01"]) assert.match(warnings(value).join(), /due for review/);
  for (const value of ["2026-02-30", "2026-07-01T09:00:00", "2026-07-01garbage", "2026-07-01T24:00:00Z"]) assert.match(warnings(value).join(), /not fresh/i, value);
  assert.deepEqual(warnings("[]"), []);
});
