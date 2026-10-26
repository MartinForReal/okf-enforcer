// Desktop-only companion for the marked disposable vault; never shipped in the host.
import { Plugin, Modal, TFile, apiVersion } from "obsidian";
import { attachValidator, getOkfApi, type ValidationContext } from "../../api";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function waitFor(read: () => unknown, label: string, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (read()) return; await sleep(20); }
  throw new Error(`Timed out waiting for ${label}`);
}

export default class E2EConsumer extends Plugin {
  lastReceipt: any = null;
  seen: ValidationContext[] = [];
  private running = false;

  onload() {
    attachValidator(this.app, this, { id: "fixture/owner", name: "Fixture validation", validate: (context) => {
      this.seen.push(context);
      if (context.kind !== "concept" || context.frontmatterState !== "valid" || context.frontmatter?.owner) return [];
      return [{ rule: "owner-required", message: "A concept needs an owner.", severity: "error" }];
    } });
    this.addCommand({ id: "run", name: "Run OKF API E2E", callback: () => { void this.run(); } });
  }

  async run() {
    if (this.running) return this.lastReceipt;
    this.running = true;
    const consumer = this;
    const config = await this.loadData();
    assert((this.app.vault.adapter as any).getBasePath() === config.vault, "Refusing a non-fixture vault");
    const manager = (this.app as any).plugins;
    const host = () => manager.plugins["okf-enforcer"] as any;
    const modal = new Modal(this.app); modal.open();
    modal.contentEl.createEl("h2", { text: "OKF extension E2E — running" });
    const results: any[] = [];
    const receipt: any = { startedAt: new Date().toISOString(), obsidianVersion: apiVersion,
      fixtureRoot: config.fixtureRoot, vault: config.vault, bundleSha256: config.bundleSha256,
      gitHead: config.gitHead, tests: results, status: "running" };
    this.lastReceipt = receipt;
    const test = async (name: string, action: () => Promise<void>, injection?: string) => {
      const start = Date.now();
      try { await action(); results.push({ name, status: "passed", durationMs: Date.now() - start, ...(injection ? { injection } : {}) }); }
      catch (error) { results.push({ name, status: "failed", error: String(error), durationMs: Date.now() - start, ...(injection ? { injection } : {}) }); }
    };
    const hashes = () => {
      const result: Record<string, string> = {};
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === ".obsidian") continue;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name.endsWith(".md")) result[relative(config.vault, full)] = createHash("sha256").update(readFileSync(full)).digest("hex");
        }
      };
      walk(config.vault); return JSON.stringify(result);
    };
    try {
      await test("registration API becomes ready in actual Obsidian", async () => {
        await waitFor(() => getOkfApi(this.app), "registration apiV1");
        receipt.pluginVersion = getOkfApi(this.app)!.pluginVersion;
      });
      if (results[0].status !== "passed") return finish();
      const clean = this.app.vault.getAbstractFileByPath("clean.md"); assert(clean instanceof TFile, "Missing clean fixture");
      await this.app.workspace.getLeaf(false).openFile(clean);
      const before = hashes();
      await test("companion-first registration appears in the active report", async () => {
        await host().validateActive(clean, true);
        const hit = host().activeResult;
        assert(hit?.issues.some((i: any) => i.providerId === "fixture/owner"), "Companion finding missing");
        assert(hit.conformance === "conformant", "Extension error changed core conformance");
        assert(host().statusEl.textContent.includes("OKF ✓") && host().statusEl.textContent.includes("Ext ✖ 1"), "Status merged core/extension errors");
        const view = this.app.workspace.getLeavesOfType("okf-report-view")[0]?.view as any;
        assert(view?.contentEl.textContent.includes("Fixture validation"), "Visible source label missing");
      });
      await test("real YAML context is copied/frozen, with reserved and invalid notes identified", async () => {
        await host().scanVault(false, true);
        const context = this.seen.find((c) => c.path === "clean.md")!;
        assert(context?.frontmatterState === "valid" && context.frontmatter?.type === "Concept", "YAML mapping missing");
        const policy = context.frontmatter?.policy as any;
        assert(policy.owners[0] === "human:fixture", "Nested YAML list missing");
        assert(Object.isFrozen(policy.owners) && !Reflect.set(policy.owners, "0", "tampered"), "Nested context is mutable");
        assert(this.seen.some((c) => c.path === "index.md" && c.kind === "index"), "Reserved index not identified");
        assert(this.seen.some((c) => c.path === "invalid-yaml.md" && c.frontmatterState === "invalid"), "Invalid YAML state lost");
        assert(this.seen.some((c) => c.path === "broken.md" && c.frontmatterState === "missing"), "Missing YAML state lost");
        assert(!this.seen.some((c) => c.path.startsWith("Excluded/") || c.path.startsWith(".obsidian/")), "Excluded/config note reached provider");
      });
      await test("full report agrees with active findings and preserves core errors", async () => {
        await host().scanVault(false, true);
        const p = host(), view = this.app.workspace.getLeavesOfType("okf-report-view")[0]?.view as any;
        const full = view.results.find((r: any) => r.path === "clean.md");
        assert(full.issues.filter((i: any) => i.providerId === "fixture/owner").length === 1, "Duplicate or missing full-scan finding");
        assert(p.activeResult.issues.filter((i: any) => i.providerId === "fixture/owner").length === 1, "Active/full disagree");
        assert(p.lastSummary.coreErrorFiles >= 3 && p.lastSummary.extensionErrorFiles >= 1, "Core/extension counts lost");
        assert(view.contentEl.textContent.includes("extension errors") && view.contentEl.textContent.includes("core errors"), "Separate summary labels missing");
      });
      await test("throws, invalid output and deadline do not stop other validators or fail core", async () => {
        const api = getOkfApi(this.app)!, cleanups: (() => void)[] = []; let slowSignal!: AbortSignal;
        try {
          cleanups.push(api.registerValidator({ id: "fixture/throws", name: "Throws", validate() { throw new Error("Injected provider exception"); } }));
          cleanups.push(api.registerValidator({ id: "fixture/invalid", name: "Invalid", validate: () => null as never }));
          cleanups.push(api.registerValidator({ id: "fixture/slow", name: "Slow", validate: (context) => { slowSignal = context.signal; return new Promise(() => {}); } }));
          cleanups.push(api.registerValidator({ id: "fixture/healthy", name: "Healthy", validate: () => [{ rule: "healthy", message: "Another provider ran", severity: "warning" }] }));
          let duplicate = false;
          try { api.registerValidator({ id: "fixture/healthy", name: "Duplicate", validate: () => [] }); }
          catch (error) { duplicate = (error as any).code === "duplicate-provider"; }
          assert(duplicate, "Duplicate provider replaced a registration");
          await host().validateActive(clean, false);
          const result = host().activeResult;
          assert(result.conformance === "conformant" && result.extensionsComplete === false, "Failure poisoned core or hid incomplete coverage");
          assert(result.issues.filter((i: any) => i.providerFailure).length === 3, "Missing attributed failures");
          assert(result.issues.some((i: any) => i.providerId === "fixture/healthy"), "Healthy validator did not run");
          assert(slowSignal.aborted, "Deadline did not abort provider");
        } finally { cleanups.forEach((fn) => fn()); }
      }, "throw, malformed array and unresolved Promise from three temporary validators");
      await test("host reload revokes old facade and reattaches companion without duplicates", async () => {
        for (let i = 0; i < 2; i++) {
          const old = getOkfApi(this.app)!;
          await manager.unloadPlugin("okf-enforcer");
          let revoked = false;
          try { old.registerValidator({ id: "fixture/stale", name: "Stale", validate: () => [] }); }
          catch (error) { revoked = (error as any).code === "unavailable"; }
          assert(revoked, "Old facade still registers");
          await manager.loadPlugin("okf-enforcer"); await waitFor(() => getOkfApi(this.app), "reloaded host");
          await host().validateActive(clean, false);
          assert(host().activeResult.issues.filter((issue: any) => issue.providerId === "fixture/owner").length === 1, "Reload lost or duplicated companion registration");
        }
      });
      await test("delayed settings and unload never publish an old initializer", async () => {
        await manager.unloadPlugin("okf-enforcer");
        const original = Plugin.prototype.loadData; let release!: () => void, entered = false;
        const hold = new Promise<void>((resolve) => { release = resolve; });
        Plugin.prototype.loadData = async function() { if (this.manifest.id === "okf-enforcer") { entered = true; await hold; } return original.call(this); };
        try {
          await manager.loadPlugin("okf-enforcer"); await waitFor(() => entered, "delayed settings");
          assert(!getOkfApi(this.app), "API published before settings");
          await manager.unloadPlugin("okf-enforcer"); release(); await sleep(60);
          assert(!getOkfApi(this.app), "Unloaded initializer published");
        } finally {
          release(); Plugin.prototype.loadData = original;
          await manager.unloadPlugin("okf-enforcer"); await manager.loadPlugin("okf-enforcer"); await waitFor(() => getOkfApi(this.app), "host recovery");
        }
      }, "gated Plugin.loadData for host only");
      await test("failed settings do not publish defaults", async () => {
        await manager.unloadPlugin("okf-enforcer"); const original = Plugin.prototype.loadData;
        Plugin.prototype.loadData = async function() { if (this.manifest.id === "okf-enforcer") throw new Error("Injected settings read failure"); return original.call(this); };
        try { await manager.loadPlugin("okf-enforcer"); await sleep(80); assert(!getOkfApi(this.app), "Failed settings published API"); }
        finally { Plugin.prototype.loadData = original; await manager.unloadPlugin("okf-enforcer"); await manager.loadPlugin("okf-enforcer"); await waitFor(() => getOkfApi(this.app), "host recovery"); }
      }, "rejected host Plugin.loadData");
      await test("read failure and reduced checks show incomplete core coverage", async () => {
        const original = this.app.vault.read;
        this.app.vault.read = async function(file) { if (file.path === "broken.md") throw new Error("Injected read denial"); return original.call(this, file); };
        try {
          host().settings.checkAttestedComputation = false;
          await host().scanVault(false, true);
          const view = this.app.workspace.getLeavesOfType("okf-report-view")[0]?.view as any;
          assert(host().lastSummary.conformance === "unknown" && host().lastSummary.counts.files.unreadable === 1, "Partial coverage hidden");
          assert(/incomplete/i.test(view.contentEl.textContent) && !view.contentEl.textContent.includes("All checked notes conform"), "Incomplete report claimed clean");
        } finally { this.app.vault.read = original; host().settings.checkAttestedComputation = true; }
      }, "one real vault.read rejection, Attested check disabled");
      await test("folder-gap validation reports but never generates an index", async () => {
        host().settings.reportIndexGaps = true;
        try { await host().scanVault(false, true); assert(!this.app.vault.getAbstractFileByPath("gap/index.md"), "Validation created an index"); }
        finally { host().settings.reportIndexGaps = false; }
      });
      await test("validation alone leaves Markdown unchanged", async () => { assert(hashes() === before, "Validation changed notes"); });
      // Intentional fixture mutations start here; not part of the no-write claim.
      await test("intentional save edit reruns the same extension policy", async () => {
        const original = await this.app.vault.read(clean); host().settings.liveCheckOnSave = true;
        try {
          await this.app.vault.modify(clean, original.replace("type: Concept", "type: Concept\nowner: human:fixture"));
          await waitFor(() => host().activeResult?.path === "clean.md" && !host().activeResult.issues.some((i: any) => i.providerId === "fixture/owner"), "save-triggered policy refresh");
        } finally { await this.app.vault.modify(clean, original); host().settings.liveCheckOnSave = false; await host().validateActive(clean, false); }
      }, "intentional clean.md owner edit, then exact restoration");
      await test("intentional core fix keeps unresolved extension findings", async () => {
        const fix = this.app.vault.getAbstractFileByPath("fix-me.md"); assert(fix instanceof TFile, "Missing fix fixture");
        await this.app.workspace.getLeaf(false).openFile(fix);
        assert(await host().fixFile(fix, false) > 0, "Core fix did not write fixture");
        assert(host().activeResult?.conformance === "conformant", "Core fix failed conformance");
        assert(host().activeResult.issues.some((i: any) => i.providerId === "fixture/owner" && !i.fix), "Post-fix policy disappeared or gained a fix");
      }, "explicit core fixer on fix-me.md");
      await test("intentional index command still writes a disposable missing index", async () => {
        const folder = this.app.vault.getAbstractFileByPath("gap");
        assert(await host().generateIndexForFolder(folder, false), "Index command did not generate fixture");
        assert(this.app.vault.getAbstractFileByPath("gap/index.md") instanceof TFile, "Generated index missing");
      }, "explicit index generation on gap/ after no-write assertion");
      await test("actual companion unload aborts pending callback and discards late results", async () => {
        await this.app.workspace.getLeaf(false).openFile(clean); let release!: () => void, signal: AbortSignal | undefined;
        const hold = new Promise<void>((resolve) => { release = resolve; });
        attachValidator(this.app, this, { id: "fixture/unload", name: "Unload check", validate: async (context) => {
          signal = context.signal; await hold; return [{ rule: "late", message: "Must never appear", severity: "error" }];
        } });
        const pending = host().validateActive(clean, false);
        try {
          await waitFor(() => signal, "pending companion callback");
          await manager.unloadPlugin(this.manifest.id); assert(signal?.aborted, "Companion unload did not abort callback");
          release(); await pending; await sleep(80);
          assert(!host().activeResult?.issues.some((i: any) => i.providerId === "fixture/unload"), "Late result was published");
        } finally { release(); await manager.loadPlugin(this.manifest.id); }
        await host().validateActive(clean, false);
        assert(host().activeResult.issues.filter((i: any) => i.providerId === "fixture/owner").length === 1, "Companion reload lost or duplicated registration");
      }, "real companion unload/reload while its callback is pending");
    } catch (error) { results.push({ name: "fixture setup", status: "failed", error: String(error) }); }
    return finish();

    function finish() {
      consumer.running = false;
      receipt.finishedAt = new Date().toISOString(); receipt.passed = results.filter((r) => r.status === "passed").length;
      receipt.failed = results.filter((r) => r.status === "failed").length; receipt.status = receipt.failed ? "failed" : "passed";
      modal.contentEl.empty(); modal.contentEl.createEl("h2", { text: `OKF extension E2E — ${receipt.status.toUpperCase()}` });
      modal.contentEl.createEl("p", { text: `${receipt.passed} passed / ${receipt.failed} failed · Obsidian ${apiVersion}` });
      const list = modal.contentEl.createEl("ul");
      for (const result of results) list.createEl("li", { text: `${result.status === "passed" ? "✓" : "✖"} ${result.name}${result.error ? ": " + result.error : ""}` });
      writeFileSync(join(config.evidenceDir, "receipt.json"), JSON.stringify(receipt, null, 2));
      writeFileSync(join(config.evidenceDir, `receipt-${Date.now()}.json`), JSON.stringify(receipt, null, 2));
      const current = manager.plugins[consumer.manifest.id]; if (current) current.lastReceipt = receipt;
      return receipt;
    }
  }
}
