import assert from "node:assert/strict";
import { test } from "node:test";
import { TFile, TFolder } from "obsidian";
import OkfPlugin from "../main";
import { VALIDATORS_READY, VALIDATORS_STOPPING } from "../api";
const sleep = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function deferred() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; }
const clean = '---\n{"type":"Concept"}\n---\n';

test("active tooltip grants trust only to complete, current verifications", async () => {
  const h = setup(); h.plugin.onload(); h.ready(); await sleep(); h.plugin.settings.warnTrustFields = true;
  const file = h.app.workspace.getActiveFile();
  try {
    const check = async (fields: string, tier: string) => {
      h.app.vault.read = async () => `---\ntype: Metric\n${fields}\n---\n`;
      await h.plugin.validateActive(file, false);
      assert.ok(h.status.attrs["aria-label"].includes(`Trust tier: ${tier}`), h.status.attrs["aria-label"]);
    };
    await check('generated: {by: agent/v1, at: 2026-07-01T00:00:00.0002Z}\nverified:\n  - {by: human:A, at: 2026-07-01T00:00:00.0001Z}\n  - {by: team:B, at: 2026-07-01T02:00:00.0002+02:00}', 'machine-confirmed');
    await check('verified: {by: "human:A"}', 'unverified');
    await check('generated: {by: process:A, at: invalid}\nverified: {by: human:A, at: 2026-07-01}', 'unverified');
    await check('verified: {by: "human:A", at: !!timestamp 2026-07-01}', 'human-reviewed');
  } finally { h.plugin.onunload(); }
});
function setup() {
  (globalThis as any).window = globalThis;
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  const on = (name: string, cb: (...args: any[]) => void) => {
    if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(cb);
    return { off: () => listeners.get(name)!.delete(cb) };
  };
  const trigger = (name: string, ...args: any[]) => { [...(listeners.get(name) ?? [])].forEach((fn) => fn(...args)); };
  const layouts: (() => void)[] = []; let active = new (TFile as any)("one.md");
  const root = new (TFolder as any)(""); root.children = [active]; active.parent = root;
  const status = { text: "", attrs: {} as Record<string, string>, setText(text: string) { this.text = text; },
    getText() { return this.text; }, addClass() {}, removeClass() {}, onClickEvent() {},
    setAttribute(key: string, value: string) { this.attrs[key] = value; } };
  const app: any = { status, vault: { configDir: ".obsidian", on, read: async () => clean, cachedRead: async () => clean,
    getMarkdownFiles: () => [active], getRoot: () => root, getAbstractFileByPath: () => null },
    workspace: { on, trigger, onLayoutReady: (cb: () => void) => layouts.push(cb), getActiveFile: () => active,
      getLeavesOfType: () => [] }, metadataCache: { getFileCache: () => ({}) } };
  const plugin = new OkfPlugin(app, { id: "okf-enforcer", version: "0.6.1" } as any);
  app.vault.process = async (f: TFile, update: (s: string) => string) => {
    const before = await app.vault.read(f), after = update(before);
    if (before !== after) await app.vault.modify(f, after); return after;
  };
  // Explicitly disable all write/startup options in this fixture.
  plugin.loadData = async () => ({ scanOnStartup: false, autoGenerateIndex: false, reportIndexGaps: false, warnMissingFields: [] });
  return { plugin, app, status, trigger, ready: () => layouts.forEach((cb) => cb()),
    setActive: (file: TFile | null) => { active = file as TFile; trigger("file-open", file); } };
}

test("entry point publishes only after persisted settings and layout, revoking its facade on unload", async () => {
  const h = setup(), hold = deferred(); let ready = 0, stopping = 0;
  h.app.workspace.on(VALIDATORS_READY, () => ready++); h.app.workspace.on(VALIDATORS_STOPPING, () => stopping++);
  h.plugin.loadData = async () => { await hold.promise; return { scanOnStartup: false, autoGenerateIndex: false, reportIndexGaps: false }; };
  h.plugin.onload(); h.ready(); await sleep(); assert.equal(h.plugin.apiV1, undefined);
  hold.resolve(); await sleep(); const facade = h.plugin.apiV1!; assert.ok(facade); assert.equal(ready, 1);
  h.plugin.onunload(); assert.equal(h.plugin.apiV1, undefined); assert.equal(stopping, 1);
  assert.throws(() => facade.registerValidator({ id: "example/rules", name: "Example", validate: () => [] }), { code: "unavailable" });
});

test("root index refresh preserves authored frontmatter bytes, absent declarations and case-sensitive links", async () => {
  const h = setup(); h.plugin.onload(); h.ready(); await sleep();
  const root = h.app.vault.getRoot(), index = new (TFile as any)("index.md");
  const upper = new (TFile as any)("A.md"), lower = new (TFile as any)("a.md");
  upper.name = "A.md"; lower.name = "a.md"; root.children = [index, upper, lower];
  h.app.vault.getAbstractFileByPath = (name: string) => root.children.find((f: TFile) => f.path === name) ?? null;
  const prefix = '---\r\n# keep this exact\r\nokf_version: "0.2"\r\nx-my-data:\r\n  ids: [01, A]\r\n---\r\n';
  let doc = prefix + '\r\n# Reading\r\n* [Upper](/A.md#intro)\r\n';
  h.app.vault.read = async () => doc; h.app.vault.modify = async (_: TFile, out: string) => {doc = out;};
  try {
    await h.plugin.generateIndexForFolder(root, false);
    assert.ok(doc.startsWith(prefix)); assert.match(doc, /\* \[Upper\]\(\/A\.md#intro\)/);
    assert.match(doc, /\]\(a\.md\)/); assert.doesNotMatch(doc, /\]\(A\.md\)/);
    h.plugin.settings.overwriteExistingIndex = true;
    await h.plugin.generateIndexForFolder(root, false); assert.ok(doc.startsWith(prefix), doc);
    doc = '# Handwritten\n'; await h.plugin.generateIndexForFolder(root, false); assert.doesNotMatch(doc, /okf_version/);
    for (const invalid of ['---\nokf_version: "0.2"\n---not closed\n', '---\nx: [\n---\n', '---\nokf_version: "9.9"\n---\n']) {
      doc = invalid; await h.plugin.generateIndexForFolder(root, false); assert.equal(doc, invalid);
    }
  } finally { h.plugin.onunload(); }
});

test("legacy-field migration is explicit, preserves unrelated text and cannot upgrade another file", async () => {
  const h = setup(), file = h.app.workspace.getActiveFile(), idx = new (TFile as any)("index.md");
  let index = '---\nokf_version: "0.2"\n---\n', writes = 0;
  const raw = '---\r\ntype: Metric\r\nx-config:\r\n  timestamp: keep\r\ntimestamp: "2024-01-02" # date from author\r\n---\r\n\r\n# Citations\r\n- https://example.test/a#one\r\n\r\n# Notes\r\nLeave this.\r\n\r\n\r\n';
  let doc = raw;
  h.app.vault.getAbstractFileByPath = (p: string) => p === "index.md" ? idx : null;
  h.app.vault.read = async (f: TFile) => f === idx ? index : doc;
  h.app.vault.modify = async (f: TFile, out: string) => {assert.equal(f, file); doc = out; writes++;};
  h.plugin.loadData = async () => ({autoMigrateOnFix: true, warnMissingFields: [], scanOnStartup: false, autoGenerateIndex: false});
  h.plugin.onload(); h.ready(); await sleep();
  try {
    await h.plugin.validateActive(file, false); await h.plugin.scanVault(false, true); await h.plugin.fixFile(file, false);
    assert.equal(doc, raw); assert.equal(writes, 0);
    await h.plugin.migrateActive(file);
    assert.match(doc, /x-config:\r\n  timestamp: keep\r\n/);
    assert.match(doc, /generated:.*2024-01-02.*# date from author/); assert.match(doc, /sources:/);
    assert.ok(doc.endsWith('# Notes\r\nLeave this.\r\n\r\n\r\n'));
    assert.equal(index, '---\nokf_version: "0.2"\n---\n');
    const done = doc; await h.plugin.migrateActive(file); assert.equal(doc, done); assert.equal(writes, 1);
    doc = raw; index = '---\nokf_version: "9.0"\n---\n';
    await h.plugin.migrateActive(file); await h.plugin.fixFile(file, false); assert.equal(doc, raw);
    await h.plugin.validateActive(file, false); assert.match(h.status.attrs["aria-label"], /unknown/i);
  } finally { h.plugin.onunload(); }
});

test("neither fixes nor migrations convert non-concepts or rewrite fenced examples and mixed citation prose", async () => {
  const h = setup(), file = h.app.workspace.getActiveFile(); let doc = "", writes = 0;
  h.app.vault.read = async () => doc; h.app.vault.modify = async () => {writes++;};
  h.plugin.onload(); h.ready(); await sleep();
  try {
    for (const value of ["# README", "---\ntitle: README\n---\n", "---\ntype: [\n---\n", "---\ntype: Topic\n---\n# Citations\n- x\nKeep my prose.\n", "---\ntype: Topic\n---\n````md\n```sql\n# Citations\n- x\n# Keep\n````\n"]) {
      doc = value; await h.plugin.fixFile(file, false); await h.plugin.migrateActive(file);
      assert.equal(writes, 0, value);
    }
  } finally { h.plugin.onunload(); }
});

test("new indexes declare 0.3 only for new bundles and never enter dot directories", async () => {
  const h = setup(), root = h.app.vault.getRoot(), hidden = new (TFolder as any)("docs/.hidden");
  const made: string[] = []; h.app.vault.create = async (p: string, s: string) => {assert.equal(p, "index.md"); made.push(s);};
  h.plugin.onload(); h.ready(); await sleep();
  try {
    root.children = []; await h.plugin.generateIndexForFolder(root, false); assert.match(made[0], /okf_version: "0.3"/);
    root.children = [new (TFile as any)("log.md"), hidden]; await h.plugin.generateIndexForFolder(root, false);
    assert.doesNotMatch(made[1], /okf_version|hidden/);
    assert.equal(await h.plugin.generateIndexForFolder(hidden, false), false); assert.equal(made.length, 2);
  } finally { h.plugin.onunload(); }
});

test("explicit legacy type entry preserves the author's extension YAML and original body", async () => {
  const h = setup(), file = h.app.workspace.getActiveFile(), root = new (TFile as any)("index.md");
  const custom = '# Editor comment\r\nx-custom: {number: "01", nested: [yes, no]}\r\ntitle: Author';
  let doc = `---\r\n${custom}\r\n---\r\n\r\n# Text\r\n`;
  h.app.vault.getAbstractFileByPath = (p: string) => p === "index.md" ? root : null;
  h.app.vault.read = async (f: TFile) => f === root ? '---\nokf_version: "0.2"\n---\n' : doc;
  h.app.vault.modify = async (_: TFile, out: string) => {doc = out;}; h.plugin.onload(); h.ready(); await sleep();
  try {
    await h.plugin.setFrontmatterFields(file, {type: 'Topic', title:'Do not overwrite the author'});
    assert.equal(doc, `---\r\n${custom}\r\ntype: "Topic"\r\n---\r\n\r\n# Text\r\n`);
  } finally {h.plugin.onunload();}
});

test("late or failed settings cannot publish a default-backed API", async () => {
  const late = setup(), hold = deferred(); late.plugin.loadData = async () => { await hold.promise; return null; };
  late.plugin.onload(); late.plugin.onunload(); late.ready(); hold.resolve(); await sleep();
  assert.equal(late.plugin.apiV1, undefined);
  const failed = setup(); failed.plugin.loadData = async () => { throw new Error("settings denied"); };
  failed.plugin.onload(); failed.ready(); await sleep(); assert.equal(failed.plugin.apiV1, undefined); failed.plugin.onunload();
});

test("slow validation of an old tab is aborted and cannot overwrite the new active note", async () => {
  const h = setup(); h.plugin.onload(); h.ready(); await sleep();
  let signal!: AbortSignal; const entered = deferred(), hold = deferred();
  h.plugin.apiV1!.registerValidator({ id: "example/slow", name: "Slow", validate: async (context) => {
    if (context.path !== "one.md") return [];
    signal = context.signal; entered.resolve(); await hold.promise;
    return [{ rule: "old", message: "Old note finding", severity: "error" }];
  } });
  const pending = h.plugin.validateActive(h.app.workspace.getActiveFile(), false); await entered.promise;
  h.setActive(new (TFile as any)("two.md")); await sleep(); hold.resolve(); await pending; await sleep();
  assert.equal(signal.aborted, true);
  assert.equal((h.plugin as any).activeResult.path, "two.md");
  assert.equal((h.plugin as any).activeResult.issues.length, 0); h.plugin.onunload();
});

test("registration changes invalidate cached findings and refresh without opening a view or writing", async () => {
  const h = setup(); h.plugin.onload(); h.ready(); await sleep();
  let writes = 0; h.app.vault.modify = async () => { writes++; };
  h.app.workspace.getRightLeaf = () => { throw new Error("refresh stole focus"); };
  const remove = h.plugin.apiV1!.registerValidator({ id: "example/rules", name: "Example", validate: () => [
    { rule: "rule", message: "Extension", severity: "error" },
  ] });
  await sleep(90); assert.equal((h.plugin as any).activeResult.issues[0].providerId, "example/rules");
  assert.match(h.status.text, /OKF ✓/); assert.match(h.status.text, /Ext ✖ 1/);
  remove(); assert.equal((h.plugin as any).activeResult, null); await sleep(90);
  assert.equal((h.plugin as any).activeResult.issues.length, 0); assert.equal(writes, 0); h.plugin.onunload();
});

test("registry changes during a vault pass discard it and coalesce a current read-only rescan", async () => {
  const h = setup(); h.plugin.onload(); h.ready(); await sleep(60);
  const entered = deferred(); let signal!: AbortSignal;
  const remove = h.plugin.apiV1!.registerValidator({ id: "example/pending", name: "Pending", validate: (context) => {
    signal = context.signal; entered.resolve(); return new Promise(() => {});
  } });
  const running = h.plugin.scanVault(false, true); await entered.promise; remove(); await running;
  assert.equal(signal.aborted, true); await sleep(110);
  const report = (h.plugin as any).pendingResults;
  assert.ok(report?.summary); assert.equal(report.summary.extensions.evaluated, 0);
  assert.equal(report.results.some((r: any) => r.issues.some((i: any) => i.providerId)), false);
  h.plugin.onunload();
});

test("save-time validation and post-fix validation retain unresolved extension findings", async () => {
  const h = setup(); let text = clean;
  h.app.vault.read = async () => text;
  h.app.vault.modify = async (_file: TFile, value: string) => { text = value; };
  h.plugin.onload(); h.ready(); await sleep();
  h.plugin.settings.liveCheckOnSave = true;
  h.plugin.apiV1!.registerValidator({ id: "example/owner", name: "Owner", validate: () => [
    { rule: "owner", severity: "error", message: "Owner required" },
  ] });
  const file = h.app.workspace.getActiveFile(); h.trigger("modify", file); await sleep(570);
  assert.equal((h.plugin as any).activeResult.issues.filter((i: any) => i.providerId).length, 1);
  await h.plugin.fixFile(file, false);
  assert.equal((h.plugin as any).activeResult.issues.filter((i: any) => i.providerId).length, 1);
  assert.equal((h.plugin as any).activeResult.conformance, "conformant");
  h.plugin.onunload();
});

test("a queued refresh cannot cancel equivalent explicit validation or lose reveal intent", async () => {
  const h = setup(); h.plugin.onload(); h.ready(); await sleep(60);
  let opened = 0, calls = 0;
  h.plugin.activateView = async () => { opened++; };
  h.plugin.apiV1!.registerValidator({ id: "example/slow", name: "Slow", validate: async () => {
    calls++; await sleep(120); return [{ rule: "owner", message: "Missing owner", severity: "error" }];
  } });
  await h.plugin.validateActive(h.app.workspace.getActiveFile(), true);
  assert.equal((h.plugin as any).activeResult?.issues[0].providerId, "example/slow");
  assert.equal(opened, 1); assert.equal(calls, 1);
  h.plugin.onunload();
});
