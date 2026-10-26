import assert from "node:assert/strict";
import { test } from "node:test";
import { getOkfApi } from "../api";
import { DEFAULT_SETTINGS } from "../validator";
import { snapshotSettings, validateProvidedContent } from "../validation";

const context = { pluginVersion: "0.6.1", now: new Date("2026-10-26T00:00:00Z") };
const note = (data: Record<string, unknown>) => `---\n${JSON.stringify(data)}\n---\n\n# Note\n`;
const settings = () => ({ ...snapshotSettings(DEFAULT_SETTINGS), warnMissingFields: [] });

test("supplied unsaved content produces scoped core diagnostics, not fix instructions", () => {
  const report = validateProvidedContent({ path: "unsaved.md", content: "# No frontmatter" }, settings(), context);
  assert.deepEqual(report.scope, { kind: "content", path: "unsaved.md" });
  assert.equal(report.conformance, "non-conformant");
  assert.equal(report.diagnostics[0].source, "okf");
  assert.equal(report.diagnostics[0].severity, "error");
  assert.equal("fix" in report.diagnostics[0], false);
  assert.equal(report.apiVersion, 1);
  assert.equal(report.okfVersion, "0.2");
});

for (const path of ["", "/absolute.md", "C:/absolute.md", "../escape.md", "a/./b.md", "a/../b.md", "a\\b.md", "a//b.md", "note.txt", "a\u0000.md"]) {
  test(`reject invalid supplied path ${JSON.stringify(path)}`, () => {
    assert.throws(() => validateProvidedContent({ path, content: note({ type: "Concept" }) }, settings(), context), { code: "invalid-request" });
  });
}

test("invalid request values reject instead of coercing content", () => {
  for (const value of [null, [], {}, { path: "x.md", content: 7 }]) {
    assert.throws(() => validateProvidedContent(value as never, settings(), context), { code: "invalid-request" });
  }
});

test("explicit excluded content is checked rather than silently omitted", () => {
  const report = validateProvidedContent({ path: "Templates/unsaved.md", content: "bad" }, settings(), context);
  assert.equal(report.conformance, "non-conformant");
  assert.equal(report.diagnostics.length, 1);
});

test("reserved-file root behavior is derived from the supplied path", () => {
  const content = '---\n{"okf_version":"0.2"}\n---\n\n# Concepts\n\n* [One](one.md)\n';
  assert.equal(validateProvidedContent({ path: "index.md", content }, settings(), context).conformance, "conformant");
  assert.equal(validateProvidedContent({ path: "sub/index.md", content }, settings(), context).conformance, "non-conformant");
});

test("Portent warnings are identified separately and never fail core conformance", () => {
  const s = settings(); s.enablePortent = true;
  const report = validateProvidedContent({ path: "x.md", content: note({ type: "Custom" }) }, s, context);
  assert.equal(report.conformance, "conformant");
  assert.equal(report.diagnostics.some((d) => d.source === "portent" && d.severity === "warning"), true);
});

test("disabled error-capable check makes conformance unknown, not clean", () => {
  const s = settings(); s.checkAttestedComputation = false;
  const report = validateProvidedContent({ path: "x.md", content: note({ type: "Concept" }) }, s, context);
  assert.equal(report.checkCoverage, "reduced");
  assert.equal(report.conformance, "unknown");
  assert.deepEqual(report.disabledErrorChecks, ["checkAttestedComputation"]);
});

test("warning-only toggles do not reduce core coverage", () => {
  const report = validateProvidedContent({ path: "x.md", content: note({ type: "Concept" }) }, settings(), context);
  assert.equal(report.checkCoverage, "full");
  assert.equal(report.conformance, "conformant");
});

test("freshness uses the captured evaluation time instead of the wall clock", () => {
  const s = settings(); s.warnTrustFields = true;
  const input = { path: "x.md", content: note({ type: "Concept", stale_after: "2030-01-01" }) };
  const before = validateProvidedContent(input, s, context);
  const after = validateProvidedContent(input, s, { ...context, now: new Date("2031-01-01T00:00:00Z") });
  assert.equal(before.diagnostics.some((d) => d.message.includes("stale")), false);
  assert.equal(after.diagnostics.some((d) => d.message.includes("stale")), true);
  assert.equal(after.evaluatedAt, "2031-01-01T00:00:00.000Z");
});

test("configuration snapshots and report metadata do not expose live nested arrays", () => {
  const original = settings();
  const captured = snapshotSettings(original);
  original.portentTypes.push("Different");
  original.excludeFolders.push("Private");
  assert.equal(captured.portentTypes.includes("Different"), false);
  assert.equal(captured.excludeFolders.includes("Private"), false);
  const report = validateProvidedContent({ path: "x.md", content: note({ type: "Concept" }) }, captured, context);
  (report.enabledChecks.warnMissingFields as string[]).push("tags");
  assert.deepEqual(captured.warnMissingFields, []);
});

test("discovery returns only a shape-compatible v1 facade and tolerates unavailable internals", () => {
  const api = { apiVersion: 1, pluginVersion: "0.6.1", okfVersion: "0.2", validateContent: async () => ({}), scanVault: async () => ({}) };
  const app = { plugins: { plugins: { "okf-enforcer": { apiV1: api } } } };
  assert.equal(getOkfApi(app), api);
  for (const unavailable of [undefined, null, {}, { plugins: {} }, { plugins: { plugins: {} } }]) assert.equal(getOkfApi(unavailable), undefined);
  api.apiVersion = 2;
  assert.equal(getOkfApi(app), undefined);
  assert.equal(getOkfApi({ get plugins() { throw new Error("unsupported"); } }), undefined);
});
