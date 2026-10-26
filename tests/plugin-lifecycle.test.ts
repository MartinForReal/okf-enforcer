import assert from "node:assert/strict";
import { test } from "node:test";
import { TFile, TFolder } from "obsidian";
import OkfPlugin from "../main";
import { VALIDATORS_READY, VALIDATORS_STOPPING } from "../api";
const sleep = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function deferred() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; }
const clean = '---\n{"type":"Concept"}\n---\n';
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
