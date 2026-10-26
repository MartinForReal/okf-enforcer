import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiController, type ApiHost } from "../api-service";
import { collectVault, summarizeScan } from "../scan";
import { DEFAULT_SETTINGS } from "../validator";
import { snapshotSettings } from "../validation";

const content = '---\n{"type":"Concept"}\n---\n# Concept\n';
const now = new Date("2026-10-26T00:00:00Z");
function harness() {
  const settings = { ...snapshotSettings(DEFAULT_SETTINGS), warnMissingFields: [], reportIndexGaps: false };
  const host: ApiHost = { configDir: ".obsidian", files: () => [{ path: "note.md", read: async () => content }],
    folders: () => [], settings: () => settings, activity: () => ({ busy: false, revision: 0 }) };
  const controller = new ApiController(host, "0.6.1", () => now); controller.publish();
  return { settings, host, controller };
}

test("one captured pipeline yields identical active and vault findings, separating extension errors", async () => {
  const h = harness();
  h.controller.api!.registerValidator({ id: "example/owner", name: "Owner checks", validate: () => [
    { rule: "owner", severity: "error", message: "Missing owner" },
  ] });
  const pass = h.controller.createPass();
  const active = await pass.evaluate("note.md", content);
  const vault = await collectVault(h.host, pass.settings, { pluginVersion: "0.6.1", now: pass.now, guard() {}, evaluateNote: pass.evaluate });
  assert.deepEqual(vault.files[0].issues, active.issues);
  assert.equal(active.conformance, "conformant");
  assert.equal(vault.conformance, "conformant");
  assert.equal(vault.extensions.complete, true);
  assert.equal(summarizeScan(vault).coreErrorFiles, 0);
  assert.equal(summarizeScan(vault).extensionErrorFiles, 1);
});

test("failed extension coverage stays separate from complete core read coverage", async () => {
  const h = harness();
  h.controller.api!.registerValidator({ id: "example/throws", name: "Broken checks", validate() { throw new Error("offline"); } });
  const report = await h.controller.scanVault();
  assert.equal(report.status, "complete"); assert.equal(report.conformance, "conformant");
  assert.equal(report.extensions.complete, false); assert.equal(report.extensions.failed, 1);
  assert.equal(report.files[0].diagnostics[0].source, "example/throws");
});

test("a captured pass becomes stale after registration changes without using new callbacks", async () => {
  const h = harness(); let second = 0;
  h.controller.api!.registerValidator({ id: "example/first", name: "First", validate: () => [] });
  const pass = h.controller.createPass();
  h.controller.api!.registerValidator({ id: "example/second", name: "Second", validate: () => { second++; return []; } });
  const result = await pass.evaluate("note.md", content);
  assert.equal(pass.isCurrent(), false); assert.equal(second, 0);
  assert.equal(result.extensions.assessments.length, 1);
});

test("a pass captures settings/time and cancellation aborts in-flight extension work", async () => {
  const h = harness(); const abort = new AbortController(); let signal!: AbortSignal;
  let entered!: () => void; const start = new Promise<void>((resolve) => { entered = resolve; });
  h.controller.api!.registerValidator({ id: "example/slow", name: "Slow", validate: (context) => {
    signal = context.signal; entered(); return new Promise(() => {});
  } });
  const pass = h.controller.createPass(abort.signal); h.settings.checkAttestedComputation = false;
  const pending = pass.evaluate("note.md", content); await start; abort.abort();
  const result = await pending;
  assert.equal(signal.aborted, true); assert.equal(result.extensions.complete, false);
  assert.equal(result.checkCoverage, "full"); assert.equal(result.evaluatedAt, "2026-10-26T00:00:00.000Z");
});
