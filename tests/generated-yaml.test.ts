import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "yaml";
import { applyFixes, DEFAULT_SETTINGS, splitFrontmatter, type FixKind } from "../validator";

const actor = 'human:Ops, "East" \\ QA: #1\nsecond line';
const settings = { ...DEFAULT_SETTINGS, defaultActor: actor };
const block = /^generated:\r?\n  by: [^\r\n]+\r?\n  at: [^\r\n]+$/m;
const issue = (fix: FixKind) => ({ severity: "warning" as const, rule: "§5.2", message: "", fix });

test("generated YAML in new frontmatter round-trips without changing the note body", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 2, 11, 6, 12) });
  const body = "    indented Markdown code\r\n\r\n# More\r\n";
  const { content } = applyFixes("Notes/Draft #1.md", body, [issue("add-frontmatter")], settings);
  const parts = splitFrontmatter(content);
  assert.deepEqual(parse(parts.raw, { customTags: ["timestamp"] }), {
    type: "Concept", title: "Draft #1", generated: { by: actor, at: "2026-10-02T11:06:12Z" },
  });
  assert.match(parts.raw, block);
  assert.equal(parts.body, "\r\n\r\n" + body);
});

test("missing generated YAML is appended without editing existing frontmatter or body", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 2, 11, 6, 12) });
  const before = '---\r\ntype: Concept # keep\r\nother: { tags: [one, two] }\nexample: |-\r\n  generated: just text';
  const after = '\r\n---\r\n\r\n    generated: body text  \r\n';
  const { content, applied } = applyFixes("Note.md", before + after, [issue("add-generated")], settings);
  assert.deepEqual(applied, ["added generated"]);
  const raw = splitFrontmatter(content).raw;
  assert.deepEqual(parse(raw, { customTags: ["timestamp"] }).generated, {
    by: actor, at: "2026-10-02T11:06:12Z",
  });
  assert.match(raw, block);
  assert.equal(content.replace(block, ""), before + "\r\n" + after);
  assert.deepEqual(applyFixes("Note.md", content, [issue("add-generated")], settings), { content, applied: [] });
});

test("generated YAML keeps Unicode actor text without raw control or line separators", () => {
  const by = "human:Renée\u0085東京\u2028ops";
  const { content } = applyFixes("Note.md", "", [issue("add-frontmatter")], { ...settings, defaultActor: by });
  const { raw } = splitFrontmatter(content);
  assert.equal(parse(raw).generated.by, by);
  assert.doesNotMatch(raw, /[\u0085\u2028]/);
});

for (const [form, scalar, expected] of [
  ["plain", "2026-10-02T12:06:12.123456+01:00 # imported", "2026-10-02T12:06:12.123456+01:00"],
  ["double-quoted", '"2026-10-02T12:06:12\\u002b01:00" # imported', "2026-10-02T12:06:12+01:00"],
  ["single-quoted", "'a ''quoted'' value: # kept' # imported", "a 'quoted' value: # kept"],
  ["block", ">- # imported\r\n    2026-10-02T12:06:12-05:30", "2026-10-02T12:06:12-05:30"],
  ["continued string", '"not a date\r\n    # still data" # imported', "not a date # still data"],
  ["anchored", "&clock 2026-10-02T12:06:12+01:00 # imported", "2026-10-02T12:06:12+01:00"],
  ["next-line", "# imported\r\n    2026-10-02T12:06:12-05:30", "2026-10-02T12:06:12-05:30"],
  ["next-line literal", "# imported\r\n    |-\r\n      time\r\n      # not a comment", "time\n# not a comment"],
  ["folded plain", "2026-10-02\r\n    12:06:12-05:30 # imported", "2026-10-02 12:06:12-05:30"],
]) {
  test(`migrated generated YAML retains the ${form} legacy timestamp in place`, () => {
    const before = "---\r\n  type: Concept\r\n  example: |-\r\n    timestamp: not a key\r\n";
    const after = '  other: { x: "keep" } # tail\n---\n\n# Note\n';
    const source = before + `  timestamp: ${scalar}\r\n` + after;
    const { content, applied } = applyFixes("Note.md", source, [issue("migrate-timestamp")], settings, true);
    assert.deepEqual(applied, ["migrated timestamp → generated"]);
    const raw = splitFrontmatter(content).raw;
    const data = parse(raw, { customTags: ["timestamp"] });
    assert.deepEqual(data.generated, { by: actor, at: expected });
    assert.equal("timestamp" in data, false);
    assert.match(raw, /^  generated:\r\n    by: [^\r\n]+\r\n    at: [^\r\n]+/m);
    assert.ok(content.startsWith(before) && content.endsWith(after));
    assert.ok(raw.includes(" # imported"));
  });
}

test("existing flow-style generated YAML is left byte-for-byte alone", () => {
  const note = '---\r\ntype: Concept\n"generated": { by: human:editor, at: "2001-02-03T04:05:06Z" } # mine\r\ntimestamp: old\n---\r\n  body\n';
  const result = applyFixes("Note.md", note, [issue("add-generated"), issue("migrate-timestamp")], settings, true);
  assert.deepEqual(result, { content: note, applied: [] });
  assert.deepEqual(parse(splitFrontmatter(result.content).raw).generated, {
    by: "human:editor", at: "2001-02-03T04:05:06Z",
  });
});

test("legacy generated YAML migration remains opt-in at the fixer boundary", () => {
  const note = "---\ntype: Concept\ntimestamp: '2026-10-02T12:06:12+01:00'\n---\n";
  assert.deepEqual(applyFixes("Note.md", note, [issue("migrate-timestamp")], settings), { content: note, applied: [] });
});

test("a flow-style frontmatter document is not mixed with block generated YAML", () => {
  const note = '---\n# Whole document is a flow mapping\n{ type: Concept, generated: { by: human:A, at: "2001-02-03T04:05:06Z" } }\n---\nBody\n';
  assert.deepEqual(applyFixes("Note.md", note, [issue("add-generated")], settings), { content: note, applied: [] });
});
