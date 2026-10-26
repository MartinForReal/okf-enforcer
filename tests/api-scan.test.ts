import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiController, type ApiHost } from "../api-service";
import { collectVault, toPublicVaultReport, scanResults, summarizeScan, type ScanFile, type ScanFolder } from "../scan";
import { DEFAULT_SETTINGS, type OkfSettings } from "../validator";
import { snapshotSettings } from "../validation";

const NOW = new Date("2026-10-26T00:00:00Z");
const note = (data = { type: "Concept" }) => `---\n${JSON.stringify(data)}\n---\n`;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function file(path: string, content: string | (() => Promise<string>) = note()): ScanFile {
  return { path, read: typeof content === "string" ? async () => content : content };
}
function harness(files: ScanFile[] = [file("clean.md")], folders: ScanFolder[] = []) {
  const settings: OkfSettings = { ...snapshotSettings(DEFAULT_SETTINGS), warnMissingFields: [], batchSize: 1 };
  const activity = { busy: false, revision: 0 };
  const host: ApiHost = { configDir: ".obsidian", settings: () => settings,
    activity: () => activity, files: () => files, folders: () => folders };
  const controller = new ApiController(host, "0.6.1", () => new Date(NOW));
  controller.publish();
  // Exercise the internal engine here; public registration is covered separately.
  return { host, settings, activity, controller, api: controller };
}

test("a complete read-only scan accounts for clean and invalid notes", async () => {
  const h = harness([file("clean.md"), file("bad.md", "No frontmatter")]);
  const result = await h.api.scanVault();
  assert.equal(result.status, "complete");
  assert.equal(result.conformance, "non-conformant");
  assert.deepEqual(result.counts.files, { candidates: 2, validated: 2, unreadable: 0, unprocessed: 0 });
  assert.equal(result.files.find((f) => f.path === "clean.md")!.diagnostics.length, 0);
  assert.equal(result.files.find((f) => f.path === "bad.md")!.diagnostics[0].severity, "error");
});

test("configured exclusions and a custom config directory are not scanned", async () => {
  const refuse = async () => { throw new Error("excluded file was read"); };
  const h = harness([file("keep.md"), file("Templates/a.md", refuse), file("_config/private.md", refuse)]);
  h.host.configDir = "_config";
  const result = await h.api.scanVault();
  assert.deepEqual(result.files.map((f) => f.path), ["keep.md"]);
  assert.deepEqual(result.scope, { kind: "configured-vault", configDir: "_config", excludeFolders: ["Templates"] });
});

test("an unreadable note makes coverage partial rather than silently conformant", async () => {
  const h = harness([file("clean.md"), file("denied.md", async () => { throw new Error("read denied"); })]);
  const result = await h.api.scanVault();
  assert.equal(result.status, "partial");
  assert.equal(result.conformance, "unknown");
  assert.deepEqual(result.counts.files, { candidates: 2, validated: 1, unreadable: 1, unprocessed: 0 });
  assert.deepEqual(result.files.find((f) => f.path === "denied.md")!.error, { code: "read-failed", message: "read denied" });
});

test("invalid YAML is a validated diagnostic, not a read failure", async () => {
  const result = await harness([file("invalid.md", "---\ntype: [\n---\n")]).api.scanVault();
  assert.equal(result.status, "complete");
  assert.equal(result.files[0].status, "validated");
  assert.equal(result.files[0].diagnostics[0].severity, "error");
  assert.equal(result.counts.files.unreadable, 0);
});

test("missing indexes remain separate folder findings and preserve honest UI file counts", async () => {
  const h = harness([file("clean.md")], [{ path: "", check: async () => ({ path: "index.md", issues: [{ rule: "§8", severity: "warning", message: "Missing index" }] }) }]);
  h.settings.reportIndexGaps = true;
  const scan = await collectVault(h.host, snapshotSettings(h.settings), { pluginVersion: "0.6.1", now: NOW, guard() {} });
  const report = toPublicVaultReport(scan);
  assert.equal(report.counts.files.candidates, 1);
  assert.equal(report.counts.folders.validated, 1);
  assert.equal(report.folders[0].findingPath, "index.md");
  assert.equal(report.conformance, "conformant");
  assert.equal(scanResults(scan)[0].path, "index.md");
  const summary = summarizeScan(scan);
  assert.equal(summary.cleanFiles, 1);
  assert.equal(summary.warningFiles, 0);
  assert.equal(summary.folderFindings, 1);
});

test("failed folder checks make a scan partial without adding phantom files", async () => {
  const h = harness([file("clean.md")], [{ path: "sub", check: async () => { throw new Error("index unavailable"); } }]);
  h.settings.reportIndexGaps = true;
  const report = await h.api.scanVault();
  assert.equal(report.status, "partial");
  assert.equal(report.conformance, "unknown");
  assert.equal(report.counts.files.validated, 1);
  assert.equal(report.counts.folders.unreadable, 1);
});

test("an empty configured scope completes without inventing candidates", async () => {
  const report = await harness([]).api.scanVault();
  assert.equal(report.status, "complete");
  assert.equal(report.conformance, "conformant");
  assert.deepEqual(report.counts.files, { candidates: 0, validated: 0, unreadable: 0, unprocessed: 0 });
});

test("an already-aborted scan reads nothing and accounts for unprocessed candidates", async () => {
  const refuse = async () => { throw new Error("aborted scan performed a read"); };
  const h = harness([file("one.md", refuse), file("two.md", refuse)]);
  const abort = new AbortController(); abort.abort();
  const report = await h.api.scanVault({ signal: abort.signal });
  assert.equal(report.status, "cancelled");
  assert.equal(report.conformance, "unknown");
  assert.deepEqual(report.counts.files, { candidates: 2, validated: 0, unreadable: 0, unprocessed: 2 });
});

test("cancelling after one batch leaves remaining files explicitly unprocessed", async () => {
  const abort = new AbortController();
  const h = harness([file("a.md"), file("b.md"), file("c.md")]);
  const scan = await collectVault(h.host, snapshotSettings(h.settings), {
    pluginVersion: "0.6.1", now: NOW, signal: abort.signal, guard() {},
    onProgress(completed) { if (completed === 1) abort.abort(); },
  });
  assert.equal(scan.status, "cancelled");
  assert.deepEqual(scan.counts.files, { candidates: 3, validated: 1, unreadable: 0, unprocessed: 2 });
});

test("disabled error-capable checks yield unknown even after every file was read", async () => {
  const h = harness(); h.settings.checkAttestedComputation = false;
  const report = await h.api.scanVault();
  assert.equal(report.status, "complete");
  assert.equal(report.checkCoverage, "reduced");
  assert.equal(report.conformance, "unknown");
});

test("concurrent API scans reject busy without releasing the first scan's ownership", async () => {
  const entered = deferred(), hold = deferred();
  const h = harness([file("a.md", async () => { entered.resolve(); await hold.promise; return note(); })]);
  const first = h.api.scanVault(); await entered.promise;
  await assert.rejects(h.api.scanVault(), { code: "busy" });
  await assert.rejects(h.api.scanVault(), { code: "busy" });
  hold.resolve(); assert.equal((await first).status, "complete");
  assert.equal((await h.api.scanVault()).status, "complete");
});

test("host scan or mutation activity rejects busy before any file read", async () => {
  const h = harness([file("a.md", async () => { throw new Error("busy scan read a file"); })]);
  h.activity.busy = true;
  await assert.rejects(h.api.scanVault(), { code: "busy" });
});

test("an operation that starts and finishes between API awaits still invalidates the scan", async () => {
  const entered = deferred(), hold = deferred();
  const h = harness([file("a.md", async () => { entered.resolve(); await hold.promise; return note(); })]);
  const pending = h.api.scanVault(); await entered.promise;
  h.activity.revision++;
  const rejected = assert.rejects(pending, { code: "busy" });
  hold.resolve(); await rejected;
});

test("configuration changes during a read do not alter the captured check set or exclusions", async () => {
  const entered = deferred(), hold = deferred();
  const h = harness([file("Keep/a.md", async () => { entered.resolve(); await hold.promise; return note(); }), file("Keep/b.md")]);
  const pending = h.api.scanVault(); await entered.promise;
  h.settings.excludeFolders.push("Keep"); h.settings.warnMissingFields.push("title"); h.settings.checkAttestedComputation = false;
  hold.resolve(); const report = await pending;
  assert.equal(report.checkCoverage, "full");
  assert.deepEqual(report.scope.excludeFolders, ["Templates"]);
  assert.equal(report.files.length, 2);
  assert.equal(report.files.some((f) => f.diagnostics.length), false);
  (report.scope.excludeFolders as string[]).push("Other");
  assert.equal(h.settings.excludeFolders.includes("Other"), false);
});

test("facades are unavailable before publication and cannot be revived after disposal", async () => {
  const h = harness(); const controller = new ApiController(h.host, "0.6.1");
  assert.equal(controller.api, undefined); controller.dispose(); controller.publish();
  assert.equal(controller.api, undefined);
  const old = h.api; h.controller.dispose();
  assert.equal(h.controller.api, undefined);
  await assert.rejects(old.validateContent({ path: "x.md", content: note() }), { code: "unavailable" });
  await assert.rejects(old.scanVault(), { code: "unavailable" });
  const fresh = new ApiController(h.host, "0.6.1"); fresh.publish();
  assert.equal((await fresh.scanVault()).status, "complete");
  await assert.rejects(old.scanVault(), { code: "unavailable" });
});

test("unloading during a pending read rejects unavailable, not a partial success", async () => {
  const entered = deferred(), hold = deferred();
  const h = harness([file("a.md", async () => { entered.resolve(); await hold.promise; return note(); })]);
  const pending = h.api.scanVault(); await entered.promise; h.controller.dispose();
  const rejected = assert.rejects(pending, { code: "unavailable" }); hold.resolve(); await rejected;
});

test("an old public registration facade cannot register after host disposal", () => {
  const h = harness();
  const old = h.controller.api!;
  h.controller.dispose();
  const replacement = new ApiController(h.host, "0.6.1"); replacement.publish();
  assert.throws(() => old.registerValidator({ id: "example/rules", name: "Example", validate: () => [] }), { code: "unavailable" });
  assert.equal(replacement.validators.snapshot().entries.length, 0);
});

test("public results omit private fixes while the shared UI collector retains them", async () => {
  const h = harness([file("bad.md", "No YAML")]);
  const scan = await collectVault(h.host, snapshotSettings(h.settings), { pluginVersion: "0.6.1", now: NOW, guard() {} });
  assert.equal(scanResults(scan)[0].issues[0].fix, "add-frontmatter");
  const report = toPublicVaultReport(scan);
  assert.equal("fix" in report.files[0].diagnostics[0], false);
  (report.files[0].diagnostics as unknown[]).length = 0;
  assert.equal(scanResults(scan)[0].issues.length, 1);
});

test("malformed scan options reject with an operational code", async () => {
  const h = harness();
  for (const options of [null, [], { signal: {} }, { signal: { aborted: "yes" } }]) {
    await assert.rejects(h.api.scanVault(options as never), { code: "invalid-request" });
  }
});

test("enumeration failures cannot masquerade as an empty successful scope", async () => {
  const h = harness(); h.host.files = () => { throw new Error("vault not ready"); };
  await assert.rejects(h.api.scanVault(), { code: "unavailable" });
});
