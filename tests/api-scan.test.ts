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

test("a declared v0.2 scan keeps its legacy structural rules; v0.3 skips untyped Markdown", async () => {
  const h = harness([file("index.md", '---\nokf_version: "0.2"\n---'), file("clean.md"), file("bad.md", "No frontmatter")]);
  const result = await h.api.scanVault();
  assert.equal(result.status, "complete");
  assert.equal(result.conformance, "non-conformant");
  assert.deepEqual(result.counts.files, { candidates: 3, validated: 3, unreadable: 0, unprocessed: 0 });
  assert.equal(result.files.find((f) => f.path === "clean.md")!.diagnostics.length, 0);
  assert.equal(result.files.find((f) => f.path === "bad.md")!.diagnostics[0].severity, "error");
  const v03 = harness([file("index.md", '---\nokf_version: "0.3"\nlicense: MIT\nx-local: { nested: true }\n---'), file("README.md", "No frontmatter")]);
  assert.equal((await v03.controller.scanVault()).conformance, "conformant");
  assert.equal((await v03.controller.createPass().evaluate("README.md", "No frontmatter")).issues[0].severity, "warning");
});

test("a malformed root is a structural failure; note-level version coverage is unknown consistently", async () => {
  const h = harness([file("index.md", "---\nokf_version: [\n---\n"), file("ok.md")]);
  const report = await h.controller.scanVault();
  assert.equal(report.conformance, "non-conformant");
  assert.equal((await h.controller.createPass().evaluate("ok.md", note())).conformance, "unknown");
  assert.ok(report.files.find(f => f.path === "ok.md")!.diagnostics.some(i => i.message.includes("Cannot determine")));
});

test("unknown bundle versions receive best-effort diagnostics, never a positive verdict", async () => {
  for (const declaration of ['"1.0"', '0.30', '[0.3]']) {
    const index = `---\nokf_version: ${declaration}\n---\n`;
    const h = harness([file("index.md", index), file("ok.md")]);
    assert.equal((await h.controller.validateContent({path:"index.md", content:index})).conformance, "unknown", declaration);
    const pass = h.controller.createPass();
    assert.equal((await pass.evaluate("ok.md", note())).conformance, "unknown");
    assert.equal((await h.controller.scanVault()).conformance, "unknown");
    assert.equal(h.controller.api!.okfVersion, "0.3");
  }
});

test("historic Acme type: Log is compatible with declared v0.2, ambiguous without a version, invalid in v0.3", async () => {
  const log = '---\ntype: Log\ntitle: Acme Retail bundle history\n---\n\n## 2026-07-01\n* Verified.\n';
  for (const [v, verdict] of [["0.2", "conformant"], ["", "unknown"], ["0.3", "non-conformant"]]) {
    const h = harness([file("index.md", v ? `---\nokf_version: "${v}"\n---` : '# Subdirectories'), file("log.md", log)]);
    assert.equal((await h.controller.scanVault()).conformance, verdict, v);
    assert.equal((await h.controller.createPass().evaluate("log.md", log)).conformance, verdict, v);
  }
});

test("configured exclusions and a custom config directory are not scanned", async () => {
  const refuse = async () => { throw new Error("excluded file was read"); };
  const h = harness([file("keep.md"), file("Templates/a.md", refuse), file("_config/private.md", refuse)]);
  h.host.configDir = "_config";
  const result = await h.api.scanVault();
  assert.deepEqual(result.files.map((f) => f.path), ["keep.md"]);
  assert.deepEqual(result.scope, { kind: "configured-vault", configDir: "_config", excludeFolders: ["Templates"] });
});

test("the shared scan filters folder segments, never the file's own name", async () => {
  const refuse = async () => { throw new Error("out-of-scope content was read"); };
  const h = harness([
    file("assets/a.md", refuse), file("docs/assets/deep/a.md", refuse), file("docs/private/a.md", refuse),
    file(".hidden.md", refuse), file("docs/.cache/a.md", refuse), file("docs/notes.txt", refuse),
    file("docs/FAQ.md/a.md", refuse), file("FAQ.md"), file("notes/Keep.md"), file("other/docs/private/a.md"),
  ], [
    { path: "docs/assets", check: refuse }, { path: "docs/assets/deep", check: refuse },
    { path: "docs/private", check: refuse }, { path: "docs/FAQ.md", check: refuse },
    { path: "docs/.cache", check: refuse },
    { path: "docs/assets-old", check: async () => null }, { path: "other/docs/private", check: async () => null },
  ]);
  h.settings.excludeFolders = ["assets", "docs/private", "FAQ.md", "notes/Keep.md"];
  h.settings.reportIndexGaps = true;
  const scan = await h.api.scanVault();
  assert.equal(scan.status, "complete");
  assert.deepEqual(scan.files.map((f) => f.path), ["FAQ.md", "notes/Keep.md", "other/docs/private/a.md"]);
  assert.deepEqual(scan.folders.map((f) => f.path), ["docs/assets-old", "other/docs/private"]);
});

test("active and vault reference checks skip excluded target subtrees without flagging them as broken", async () => {
  const path = "notes/visible.md";
  const content = '---\ntype: Topic\nresource: /docs/assets/private.png\n---\n[hidden](/_config/secret.md) [kept](/notes/assets)\n';
  const h = harness([file(path, content)]); h.settings.excludeFolders = ["assets"]; h.host.configDir = "_config";
  const lookedUp: string[] = []; h.host.hasPath = target => { lookedUp.push(target); return target === "notes/assets"; };
  assert.deepEqual((await h.controller.createPass().evaluate(path, content)).issues, []);
  assert.deepEqual((await h.controller.scanVault()).files[0].diagnostics, []);
  assert.deepEqual(lookedUp, ["notes/assets", "notes/assets"]);
});

test("links and computation paths use case-sensitive bundle inventory without fetching targets", async () => {
  const body = "[sibling](../assets/My%20SQL.sql#read) [root][r] [external](../../outside)\n\n[r]: /assets/My%20SQL.sql\n";
  const path = "notes/calc.md";
  const calc = (target: string) => `---\ntype: Attested Computation\nruntime: sql\ncomputation: '${target}'\n---\n${body}`;
  for (const version of ["0.3", "0.2", undefined]) {
    const h = harness([...(version ? [file("index.md", `---\nokf_version: '${version}'\n---`)] : []), file(path, calc("assets/My%20SQL.sql"))]);
    const lookups: string[] = [];
    h.host.hasPath = p => { lookups.push(p); return p === "assets/My SQL.sql"; };
    const messages = (await h.controller.scanVault()).files.find(f => f.path === path)!.diagnostics.map(d => d.message);
    if (version === "0.3") assert.match(messages.join(), /computation.*not found/i);
    else assert.match(messages.join(), /legacy root fallback/i);
    for (const target of ["/assets/My%20SQL.sql", "../assets/My%20SQL.sql"]) {
      assert.deepEqual((await h.controller.createPass().evaluate(path, calc(target))).issues, []);
    }
    assert.match((await h.controller.createPass().evaluate(path, calc("../assets/my%20sql.sql"))).issues.map(i => i.message).join(), /not found/i);
    const links = await h.controller.createPass().evaluate(path, note() + '[gone][lost]\n\n[lost]: /assets/gone.md\n');
    assert.match(links.issues.map(i => i.message).join(), /gone\.md/); assert.equal(links.conformance, "conformant");
    for (const external of ["https://example.test/x", "file:///outside", "%2e%2e/%2e%2e/outside", "//outside/x", "../.private/x", "..%5coutside", "bad%00outside", "bad%1foutside"]) {
      await h.controller.createPass().evaluate(path, calc(external));
    }
    assert.ok(lookups.includes("assets/My SQL.sql"));
    assert.ok(!lookups.some(p => /outside|\.private/.test(p)), JSON.stringify(lookups));
    assert.equal((await h.controller.validateContent({path, content: calc("unknown.sql")})).diagnostics.length, 0);
  }
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

test("optional computation advice is independent of structural scan coverage", async () => {
  const h = harness(); h.settings.checkAttestedComputation = false;
  const report = await h.api.scanVault();
  assert.equal(report.status, "complete");
  assert.equal(report.checkCoverage, "full");
  assert.equal(report.conformance, "conformant");
  assert.equal(report.enabledChecks.checkAttestedComputation, false);
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
  const h = harness([file("titled.md")]); h.settings.warnMissingFields = ["title"];
  const scan = await collectVault(h.host, snapshotSettings(h.settings), { pluginVersion: "0.6.1", now: NOW, guard() {} });
  assert.equal(scanResults(scan)[0].issues[0].fix, "add-title");
  const report = toPublicVaultReport(scan);
  assert.equal("fix" in report.files[0].diagnostics[0], false);
  (report.files[0].diagnostics as unknown[]).length = 0;
  assert.equal(scanResults(scan)[0].issues.length, 1);
});

test("public scan metadata is deeply independent of the collected scan", async () => {
  const h = harness();
  h.settings.warnMissingFields = ["title"];
  h.settings.checkAttestedComputation = false;
  const scan = await collectVault(h.host, snapshotSettings(h.settings), { pluginVersion: "0.6.1", now: NOW, guard() {} });
  const report = toPublicVaultReport(scan);
  Reflect.set(report.enabledChecks.warnMissingFields, 0, "changed");
  Reflect.set(report.disabledErrorChecks, 0, "changed");
  Reflect.set(report.enabledChecks.portent.types, 0, "changed");
  Reflect.set(report.enabledChecks.portent.statuses, 0, "changed");
  Reflect.set(report.enabledChecks.portent.checks, 0, "changed");
  Reflect.set(report.enabledChecks.portent.fields, "status", "changed");
  Reflect.set(report.scope.excludeFolders, 0, "changed");
  Reflect.set(report.counts.files, "validated", 99);
  Reflect.set(report.counts.folders, "validated", 99);
  Reflect.set(report.extensions, "complete", false);
  assert.deepEqual(scan.enabledChecks.warnMissingFields, ["title"]);
  assert.deepEqual(scan.disabledErrorChecks, []);
  assert.equal(scan.enabledChecks.portent.types[0], "Project");
  assert.equal(scan.enabledChecks.portent.statuses[0], "captured");
  assert.equal(scan.enabledChecks.portent.checks[0], "type");
  assert.equal(scan.enabledChecks.portent.fields.status, "status");
  assert.deepEqual(scan.scope.excludeFolders, ["Templates"]);
  assert.equal(scan.counts.files.validated, 1);
  assert.equal(scan.counts.folders.validated, 0);
  assert.equal(scan.extensions.complete, true);
});

test("scan summary counts do not alias the collected outcomes", async () => {
  const h = harness();
  const scan = await collectVault(h.host, snapshotSettings(h.settings), { pluginVersion: "0.6.1", now: NOW, guard() {} });
  const summary = summarizeScan(scan);
  Reflect.set(summary.counts.files, "validated", 99);
  Reflect.set(summary.counts.folders, "validated", 99);
  assert.deepEqual(scan.counts.files, { candidates: 1, validated: 1, unreadable: 0, unprocessed: 0 });
  assert.deepEqual(scan.counts.folders, { candidates: 0, validated: 0, unreadable: 0, unprocessed: 0 });
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
