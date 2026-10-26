import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ExtensionRegistry } from "../extensions";
import { collectVault, type ScanHost } from "../scan";
import { snapshotSettings } from "../validation";
import { DEFAULT_SETTINGS } from "../validator";

const NOW = new Date("2026-10-26T00:00:00Z");
const CONTENT = '---\n{"type":"Concept"}\n---\n';

/** A separate timer realm: its numeric handles are not Node's timer handles. */
function timerWindow(t: TestContext, onFire = () => {}) {
  const previous = globalThis.window;
  const pending = new Map<number, ReturnType<typeof setTimeout>>();
  let next = 0;
  const realm = {
    setTimeout(callback: () => void, delay: number): number {
      const id = ++next;
      pending.set(id, setTimeout(() => {
        pending.delete(id);
        onFire();
        callback();
      }, delay));
      return id;
    },
    clearTimeout(id: number): void {
      const timer = pending.get(id);
      if (timer !== undefined) clearTimeout(timer);
      pending.delete(id);
    },
  };
  globalThis.window = realm as unknown as Window & typeof globalThis;
  t.after(() => {
    for (const timer of pending.values()) clearTimeout(timer);
    globalThis.window = previous;
  });
  return { pending, scheduled: () => next };
}

test("validator deadlines use the owning window's timer realm", async (t) => {
  const registry = new ExtensionRegistry(undefined, 15);
  t.after(() => registry.dispose());
  const timers = timerWindow(t);
  let signal: AbortSignal | undefined;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  registry.register({ id: "fixture/window-deadline", name: "Window deadline", validate(context) {
    signal = context.signal;
    entered();
    return new Promise(() => {});
  } });
  const pending = registry.validate("note.md", CONTENT, [], NOW);
  await started;
  assert.equal(timers.pending.size, 1, "the deadline must belong to the window, not the Node/global timer realm");
  const result = await pending;
  assert.equal(result.assessments[0].reason, "timeout");
  assert.equal(signal!.aborted, true);
  assert.equal(timers.pending.size, 0);
});

test("successful validation clears its deadline in the same window realm", async (t) => {
  const registry = new ExtensionRegistry();
  t.after(() => registry.dispose());
  const timers = timerWindow(t);
  registry.register({ id: "fixture/window-success", name: "Window success", validate: () => [] });
  const result = await registry.validate("note.md", CONTENT, [], NOW);
  assert.equal(result.complete, true);
  assert.equal(timers.scheduled(), 1);
  assert.equal(timers.pending.size, 0, "a completed provider must not leave a window-owned deadline running");
});

test("cancelling validation clears the window-owned deadline and aborts the provider", async (t) => {
  const registry = new ExtensionRegistry();
  t.after(() => registry.dispose());
  const timers = timerWindow(t);
  const abort = new AbortController();
  let signal: AbortSignal | undefined;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  registry.register({ id: "fixture/window-cancel", name: "Window cancel", validate(context) {
    signal = context.signal;
    entered();
    return new Promise(() => {});
  } });
  const pending = registry.validate("note.md", CONTENT, [], NOW, registry.snapshot(), abort.signal);
  await started;
  assert.equal(timers.pending.size, 1);
  abort.abort();
  const result = await pending;
  assert.equal(result.assessments[0].status, "cancelled");
  assert.equal(signal!.aborted, true);
  assert.equal(timers.pending.size, 0);
});

test("vault scans yield through the window between batches", async (t) => {
  let yielded = false;
  timerWindow(t, () => { yielded = true; });
  const host: ScanHost = { configDir: ".obsidian", folders: () => [], files: () => [
    { path: "a.md", read: async () => CONTENT },
    { path: "b.md", read: async () => {
      assert.equal(yielded, true, "the window must get a turn before the next batch");
      return CONTENT;
    } },
  ] };
  const settings = { ...snapshotSettings(DEFAULT_SETTINGS), batchSize: 1, warnMissingFields: [] };
  const result = await collectVault(host, settings, { pluginVersion: "0.6.1", now: NOW, guard() {} });
  assert.equal(result.status, "complete");
  assert.equal(result.counts.files.validated, 2);
  assert.equal(result.conformance, "conformant");
});
