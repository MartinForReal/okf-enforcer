import assert from "node:assert/strict";
import { test } from "node:test";
import { attachValidator, getOkfApi, VALIDATORS_READY, VALIDATORS_STOPPING, type ValidationProvider } from "../api";
import { ExtensionRegistry } from "../extensions";
import { conformanceFor } from "../validation";
import type { OkfIssue } from "../validator";

const NOW = new Date("2026-10-26T00:00:00Z");
const CONTENT = '---\n{"type":"Concept","nested":{"owner":"original"}}\n---\n\n# Body\n';
const finding = (message = "Missing owner") => ({ rule: "owner", severity: "error" as const, message });
const provider = (id = "fixture/owner", validate: ValidationProvider["validate"] = () => [finding()]): ValidationProvider => ({ id, name: "Fixture checks", validate });
const run = (registry: ExtensionRegistry, core: OkfIssue[] = [], content = CONTENT, path = "notes/a.md") =>
  registry.validate(path, content, core, NOW, registry.snapshot());
function deferred() { let resolve!: (value?: any) => void; const promise = new Promise<any>((done) => { resolve = done; }); return { promise, resolve }; }

test("registered validators add attributed findings without changing core conformance", async () => {
  const registry = new ExtensionRegistry(); registry.register(provider());
  const result = await run(registry);
  assert.equal(result.issues[0].providerId, "fixture/owner");
  assert.equal(result.issues[0].providerName, "Fixture checks");
  assert.equal(result.issues[0].severity, "error");
  assert.equal(conformanceFor(result.issues, "full"), "conformant");
  assert.equal(result.assessments[0].status, "findings");
});

test("duplicate IDs reject; stale idempotent disposers cannot remove replacements", async () => {
  const registry = new ExtensionRegistry(), remove = registry.register(provider());
  assert.throws(() => registry.register(provider()), { code: "duplicate-provider" });
  remove(); const replacement = registry.register(provider("fixture/owner", () => [finding("Replacement")]));
  remove(); remove(); assert.equal((await run(registry)).issues[0].message, "Replacement");
  replacement(); assert.equal((await run(registry)).issues.length, 0);
});

test("stateful provider methods retain their original receiver", async () => {
  const registry = new ExtensionRegistry();
  const stateful = { id: "fixture/stateful", name: "Stateful", rules: ["owner", "reviewer"],
    validate() { return this.rules.map((rule) => ({ rule, message: `Missing ${rule}`, severity: "error" as const })); } };
  registry.register(stateful);
  const result = await run(registry);
  assert.equal(result.complete, true);
  assert.deepEqual(result.issues.map((i) => i.rule), ["owner", "reviewer"]);
});

test("sparse diagnostic arrays fail explicitly instead of claiming complete coverage", async () => {
  const registry = new ExtensionRegistry(); registry.register(provider("fixture/sparse", () => new Array(1)));
  const result = await run(registry);
  assert.equal(result.complete, false);
  assert.equal(result.assessments[0].reason, "invalid-result");
  assert.equal(result.issues[0].providerFailure, true);
});

test("invalid/reserved registrations never overwrite core namespaces", () => {
  const registry = new ExtensionRegistry();
  for (const bad of [null, {}, provider(""), provider("has space"), provider("okf"), provider("okf/core"), provider("okf-enforcer/fake"), { ...provider(), name: "" }, { ...provider(), validate: false }]) {
    assert.throws(() => registry.register(bad as never), { code: "invalid-provider" });
  }
});

test("context contains parsed data/body/kind/time and copied core diagnostics, never fixes", async () => {
  const registry = new ExtensionRegistry();
  registry.register(provider("fixture/context", (context) => {
    assert.equal(context.kind, "concept"); assert.equal(context.path, "notes/a.md");
    assert.equal(context.frontmatterState, "valid"); assert.equal(context.frontmatter?.type, "Concept");
    assert.equal(context.body.includes("# Body"), true); assert.equal(context.evaluatedAt, "2026-10-26T00:00:00.000Z");
    assert.equal(context.coreDiagnostics.length, 1); assert.equal("fix" in context.coreDiagnostics[0], false);
    return [finding("Context checked")];
  }));
  const result = await run(registry, [{ severity: "error", rule: "§11", message: "Core", fix: "add-type" }]);
  assert.equal(result.issues[0].message, "Context checked");
});

test("provider cannot change its own frozen context or another provider's context", async () => {
  const registry = new ExtensionRegistry();
  registry.register(provider("fixture/mutator", (context) => {
    Reflect.set(context.frontmatter!.nested as object, "owner", "changed");
    return [finding(String((context.frontmatter!.nested as any).owner))];
  }));
  registry.register(provider("fixture/observer", (context) => [finding(String((context.frontmatter!.nested as any).owner))]));
  const result = await run(registry);
  assert.equal(result.issues.find((p) => p.providerId === "fixture/mutator")!.message, "original");
  assert.equal(result.issues.find((p) => p.providerId === "fixture/observer")!.message, "original");
});

for (const [content, path, state, kind] of [
  ["# Body only", "a.md", "missing", "concept"],
  ["---\ntype: [\n---\n# Body", "a.md", "invalid", "concept"],
  ["# Index\n", "nested/index.md", "missing", "index"],
  ["# Log\n", "log.md", "missing", "log"],
]) {
  test(`body checks can inspect ${state} frontmatter in ${kind}`, async () => {
    const registry = new ExtensionRegistry(); registry.register(provider("fixture/body", (context) => [finding(`${context.frontmatterState}/${context.kind}`)]));
    assert.equal((await run(registry, [], content, path)).issues[0].message, `${state}/${kind}`);
  });
}

test("a throwing validator does not stop another validator or erase core findings", async () => {
  const registry = new ExtensionRegistry();
  registry.register(provider("fixture/broken", () => { throw new Error("Broken rule"); }));
  registry.register(provider("fixture/good", async () => [finding("Good rule ran")]));
  const core: OkfIssue[] = [{ severity: "error", rule: "§11", message: "Core still present" }];
  const result = await run(registry, core);
  assert.equal(result.assessments.find((p) => p.id === "fixture/broken")!.status, "failed");
  assert.equal(result.issues.some((p) => p.providerId === "fixture/good"), true);
  assert.equal(core[0].message, "Core still present");
});

test("invalid callback output is an attributed failed assessment, not a clean pass", async () => {
  const registry = new ExtensionRegistry(); registry.register(provider("fixture/invalid", (() => ({ message: "not an array" })) as never));
  const result = await run(registry);
  assert.equal(result.assessments[0].status, "failed");
  assert.equal(result.issues[0].providerId, "fixture/invalid");
  assert.equal(result.issues[0].severity, "warning");
});

test("extra core-fix/attribution fields are stripped from extension results", async () => {
  const registry = new ExtensionRegistry();
  registry.register(provider("fixture/spoof", () => [{ ...finding(), rule: "§11", fix: "add-type", providerId: "okf" } as any]));
  const result = await run(registry);
  assert.equal(result.issues[0].fix, undefined); assert.equal(result.issues[0].providerId, "fixture/spoof");
  assert.equal(conformanceFor(result.issues, "full"), "conformant");
});

test("an asynchronous deadline aborts the provider and reports incomplete extension checks", async () => {
  const registry = new ExtensionRegistry(undefined, 15); let signal: AbortSignal | undefined;
  registry.register(provider("fixture/slow", (context) => { signal = context.signal; return new Promise(() => {}); }));
  const result = await run(registry);
  assert.equal(result.assessments[0].status, "failed"); assert.equal(result.assessments[0].reason, "timeout");
  assert.equal(signal!.aborted, true); assert.equal(result.issues[0].providerId, "fixture/slow");
});

test("disposing during a callback aborts it and ignores its eventual findings", async () => {
  const registry = new ExtensionRegistry(); const entered = deferred(), hold = deferred(); let signal: AbortSignal;
  const remove = registry.register(provider("fixture/late", async (context) => { signal = context.signal; entered.resolve(); await hold.promise; return [finding("Too late")]; }));
  const pending = run(registry); await entered.promise; remove(); const result = await pending;
  hold.resolve(); await Promise.resolve(); assert.equal(signal!.aborted, true);
  assert.equal(result.issues.length, 0); assert.equal(result.assessments[0].status, "cancelled");
  assert.equal((await run(registry)).assessments.length, 0);
});

test("caller cancellation aborts callbacks without turning cancellation into a successful pass", async () => {
  const registry = new ExtensionRegistry(); const entered = deferred(), abort = new AbortController();
  registry.register(provider("fixture/cancel", async () => { entered.resolve(); return new Promise(() => {}); }));
  const pending = registry.validate("a.md", CONTENT, [], NOW, registry.snapshot(), abort.signal);
  await entered.promise; abort.abort(); const result = await pending;
  assert.equal(result.assessments[0].status, "cancelled"); assert.equal(result.issues.length, 0);
});

test("a pass snapshots registrations and advertises its original revision", async () => {
  const registry = new ExtensionRegistry(); const entered = deferred(), hold = deferred();
  registry.register(provider("fixture/first", async () => { entered.resolve(); await hold.promise; return []; }));
  const snapshot = registry.snapshot(), pending = registry.validate("a.md", CONTENT, [], NOW, snapshot);
  await entered.promise; registry.register(provider("fixture/second")); hold.resolve();
  const result = await pending; assert.equal(result.revision, snapshot.revision);
  assert.deepEqual(result.assessments.map((p) => p.id), ["fixture/first"]);
  assert.equal((await run(registry)).assessments.length, 2);
});

test("host registry disposal rejects new registrations and aborts pending work", async () => {
  const registry = new ExtensionRegistry(); const entered = deferred();
  registry.register(provider("fixture/pending", async () => { entered.resolve(); return new Promise(() => {}); }));
  const pending = run(registry); await entered.promise; registry.dispose();
  assert.equal((await pending).assessments[0].status, "cancelled");
  assert.throws(() => registry.register(provider()), { code: "unavailable" });
});

class Events {
  listeners = new Set<{ name: string; callback: () => void }>();
  on(name: string, callback: () => void) { const ref = { name, callback }; this.listeners.add(ref); return ref; }
  offref(ref: any) { this.listeners.delete(ref); }
  trigger(name: string) { for (const ref of [...this.listeners]) if (ref.name === name) ref.callback(); }
}
function attachment() {
  const workspace = new Events(), cleanups: (() => void)[] = [];
  const owner = { register(cleanup: () => void) { cleanups.push(cleanup); } };
  const slot: { apiV1?: any } = {};
  const app = { workspace, plugins: { plugins: { "okf-enforcer": slot } } };
  const publish = (registry: ExtensionRegistry) => { slot.apiV1 = { apiVersion: 1, pluginVersion: "0.6.1", okfVersion: "0.2", registerValidator: registry.register.bind(registry) }; workspace.trigger(VALIDATORS_READY); };
  return { app, slot, workspace, owner, cleanups, publish };
}

test("attach handles companion-first load order and duplicate readiness without duplicate callbacks", async () => {
  const h = attachment(), registry = new ExtensionRegistry(); attachValidator(h.app, h.owner, provider());
  assert.equal((await run(registry)).issues.length, 0); h.publish(registry); h.workspace.trigger(VALIDATORS_READY);
  assert.equal((await run(registry)).issues.length, 1); assert.equal(typeof getOkfApi(h.app)!.registerValidator, "function");
});

test("attachment follows host restart and owner unload removes registration and listeners", async () => {
  const h = attachment(), first = new ExtensionRegistry(); h.publish(first);
  attachValidator(h.app, h.owner, provider()); assert.equal((await run(first)).issues.length, 1);
  first.dispose(); h.slot.apiV1 = undefined; h.workspace.trigger(VALIDATORS_STOPPING);
  const second = new ExtensionRegistry(); h.publish(second); assert.equal((await run(second)).issues.length, 1);
  h.cleanups.forEach((dispose) => dispose()); assert.equal(h.workspace.listeners.size, 0);
  assert.equal((await run(second)).issues.length, 0); h.workspace.trigger(VALIDATORS_READY);
  assert.equal((await run(second)).issues.length, 0);
});
