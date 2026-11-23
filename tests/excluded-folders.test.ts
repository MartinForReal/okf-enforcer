import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { TFile, TFolder } from "obsidian";
import OkfPlugin from "../main";
import { VALIDATORS_READY } from "../api";

// An in-memory Obsidian boundary: the plugin creates and reads real listing text.
function startFixture(t: TestContext, excludeFolders = ["assets", "Templates"], settingsGate?: Promise<void>) {
  const nodes = new Map<string, TFolder | TFile>();
  const text = new Map<string, string>();
  const reads: string[] = [], writes: string[] = [];
  function folder(path: string): TFolder {
    const known = nodes.get(path);
    if (known instanceof TFolder) return known;
    const parts = path.split("/"), name = parts.pop()!;
    const parent = path === "/" ? null : folder(parts.join("/") || "/");
    const dir: TFolder = Object.assign(new (TFolder as any)(path), { name, parent });
    parent?.children.push(dir); nodes.set(path, dir);
    return dir;
  }
  function file(path: string, content: string): TFile {
    const parts = path.split("/"), name = parts.pop()!, parent = folder(parts.join("/") || "/");
    const dot = name.lastIndexOf(".");
    const note: TFile = Object.assign(new (TFile as any)(path), { name, parent,
      basename: dot === -1 ? name : name.slice(0, dot), extension: dot === -1 ? "" : name.slice(dot + 1) });
    parent.children.push(note); nodes.set(path, note); text.set(path, content);
    return note;
  }
  type VaultEvent = (node: TFile | TFolder, oldPath?: string) => void;
  const events = new Map<string, VaultEvent>();
  const on = (name: string, cb: VaultEvent) => { events.set(name, cb); return { off: () => events.delete(name) }; };
  const emit = (name: string, node: TFile | TFolder, oldPath?: string) => events.get(name)?.(node, oldPath);
  let ready!: () => void;
  const published = new Promise<void>((resolve) => { ready = resolve; });
  let active: TFile | null = null;
  const read = async (f: TFile) => { reads.push(f.path); return text.get(f.path)!; };
  const app = { vault: { on, configDir: ".obsidian", getRoot: () => folder("/"),
    getAbstractFileByPath: (path: string) => nodes.get(path || "/") ?? null,
    getMarkdownFiles: () => [...nodes.values()].filter((f) => f instanceof TFile && f.extension === "md"),
    read, cachedRead: read, create: async (path: string, value: string) => {
      assert.ok(!nodes.has(path), `File already exists: ${path}`); writes.push(path);
      const created = file(path, value); emit("create", created); return created;
    }, modify: async (f: TFile, value: string) => { writes.push(f.path); text.set(f.path, value); emit("modify", f); },
    process: async (f: TFile, update: (current: string) => string) => {
      const before = text.get(f.path)!, after = update(before);
      if (after !== before) { writes.push(f.path); text.set(f.path, after); emit("modify", f); }
      return after;
    } },
    workspace: { on: () => ({ off() {} }), onLayoutReady: (cb: () => void) => cb(), trigger: (name: string) => { if (name === VALIDATORS_READY) ready(); },
      getActiveFile: () => active, getLeavesOfType: () => [] }, metadataCache: { getFileCache: () => ({}) },
    fileManager: { processFrontMatter: async (f: TFile) => { writes.push(f.path); } },
    status: { setText() {}, getText: () => "", addClass() {}, removeClass() {}, setAttribute() {}, onClickEvent() {} } };
  const plugin = new OkfPlugin(app as any, { version: "0.6.1" } as any);
  plugin.loadData = async () => {
    await settingsGate;
    return { excludeFolders, scanOnStartup: false, generateIndexOnStartup: false, batchSize: 1 };
  };
  plugin.onload(); t.after(() => plugin.unload());
  return { plugin, folder, file, text, reads, writes, emit, published, setActive: (f: TFile) => { active = f; } };
}

async function fixture(t: TestContext, excludeFolders?: string[]) {
  const h = startFixture(t, excludeFolders); await h.published; return h;
}

test("batch generation does not create indexes in nested assets folders", async (t) => {
  const { plugin, folder, file, text } = await fixture(t);
  for (const path of ["assets/deep", "Templates", "docs/assets", "docs/onboarding-kit/assets/media",
    "docs/Templates/letters", "docs/myassets", "docs/assets-old", "manual/Assets"]) folder(path);
  file("docs/assets.md", "An ordinary note");
  file("docs/myassets/assets", "An extensionless attachment");
  await plugin.generateAllIndexes();
  assert.deepEqual([...text.keys()].filter((p) => p.endsWith("index.md")).sort(), [
    "docs/assets-old/index.md", "docs/index.md", "docs/myassets/index.md", "docs/onboarding-kit/index.md",
    "index.md", "manual/Assets/index.md", "manual/index.md",
  ]);
  assert.match(text.get("index.md")!, /\(docs\/index\.md\)/);
  for (const index of ["index.md", "docs/index.md", "docs/onboarding-kit/index.md"]) {
    assert.doesNotMatch(text.get(index)!, /\((?:assets|Templates)\/index\.md\)/);
  }
  assert.match(text.get("docs/index.md")!, /\(assets\.md\)/);
  assert.match(text.get("docs/myassets/index.md")!, /\(assets\)/);
});

test("a vault-relative exclusion prunes only that subtree during recursive generation", async (t) => {
  const { plugin, folder, text } = await fixture(t, ["docs/assets"]);
  for (const path of ["docs/assets/deep", "docs/assets-old", "other/docs/assets/deep", "assets"]) folder(path);
  await plugin.generateIndexForFolder(folder("/"));
  assert.deepEqual([...text.keys()].sort(), ["assets/index.md", "docs/assets-old/index.md", "docs/index.md",
    "index.md", "other/docs/assets/deep/index.md", "other/docs/assets/index.md", "other/docs/index.md", "other/index.md"]);
  assert.doesNotMatch(text.get("docs/index.md")!, /\(assets\/index\.md\)/);
  assert.match(text.get("other/docs/index.md")!, /\(assets\/index\.md\)/);
});

test("direct index generation inside an exclusion neither reads nor rebuilds an authored index", async (t) => {
  const { plugin, folder, file, text, reads, writes } = await fixture(t);
  const authored = "# Purpose\n\nKeep this handwritten index.\n";
  file("docs/assets/deep/index.md", authored);
  plugin.settings.overwriteExistingIndex = true;
  for (const path of ["assets", "docs/assets", "docs/assets/deep", ".obsidian/plugins"]) {
    assert.equal(await plugin.generateIndexForFolder(folder(path), false), false, path);
  }
  assert.deepEqual(reads, []); assert.deepEqual(writes, []);
  assert.equal(text.get("docs/assets/deep/index.md"), authored);
});

test("additive refresh drops excluded directory entries but preserves authored content", async (t) => {
  const { plugin, folder, file, text, reads, writes } = await fixture(t);
  const prose = "# Reading list\n\nSee [the diagram](assets/diagram.png).\n\n1. [[assets/index|My reference]]\n";
  file("docs/index.md", prose + "\n# Subdirectories\n\n* [Media](assets/index.md)\n* [Letters](Templates/)\n");
  const child = "# Purpose\n\nDo not copy this into a parent listing.\n";
  file("docs/assets/index.md", child); folder("docs/Templates");
  plugin.settings.indexSubdirDescSection = "Purpose";
  await plugin.generateIndexForFolder(folder("docs"));
  assert.equal(text.get("docs/index.md"), prose);
  assert.equal(text.get("docs/assets/index.md"), child);
  assert.deepEqual(reads, ["docs/index.md"]); assert.deepEqual(writes, ["docs/index.md"]);
  assert.equal(await plugin.generateIndexForFolder(folder("docs")), false, "a second refresh is a no-op");
});

test("automatic indexing ignores excluded events and refreshes the included side of a move", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { plugin, folder, file, text, reads, writes, emit } = await fixture(t);
  const tick = async (ms: number) => { t.mock.timers.tick(ms); await new Promise<void>((r) => setImmediate(r)); };
  plugin.settings.fixOnSave = true;
  const note = file("docs/assets/deep/moved.md", "Do not fix or index me");
  const dotNote = file("docs/.workspace.md", "Hidden note");
  emit("modify", dotNote); emit("delete", dotNote); emit("rename", dotNote, "docs/.old.md");
  emit("create", folder("docs/assets/deep")); emit("create", note); emit("modify", note);
  emit("delete", folder("docs/Templates")); emit("rename", folder("docs/assets"), "old/assets");
  await tick(500); await tick(1500);
  assert.deepEqual(reads, []); assert.deepEqual(writes, []);

  file("inbox/index.md", "# Untyped\n\n* [Moved](moved.md)\n");
  emit("rename", note, "inbox/moved.md"); // moved into the excluded tree
  await tick(1500);
  assert.equal(text.get("inbox/index.md"), "");
  emit("rename", file("inbox/arrived.md", "Now listed"), "docs/assets/arrived.md");
  await tick(1500);
  assert.match(text.get("inbox/index.md")!, /\(arrived\.md\)/);
  assert.doesNotMatch(text.get("docs/index.md")!, /\((?:assets|Templates)\/index\.md\)/);
  assert.equal(text.has("docs/assets/deep/index.md"), false);

  // An excluded save must not displace a pending in-scope save in the debounce.
  plugin.settings.fixOnSave = false;
  emit("modify", file("docs/guide.md", "Now listed")); emit("modify", note);
  await tick(500); await tick(1500);
  assert.match(text.get("docs/index.md")!, /\(guide\.md\)/);
});

test("note and log actions cannot read or change a note inside an excluded folder", async (t) => {
  const { plugin, folder, file, text, reads, writes, setActive } = await fixture(t);
  const note = file("docs/assets/deep/note.md", "My unmodified note");
  setActive(note);
  await plugin.validateActive(note, false);
  assert.equal(await plugin.fixFile(note, false), 0);
  await plugin.migrateActive(note);
  await plugin.onStatusClick();
  await plugin.setFrontmatterFields(note, { type: "Concept" });
  await plugin.addLogEntry(folder("docs/assets/deep"));
  assert.deepEqual(reads, []); assert.deepEqual(writes, []);
  assert.equal(text.get(note.path), "My unmodified note");
});

test("a report-only gap scan never reads excluded child descriptions or writes missing indexes", async (t) => {
  const { plugin, file, reads, writes } = await fixture(t);
  file("index.md", "# Subdirectories\n\n* [Docs](docs/index.md)\n");
  file("docs/index.md", "# Purpose\n\nHand-maintained.\n");
  file("docs/keep.md", "---\n{\"type\":\"Concept\"}\n---\n");
  file("docs/assets/index.md", "# Purpose\n\nPrivate description.\n");
  file("docs/assets/deep/other.md", "Do not scan");
  plugin.settings.reportIndexGaps = true;
  plugin.settings.indexSubdirDescSection = "Purpose";
  await plugin.scanVault(false, true);
  assert.deepEqual([...new Set(reads)].sort(), ["docs/index.md", "docs/keep.md", "index.md"]);
  assert.deepEqual(writes, []);
});

test("folder writes cannot use default exclusions while saved settings are loading", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { plugin, folder, text, writes, emit, published } = startFixture(t, ["assets"], gate);
  const dir = folder("docs/assets"); emit("create", dir);
  t.mock.timers.tick(1500); await new Promise<void>((r) => setImmediate(r));
  assert.deepEqual(writes, []);
  assert.equal(await plugin.generateIndexForFolder(dir), false);
  await plugin.addLogEntry(dir);
  release(); await published;
  await plugin.generateIndexForFolder(folder("/"));
  assert.deepEqual([...text.keys()].sort(), ["docs/index.md", "index.md"]);
});
