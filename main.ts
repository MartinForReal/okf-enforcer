// main.ts — OKF Enforcer plugin entry point
import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  WorkspaceLeaf,
  debounce,
} from "obsidian";
import {
  OkfSettings,
  DEFAULT_SETTINGS,
  validateContent,
  applyFixes,
  isReserved,
  isExcluded,
  basename,
  parentPath,
  oneLine,
  sectionBlock,
  sectionSummary,
  mergeIndex,
  renderIndex,
  sectionForType,
  INDEX_SECTIONS,
  type IndexEntry,
  OkfIssue,
  OKF_VERSION,
} from "./validator";
import { PORTENT_TYPES, PORTENT_STATUSES } from "./portent";
import { OkfReportView, OKF_VIEW_TYPE, FileResult } from "./report-view";

/**
 * How far a folder sits from the vault root, which is 0. Indexes are written
 * deepest first: a parent links at — and quotes the description section of —
 * its children's `index.md`, so those have to be on disk before the listing
 * above them is built.
 */
function folderDepth(path: string): number {
  return path === "/" || path === "" ? 0 : path.split("/").length;
}

export default class OkfPlugin extends Plugin {
  settings: OkfSettings;
  statusEl: HTMLElement;
  private selfWrites = new Set<string>();
  private dirtyIndexFolders = new Set<string>();
  private busy = false;
  private layoutReady = false;
  private lastSummary: { scanned: number; errFiles: number; warnFiles: number } | null =
    null;
  private pendingResults: { results: FileResult[]; scanned: number } | null =
    null;

  onload() {
    // Start from defaults synchronously so onload returns void (the type
    // Obsidian's Plugin base class expects), then load persisted settings in
    // the background. Event/command handlers read this.settings lazily, so
    // they pick up the loaded values once the async load resolves.
    this.settings = { ...DEFAULT_SETTINGS };
    void this.loadSettings();

    this.registerView(OKF_VIEW_TYPE, (leaf) => new OkfReportView(leaf, this));

    // Single entry point: the status-bar item (clickable). No ribbon icon, to
    // keep the UI footprint minimal — all actions remain in the command palette.
    // Clicking it auto-fixes the active note (or runs a vault scan when no note
    // is focused), then surfaces anything that still needs the user.
    this.statusEl = this.addStatusBarItem();
    this.statusEl.setText("OKF: —");
    this.statusEl.addClass("mod-clickable");
    this.statusEl.setAttribute(
      "aria-label",
      "OKF — click to auto-fix this note"
    );
    this.statusEl.onClickEvent(() => { void this.onStatusClick(); });

    this.addCommand({
      id: "okf-validate-vault",
      name: "Validate vault (full report)",
      callback: () => { void this.scanVault(); },
    });
    this.addCommand({
      id: "okf-validate-active",
      name: "Validate active note",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || f.extension !== "md") return false;
        if (!checking) void this.validateActive(f, true);
        return true;
      },
    });
    this.addCommand({
      id: "okf-fix-active",
      name: "Fix active note (add missing OKF fields)",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || f.extension !== "md") return false;
        if (!checking) void this.fixFile(f, true);
        return true;
      },
    });
    this.addCommand({
      id: "okf-fix-all",
      name: "Fix all auto-fixable issues in vault",
      callback: () => { void this.fixAll(); },
    });
    this.addCommand({
      id: "okf-generate-index",
      name: "Generate/refresh index.md for a folder",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || !(f.parent instanceof TFolder)) return false;
        if (!checking) void this.generateIndexForFolder(f.parent);
        return true;
      },
    });
    this.addCommand({
      id: "okf-generate-all-indexes",
      name: "Generate/refresh index.md for ALL folders",
      callback: () => { void this.generateAllIndexes(); },
    });
    this.addCommand({
      id: "okf-add-log-entry",
      name: "Add log.md entry (current folder)",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || !(f.parent instanceof TFolder)) return false;
        if (!checking) void this.addLogEntry(f.parent);
        return true;
      },
    });
    this.addCommand({
      id: "okf-migrate-v01-v02",
      name: "Migrate note to latest OKF",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || f.extension !== "md" || isReserved(f.path)) return false;
        if (!checking) void this.migrateActive(f);
        return true;
      },
    });

    const liveCheck = debounce(
      (file: TFile) => {
        void this.onFileChanged(file);
      },
      500,
      true
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          if (this.selfWrites.has(file.path)) {
            this.selfWrites.delete(file.path);
            return;
          }
          liveCheck(file);
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file && file.extension === "md") void this.validateActive(file, false);
      })
    );

    // ---- New / imported files. The Importer plugin (and any other tool that
    // adds notes) creates files via vault.create, which fires "create" rather
    // than "modify". Obsidian also replays a create for every existing file at
    // startup, so we gate on layoutReady to only act on genuinely new files. ----
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (!this.layoutReady) return;
        if (file instanceof TFolder) {
          // A folder created in the file explorer holds nothing yet, so no note
          // event will ever announce it. Its index says the folder is empty
          // until something arrives to list.
          this.markIndexDirty(file.path);
          return;
        }
        if (file instanceof TFile && file.extension === "md") {
          if (this.selfWrites.has(file.path)) {
            this.selfWrites.delete(file.path);
            return;
          }
          // Defer briefly so the importer finishes writing the file body first.
          window.setTimeout(() => { void this.onFileChanged(file); }, 300);
        }
      })
    );

    // ---- Deletes and renames. A note leaving a folder changes that folder's
    // listing as much as one arriving does, and neither fires "modify" or
    // "create". A rename touches two listings: the folder the note left and the
    // one it joined. ----
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (!this.layoutReady) return;
        if (file instanceof TFile && file.extension !== "md") return;
        this.markIndexDirty(parentPath(file.path));
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!this.layoutReady) return;
        if (file instanceof TFile && file.extension !== "md") return;
        this.markIndexDirty(parentPath(oldPath));
        this.markIndexDirty(parentPath(file.path));
      })
    );

    this.addSettingTab(new OkfSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => {
      this.layoutReady = true;
      // The panel is hidden by default simply because we never auto-open it;
      // we do not detach existing leaves, so a user-positioned view is preserved.
      window.setTimeout(() => { void this.startupPass(); }, 1500);
    });
  }

  /**
   * The startup work, once the workspace has settled: bring the indexes up to
   * date, then scan. Both are opt-out/opt-in toggles, and either may be off.
   *
   * Indexes go first because a scan validates `index.md` against §8, and a
   * stale listing the pass is about to rewrite shouldn't be reported as a
   * finding the user then has to look at. They run one after the other rather
   * than together because each takes `this.busy` for the duration, so
   * overlapping them would mean one silently doing nothing.
   */
  private async startupPass(): Promise<void> {
    if (this.settings.autoGenerateIndex && this.settings.generateIndexOnStartup) {
      await this.generateAllIndexes(true);
    }
    // Silent: update the status bar/tooltip only, never open the panel.
    if (this.settings.scanOnStartup) await this.scanVault(false, true);
  }

  onunload() {
    // Intentionally do not detach the view here: Obsidian persists leaf
    // placement, and detaching would reset a user-moved panel on next load.
  }

  async loadSettings() {
    const saved = (await this.loadData()) as Partial<OkfSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }

  private isConcept(file: TFile): boolean {
    if (file.extension !== "md") return false;
    if (isExcluded(file.path, this.settings)) return false;
    return true;
  }
  private isRoot(file: TFile): boolean {
    return !file.path.includes("/");
  }

  private candidateFiles(): TFile[] {
    // The config folder name is user-configurable (not always ".obsidian").
    const configDir = this.app.vault.configDir;
    return this.app.vault
      .getMarkdownFiles()
      .filter(
        (f) =>
          !f.path.startsWith(configDir + "/") &&
          !isExcluded(f.path, this.settings)
      );
  }

  /** Current report view, if open. */
  private getReportView(): OkfReportView | null {
    const leaf = this.app.workspace.getLeavesOfType(OKF_VIEW_TYPE)[0];
    return leaf && leaf.view instanceof OkfReportView ? leaf.view : null;
  }

  private async processQueue<T>(
    items: T[],
    worker: (item: T) => Promise<void>,
    label?: string
  ): Promise<void> {
    const size = Math.max(1, this.settings.batchSize | 0);
    // Show inline progress only for non-trivial runs with a label. Best
    // practice: drive a progress bar in the panel + a % in the status bar,
    // rather than a persistent popup Notice.
    const showBar = !!label && items.length > size;
    const view = showBar ? this.getReportView() : null;
    if (showBar && label) view?.showProgress(label);
    const baseStatus = this.statusEl.getText();

    for (let i = 0; i < items.length; i += size) {
      const batch = items.slice(i, i + size);
      await Promise.all(batch.map((it) => worker(it).catch(() => {})));
      if (showBar) {
        const done = Math.min(i + size, items.length);
        const frac = done / items.length;
        view?.setProgress(frac, label);
        this.statusEl.setText(`OKF ${Math.round(frac * 100)}%`);
      }
      await new Promise((r) => window.setTimeout(r, 0));
    }
    if (showBar) {
      view?.hideProgress();
      this.statusEl.setText(baseStatus);
    }
  }

  private async onFileChanged(file: TFile) {
    if (!this.isConcept(file)) return;

    if (this.settings.fixOnSave && !isReserved(file.path)) {
      const n = await this.fixFile(file, false);
      if (n > 0 && file.parent) {
        this.markIndexDirty(file.parent.path);
      }
    }

    if (this.settings.liveCheckOnSave) {
      const active = this.app.workspace.getActiveFile();
      if (active && active.path === file.path) {
        await this.validateActive(file, false);
      }
    }

    if (this.settings.autoGenerateIndex && file.parent) {
      this.markIndexDirty(file.parent.path);
    }
  }

  /**
   * Queues a folder's index.md for the next debounced regeneration, along with
   * every folder above it. A listing describes its subdirectories as well as its
   * notes, and both halves of a subdirectory entry look past the folder itself:
   * whether one is worth listing depends on what it holds at any depth, and its
   * description is read out of its own index.md. So a note appearing or
   * vanishing deep in a tree can change every listing above it, not just the one
   * in the folder the note sat in.
   */
  private markIndexDirty(path: string): void {
    if (!this.settings.autoGenerateIndex) return;
    for (let p = path; ; p = parentPath(p)) {
      this.dirtyIndexFolders.add(p);
      if (p === "/" || p === "") break;
    }
    this.flushIndexes();
  }

  private flushIndexes = debounce(
    async () => {
      if (!this.settings.autoGenerateIndex) return;
      const folders = [...this.dirtyIndexFolders].sort(
        (a, b) => folderDepth(b) - folderDepth(a)
      );
      this.dirtyIndexFolders.clear();
      for (const path of folders) {
        // The root is asked for by name rather than looked up: every walk up the
        // tree ends there, so it is regenerated far too often to rest on whether
        // "/" happens to be a key in the vault's path map.
        const folder =
          path === "/" || path === ""
            ? this.app.vault.getRoot()
            : this.app.vault.getAbstractFileByPath(path);
        if (folder instanceof TFolder && this.folderIsIndexable(folder)) {
          await this.generateIndexForFolder(folder, false);
        }
      }
    },
    1500,
    true
  );

  /**
   * Status-bar click: auto-fix the active note, then — if required fields
   * still can't be satisfied automatically — prompt the user to fill them.
   * With no active note, fall back to a full vault scan + report.
   */
  async onStatusClick() {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md" || isReserved(file.path)) {
      await this.scanVault(true, false);
      return;
    }
    // Validate first so we know whether a required field was missing *before*
    // auto-fix (which only fills a placeholder type the user should refine).
    let content = await this.app.vault.read(file);
    const preIssues = validateContent(
      file.path,
      content,
      this.isRoot(file),
      this.settings
    );
    const hadRequiredError = preIssues.some((i) => i.severity === "error");

    // Auto-fix structure (frontmatter block, placeholder type, title, generated).
    await this.fixFile(file, false);

    content = await this.app.vault.read(file);
    const postIssues = validateContent(
      file.path,
      content,
      this.isRoot(file),
      this.settings
    );
    this.updateStatus(postIssues);

    const remainingErrors = postIssues.filter((i) => i.severity === "error");
    if (remainingErrors.length > 0) {
      // Something the fixer couldn't resolve automatically.
      this.promptForRequiredFields(file, remainingErrors);
    } else if (hadRequiredError) {
      // Required field was just auto-filled with a placeholder — let the user
      // set the real value rather than leaving the default.
      this.promptForRequiredFields(file, preIssues.filter((i) => i.severity === "error"));
    } else {
      new Notice("OKF: note is conformant ✅");
    }
  }

  /** Open a modal asking the user to supply required OKF fields. */
  promptForRequiredFields(file: TFile, errors: OkfIssue[]) {
    new OkfPromptModal(this.app, this, file, errors).open();
  }

  async validateActive(file: TFile, openReport: boolean) {
    const content = await this.app.vault.read(file);
    const issues = validateContent(
      file.path,
      content,
      this.isRoot(file),
      this.settings
    );
    this.updateStatus(issues);
    if (openReport) {
      this.renderResults(issues.length ? [{ path: file.path, issues }] : [], 1);
      void this.activateView();
      if (!issues.length) new Notice("OKF: active note is conformant ✅");
    }
  }

  private updateStatus(issues: OkfIssue[]) {
    const errs = issues.filter((i) => i.severity === "error").length;
    const warns = issues.filter((i) => i.severity === "warning").length;
    this.statusEl.removeClass(
      "okf-statusbar-ok",
      "okf-statusbar-bad",
      "okf-statusbar-warn"
    );
    if (errs > 0) {
      this.statusEl.setText(`OKF ✖ ${errs}`);
      this.statusEl.addClass("okf-statusbar-bad");
    } else if (warns > 0) {
      this.statusEl.setText(`OKF ⚠ ${warns}`);
      this.statusEl.addClass("okf-statusbar-warn");
    } else {
      this.statusEl.setText("OKF ✓");
      this.statusEl.addClass("okf-statusbar-ok");
    }
    // Tooltip carries the detail so we don't need a Notice for routine checks.
    if (issues.length === 0) {
      this.statusEl.setAttribute(
        "aria-label",
        "Active note conforms to OKF v0.2 — click to scan the vault"
      );
    } else {
      const lines = issues
        .slice(0, 8)
        .map((i) => `${i.severity === "error" ? "✖" : "⚠"} ${i.rule} ${i.message}`);
      if (issues.length > 8) lines.push(`…and ${issues.length - 8} more`);
      lines.push("");
      lines.push("Click to scan the whole vault");
      this.statusEl.setAttribute("aria-label", lines.join("\n"));
    }
  }

  /** Vault-wide summary tooltip on the status bar (set after a full scan). */
  private refreshStatusTooltip() {
    if (!this.lastSummary) return;
    const { scanned, errFiles, warnFiles } = this.lastSummary;
    const ok = scanned - errFiles - warnFiles;
    this.statusEl.setAttribute(
      "aria-label",
      `OKF v0.2 — ${scanned} notes scanned\n✓ ${ok} conformant\n✖ ${errFiles} with errors\n⚠ ${warnFiles} warnings only\n\nClick to open the report`
    );
  }

  async scanVault(reveal = true, silent = false) {
    if (this.busy) {
      if (!silent) new Notice("OKF: a scan/fix is already running…");
      return;
    }
    this.busy = true;
    try {
      const files = this.candidateFiles();
      const results: FileResult[] = [];
      await this.processQueue(
        files,
        async (f) => {
          const content = await this.app.vault.read(f);
          const issues = validateContent(
            f.path,
            content,
            this.isRoot(f),
            this.settings
          );
          if (issues.length) results.push({ path: f.path, issues });
        },
        silent ? undefined : "OKF: scanning"
      );
      results.sort((a, b) => a.path.localeCompare(b.path));
      this.renderResults(results, files.length);
      const errFiles = results.filter((r) =>
        r.issues.some((i) => i.severity === "error")
      ).length;
      const warnFiles = results.length - errFiles;
      this.lastSummary = { scanned: files.length, errFiles, warnFiles };
      this.refreshStatusTooltip();
      // Only steal focus / open the panel on an explicit, non-silent run.
      if (reveal && !silent) await this.activateView();
      // Notice only when the user explicitly asked (non-silent).
      if (!silent) {
        new Notice(
          `OKF: scanned ${files.length} notes — ${errFiles} with errors, ${warnFiles} with warnings only.`
        );
      }
    } finally {
      this.busy = false;
    }
  }

  private renderResults(results: FileResult[], scanned: number) {
    const leaf = this.app.workspace.getLeavesOfType(OKF_VIEW_TYPE)[0];
    if (leaf && leaf.view instanceof OkfReportView) {
      leaf.view.setResults(results, scanned);
    } else {
      this.pendingResults = { results, scanned };
    }
  }

  async fixFile(file: TFile, notify: boolean): Promise<number> {
    const content = await this.app.vault.read(file);
    const issues = validateContent(
      file.path,
      content,
      this.isRoot(file),
      this.settings
    );
    if (isReserved(file.path)) {
      if (notify)
        new Notice("OKF: reserved files (index/log) are not auto-fixable.");
      return 0;
    }
    const { content: fixed, applied } = applyFixes(
      file.path,
      content,
      issues,
      this.settings,
      this.settings.autoMigrateOnFix
    );
    if (applied.length > 0 && fixed !== content) {
      this.selfWrites.add(file.path);
      await this.app.vault.modify(file, fixed);
      if (notify)
        new Notice(`OKF fixed ${file.basename}: ${applied.join(", ")}`);
      return applied.length;
    }
    if (notify) new Notice("OKF: nothing auto-fixable on this note.");
    return 0;
  }

  /**
   * Migrate a note from OKF v0.1 to v0.2 (§13): rename `timestamp` → `generated`
   * and lift a body `# Citations` list into `sources`. Runs the migration fixes
   * that ordinary save-time auto-fix deliberately skips.
   */
  async migrateActive(file: TFile) {
    const content = await this.app.vault.read(file);
    const issues = validateContent(
      file.path,
      content,
      this.isRoot(file),
      this.settings
    );
    const { content: fixed, applied } = applyFixes(
      file.path,
      content,
      issues,
      this.settings,
      true
    );
    if (applied.length > 0 && fixed !== content) {
      this.selfWrites.add(file.path);
      await this.app.vault.modify(file, fixed);
      new Notice(`OKF migrated ${file.basename}: ${applied.join(", ")}`);
    } else {
      new Notice("OKF: nothing to migrate — note already uses v0.2 fields.");
    }
  }

  /**
   * Write user-supplied frontmatter values (from the prompt modal) into a note,
   * using Obsidian's safe frontmatter editor. Empty values are skipped.
   */
  async setFrontmatterFields(file: TFile, fields: Record<string, string>) {
    this.selfWrites.add(file.path);
    await this.app.fileManager.processFrontMatter(
      file,
      (fm: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(fields)) {
          const val = (v ?? "").trim();
          if (val.length > 0) fm[k] = val;
        }
      }
    );
    // Refresh status after the edit.
    const content = await this.app.vault.read(file);
    const issues = validateContent(
      file.path,
      content,
      this.isRoot(file),
      this.settings
    );
    this.updateStatus(issues);
  }

  async fixAll() {
    if (this.busy) {
      new Notice("OKF: a scan/fix is already running…");
      return;
    }
    this.busy = true;
    let changed = 0;
    try {
      const files = this.candidateFiles().filter((f) => !isReserved(f.path));
      await this.processQueue(
        files,
        async (f) => {
          const n = await this.fixFile(f, false);
          if (n > 0) changed++;
        },
        "OKF: fixing"
      );
    } finally {
      this.busy = false;
    }
    new Notice(`OKF: auto-fixed ${changed} note(s).`);
    await this.scanVault();
  }

  /** Writes the folder's index.md; returns whether the file changed on disk. */
  async generateIndexForFolder(
    folder: TFolder,
    notify = true
  ): Promise<boolean> {
    if (!folder) {
      if (notify) new Notice("OKF: no folder for the active note.");
      return false;
    }
    const indexPath =
      folder.path === "/" || folder.path === ""
        ? "index.md"
        : `${folder.path}/index.md`;
    const existing = this.app.vault.getAbstractFileByPath(indexPath);
    // A rewrite has to carry over the section a folder uses to describe itself
    // to its parent — otherwise the refresh that reads the description is the
    // same one that deletes it.
    const current =
      existing instanceof TFile ? await this.app.vault.read(existing) : null;
    const kept =
      current === null
        ? ""
        : sectionBlock(current, this.settings.indexSubdirDescSection);

    const children = folder.children;
    // Notes are grouped by their `type`, so the listing says what the directory
    // holds. Keyed by the heading rather than the raw type, which folds
    // `concept` and `Concept` into one section.
    const byType = new Map<string, IndexEntry[]>();
    const subdirs: IndexEntry[] = [];
    const files: IndexEntry[] = [];

    for (const child of children) {
      if (child instanceof TFile) {
        if (isReserved(child.path)) continue;
        if (child.extension !== "md") {
          // An attachment is part of what the directory holds, so §8 lists it —
          // under its own heading, since it carries no frontmatter to be
          // described or typed by. Without this a folder of nothing but images
          // would render an index that claims the folder is empty.
          files.push({
            section: INDEX_SECTIONS.files,
            link: encodeURI(child.name),
            title: child.name,
            desc: "",
          });
          continue;
        }
        const fm: Record<string, unknown> =
          this.app.metadataCache.getFileCache(child)?.frontmatter ?? {};
        const fmTitle = fm["title"];
        const fmDesc = fm["description"];
        const title =
          typeof fmTitle === "string" && fmTitle.length > 0
            ? fmTitle
            : basename(child.path);
        const desc = typeof fmDesc === "string" ? oneLine(fmDesc) : "";
        const section = sectionForType(fm["type"]);
        const bucket = byType.get(section);
        const entry: IndexEntry = {
          section,
          link: encodeURI(child.name),
          title,
          desc,
        };
        if (bucket) bucket.push(entry);
        else byType.set(section, [entry]);
      } else if (child instanceof TFolder) {
        // A subdirectory's document is its own index.md, so that is what the
        // entry links at. A bare `folder/` link resolves to a note that doesn't
        // exist, and clicking it creates a stray file in the vault.
        if (!this.folderIsIndexable(child)) continue;
        // Write that index before linking at it. Marking only ever walks up
        // from a change, so a subfolder nothing has touched is never queued on
        // its own; without this, a listing could point at an index nothing
        // writes. Descending also when an index is missing deeper down is what
        // reaches a folder that has an index of its own but subdirectories that
        // don't — the entries there would dangle just the same. The condition
        // goes false once every folder below has one, so a settled tree costs an
        // in-memory walk and no reads.
        let childIndex = this.app.vault.getAbstractFileByPath(
          `${child.path}/index.md`
        );
        if (
          !(childIndex instanceof TFile) ||
          this.indexesMissingBelow(child)
        ) {
          await this.generateIndexForFolder(child, false);
          childIndex = this.app.vault.getAbstractFileByPath(
            `${child.path}/index.md`
          );
        }
        subdirs.push({
          section: INDEX_SECTIONS.subdirs,
          link: `${encodeURI(child.name)}/index.md`,
          title: child.name,
          desc:
            childIndex instanceof TFile
              ? await this.folderDescription(childIndex)
              : "",
        });
      }
    }

    // Subdirectories first — they're the branches of the tree — then one
    // section per type in alphabetical order, so the same folder renders the
    // same way whatever order Obsidian happens to hand its children over in.
    // What the plugin couldn't type, and what isn't a note at all, goes last.
    const groups: [string, IndexEntry[]][] = [
      [INDEX_SECTIONS.subdirs, subdirs],
      ...[...byType.entries()]
        .filter(([section]) => section !== INDEX_SECTIONS.untyped)
        .sort(([a], [b]) => a.localeCompare(b)),
      [INDEX_SECTIONS.untyped, byType.get(INDEX_SECTIONS.untyped) ?? []],
      [INDEX_SECTIONS.files, files],
    ];
    // Two groups can land on one heading: `type: File` pluralises onto the same
    // `Files` the attachments use, and `Note` and `note` differ only in case,
    // which is how §8 headings are matched anyway. Folding them keeps a heading
    // from being written twice, under the spelling that got there first.
    const sections = new Map<string, IndexEntry[]>();
    for (const [section, group] of groups) {
      if (group.length === 0) continue;
      const at = sections.get(section.toLowerCase());
      if (!at) sections.set(section.toLowerCase(), [...group]);
      else for (const e of group) at.push({ ...e, section: at[0].section });
    }
    const entries = [...sections.values()].flat();
    // §8 makes an index optional, but a folder that has one is navigable and a
    // folder that doesn't is a dead end in its parent's listing. So every
    // folder gets one, including an empty and a newly created folder — there is
    // simply nothing in it to list, and the first entry fills it in.
    const maintaining = current !== null && !this.settings.overwriteExistingIndex;

    let out: string;
    if (maintaining) {
      // Additive: add what the listing is missing, correct a link that points at
      // the wrong path, drop one whose note this folder no longer holds, and
      // touch nothing else.
      const base =
        folder.path === "/" || folder.path === "" ? "" : `${folder.path}/`;
      out = mergeIndex(
        current,
        entries,
        (target) => this.app.vault.getAbstractFileByPath(base + target) !== null
      );
    } else {
      out = renderIndex(entries, kept);
      // The bundle-root index.md is the only place `okf_version` frontmatter is
      // allowed (§8, §12); non-root indexes stay frontmatter-free.
      if (indexPath === "index.md") {
        out = `---\nokf_version: "${OKF_VERSION}"\n---\n\n${out}`;
      }
    }
    if (existing instanceof TFile) {
      if (current === out) return false;
      this.selfWrites.add(indexPath);
      await this.app.vault.modify(existing, out);
    } else {
      this.selfWrites.add(indexPath);
      await this.app.vault.create(indexPath, out);
    }
    if (notify) new Notice(`OKF: wrote ${indexPath}`);
    return true;
  }

  /**
   * Description for a subdirectory entry, read from the configured section of
   * that folder's index.md (e.g. `# Purpose`). Non-root indexes carry no
   * frontmatter (§8), so a body section is the only place a folder can say what
   * it is for.
   */
  private async folderDescription(index: TFile): Promise<string> {
    const section = this.settings.indexSubdirDescSection.trim();
    if (!section) return "";
    return sectionSummary(await this.app.vault.cachedRead(index), section);
  }

  /**
   * Whether a folder is one this plugin writes an index for and lists in its
   * parent. Every folder in the bundle qualifies — an empty one included, since
   * a listing that says a directory is empty is more use than a directory that
   * can't be reached — except the ones that aren't part of the bundle at all:
   * Obsidian's own config folder and anything the user excluded.
   */
  private folderIsIndexable(folder: TFolder): boolean {
    const path = folder.path;
    if (path === "/" || path === "") return true;
    const config = this.app.vault.configDir;
    if (path === config || path.startsWith(config + "/")) return false;
    return !isExcluded(path, this.settings);
  }

  /**
   * Whether any folder worth listing somewhere below this one still has no
   * `index.md`. Answered from the loaded file tree alone — no reads — so it is
   * cheap to ask on every generation, and it stops being true once the tree has
   * been filled in once.
   */
  private indexesMissingBelow(folder: TFolder): boolean {
    for (const child of folder.children) {
      if (!(child instanceof TFolder)) continue;
      if (!this.folderIsIndexable(child)) continue;
      const has =
        this.app.vault.getAbstractFileByPath(`${child.path}/index.md`) instanceof
        TFile;
      if (!has || this.indexesMissingBelow(child)) return true;
    }
    return false;
  }

  async generateAllIndexes(silent = false) {
    if (this.busy) {
      if (!silent) new Notice("OKF: a scan/fix is already running…");
      return;
    }
    this.busy = true;
    try {
      // Walk the folder tree rather than the notes in it. A folder that holds
      // no notes — empty, or nothing but subfolders — still gets an index, so
      // there is nothing to find it by except the tree itself.
      const list: TFolder[] = [];
      const walk = (folder: TFolder) => {
        if (!this.folderIsIndexable(folder)) return;
        list.push(folder);
        for (const child of folder.children) {
          if (child instanceof TFolder) walk(child);
        }
      };
      walk(this.app.vault.getRoot());
      // Deepest folders first: a parent links to — and quotes the description
      // section of — its children's index.md, so those must be in place before
      // the parent listing is written.
      list.sort((a, b) => folderDepth(b.path) - folderDepth(a.path));
      let written = 0;
      await this.processQueue(
        list,
        async (folder) => {
          if (await this.generateIndexForFolder(folder, false)) written++;
        },
        "OKF: building indexes"
      );
      // A silent pass still reports through the progress bar while it runs —
      // unlike a scan, this writes to the vault, and that shouldn't happen with
      // no sign of it — but it doesn't interrupt with a notice at the end.
      if (!silent) {
        new Notice(
          `OKF: updated index.md in ${written} of ${list.length} folder(s).`
        );
      }
    } finally {
      this.busy = false;
    }
  }

  async addLogEntry(folder: TFolder) {
    if (!folder) return;
    const logPath =
      folder.path === "/" || folder.path === ""
        ? "log.md"
        : `${folder.path}/log.md`;
    const today = new Date().toISOString().slice(0, 10);
    const entry = `* **Update**: `;
    const existing = this.app.vault.getAbstractFileByPath(logPath);

    if (existing instanceof TFile) {
      let content = await this.app.vault.read(existing);
      const heading = `## ${today}`;
      if (content.includes(heading)) {
        content = content.replace(heading, `${heading}\n${entry}`);
      } else {
        const h1 = content.match(/^#\s+.+$/m);
        if (h1) {
          const idx = content.indexOf(h1[0]) + h1[0].length;
          content =
            content.slice(0, idx) +
            `\n\n${heading}\n${entry}` +
            content.slice(idx);
        } else {
          content = `# Update Log\n\n${heading}\n${entry}\n` + content;
        }
      }
      this.selfWrites.add(logPath);
      await this.app.vault.modify(existing, content);
    } else {
      this.selfWrites.add(logPath);
      await this.app.vault.create(
        logPath,
        `# Update Log\n\n## ${today}\n${entry}\n`
      );
    }
    const file = this.app.vault.getAbstractFileByPath(logPath);
    if (file instanceof TFile)
      await this.app.workspace.getLeaf(false).openFile(file);
    new Notice(`OKF: added log entry for ${today}`);
  }

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(OKF_VIEW_TYPE);
    let leaf: WorkspaceLeaf | null;
    if (existing.length) {
      leaf = existing[0];
    } else {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: OKF_VIEW_TYPE, active: true });
    }
    if (leaf) {
      void this.app.workspace.revealLeaf(leaf);
      if (this.pendingResults && leaf.view instanceof OkfReportView) {
        leaf.view.setResults(
          this.pendingResults.results,
          this.pendingResults.scanned
        );
        this.pendingResults = null;
      }
    }
  }
}

/**
 * Minimal local shape of Obsidian 1.13+'s declarative setting definitions.
 * Declared here rather than imported so the plugin type-checks against its
 * 1.7.2 `minAppVersion` while still supplying definitions to Obsidian 1.13+ at
 * runtime via the duck-typed `getSettingDefinitions()` method.
 */
type SettingDefinitionItem = {
  name: string;
  desc?: string | DocumentFragment;
  searchable?: boolean;
  render: (setting: Setting) => void | (() => void);
};

type OkfSettingSpec = {
  name: string;
  desc?: string;
  heading?: boolean;
  portentDependent?: boolean;
  // Returns the chained Setting (not void) so the builder can stay a terse
  // expression body; typing it `unknown` keeps no-misused-promises' void-return
  // check from firing on the control property.
  control?: (row: Setting) => unknown;
};

class OkfSettingTab extends PluginSettingTab {
  plugin: OkfPlugin;
  constructor(app: App, plugin: OkfPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Single source of truth for the settings UI, consumed by both the imperative
   * display() (Obsidian < 1.13) and the declarative getSettingDefinitions()
   * (Obsidian 1.13+) so the two paths can never drift.
   */
  private settingSpecs(): OkfSettingSpec[] {
    const s = this.plugin.settings;
    const save = () => void this.plugin.saveSettings();
    const list = (v: string) =>
      v
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    return [
      {
        name: "Default type for auto-fix",
        desc: "Value inserted into `type` when fixing notes that lack it.",
        control: (row) =>
          row.addText((t) =>
            t.setValue(s.defaultType).onChange((v) => {
              s.defaultType = v || "Concept";
              save();
            })
          ),
      },
      {
        name: "Default actor for `generated.by`",
        desc: "Actor written when auto-fix adds a `generated` block (§7). Use `<producer>/<version>` (e.g. `okf-enforcer/0.4`) or `human:<id>`.",
        control: (row) =>
          row.addText((t) =>
            t.setValue(s.defaultActor).onChange((v) => {
              s.defaultActor = v.trim() || "okf-enforcer/0.4";
              save();
            })
          ),
      },
      {
        name: "Live check on save / open",
        desc: "Validate the active note as you edit and when you open it.",
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.liveCheckOnSave).onChange((v) => {
              s.liveCheckOnSave = v;
              save();
            })
          ),
      },
      { name: "Automation", heading: true },
      {
        name: "Scan vault on startup",
        desc: "Run a full conformance scan automatically when the plugin loads (deferred until the workspace is ready).",
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.scanOnStartup).onChange((v) => {
              s.scanOnStartup = v;
              save();
            })
          ),
      },
      {
        name: "Fix format issues on save",
        desc: "When you edit a note, auto-insert missing OKF frontmatter (type/title/generated). Non-destructive; never overwrites existing values.",
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.fixOnSave).onChange((v) => {
              s.fixOnSave = v;
              save();
            })
          ),
      },
      {
        name: "Auto-generate index.md",
        desc: "Keep a folder's index.md (§8 listing) up to date as its notes are added, renamed, and deleted, along with every listing above it — a parent describes its subdirectories by what they hold. Entries are grouped by their `type` (Concepts, Metrics, …), a note with no type is listed under Untyped, and files that aren't notes under Files. Every folder gets an index, including an empty and a newly created folder — one with nothing to list is left empty — so no listing points at a file that isn't there; the config folder and anything under \"Excluded folders\" are left alone. An existing index has missing entries added, wrong links corrected, and entries for deleted notes removed, or is rebuilt if \"Rebuild existing index.md\" is on.",
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.autoGenerateIndex).onChange((v) => {
              s.autoGenerateIndex = v;
              save();
            })
          ),
      },
      {
        name: "Generate index.md on startup",
        desc: "Off (default): the hook above keeps listings current while the plugin is running, so nothing needs rebuilding at load. On: every folder's index.md is brought up to date once when the plugin loads, before the startup scan — for what changed while Obsidian was closed, such as a vault synced from another machine or edited outside it. Needs \"Auto-generate index.md\" on. Runs quietly: progress shows in the status bar, and no notice is raised when it finishes.",
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.generateIndexOnStartup).onChange((v) => {
              s.generateIndexOnStartup = v;
              save();
            })
          ),
      },
      {
        name: "Rebuild existing index.md",
        desc: "Off (default): generating an index adds the entries it doesn't already list, corrects a link that points at the wrong path, and drops one whose note this folder no longer holds, leaving your prose, ordering, titles, and edited descriptions untouched. On: the listing is rewritten from the folder's contents, which also refreshes every description, re-sorts the entries, and re-groups them under their current `type`.",
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.overwriteExistingIndex).onChange((v) => {
              s.overwriteExistingIndex = v;
              save();
            })
          ),
      },
      {
        name: "Subdirectory description section",
        desc: "Heading in a subfolder's index.md whose first paragraph becomes that folder's description in the parent listing (e.g. `Purpose`). The section is preserved when that index is regenerated, so what you write there survives a refresh. Leave blank for no subdirectory descriptions. Subdirectory entries always link at the folder's own index.md.",
        control: (row) =>
          row.addText((t) =>
            t
              .setPlaceholder("Purpose")
              .setValue(s.indexSubdirDescSection)
              .onChange((v) => {
                s.indexSubdirDescSection = v.trim();
                save();
              })
          ),
      },
      {
        name: "Auto-migrate to latest OKF on fix",
        desc: "Let auto-fix (and fix-on-save) also upgrade notes to the latest OKF version — e.g. rewrite legacy `timestamp` → `generated` and lift `# Citations` → `sources`. On by default. Turn off to keep migrations manual via the \"Migrate note to latest OKF\" command, since they rewrite existing content.",
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.autoMigrateOnFix).onChange((v) => {
              s.autoMigrateOnFix = v;
              save();
            })
          ),
      },
      {
        name: "Batch size",
        desc: "Files processed per async chunk during scan/fix. Lower = smoother UI on large vaults; higher = faster.",
        control: (row) =>
          row.addText((t) =>
            t.setValue(String(s.batchSize)).onChange((v) => {
              const n = parseInt(v, 10);
              s.batchSize = isNaN(n) || n < 1 ? 50 : Math.min(n, 1000);
              save();
            })
          ),
      },
      { name: "Rules", heading: true },
      {
        name: "Warn on missing recommended fields",
        desc: "title, description, generated (§4.1, §5.2).",
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.warnRecommendedFields).onChange((v) => {
              s.warnRecommendedFields = v;
              save();
            })
          ),
      },
      {
        name: "Validate trust & lifecycle fields",
        desc: "When present, check the v0.2 families: `verified` shape + actors, `status` vocabulary, `stale_after` date, and `sources` (§5). Advisory — off by default.",
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.warnTrustFields).onChange((v) => {
              s.warnTrustFields = v;
              save();
            })
          ),
      },
      {
        name: "Validate Attested Computation concepts",
        desc: "Check `type: Attested Computation` notes (§10): required `runtime`, a present computation, and `parameters`/`executor`/`attester` shape.",
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.checkAttestedComputation).onChange((v) => {
              s.checkAttestedComputation = v;
              save();
            })
          ),
      },
      {
        name: "Warn on missing tags",
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.warnTagsField).onChange((v) => {
              s.warnTagsField = v;
              save();
            })
          ),
      },
      {
        name: "Excluded folders",
        desc: "Comma-separated paths skipped during validation and index generation. Use this for attachment folders you'd rather not have an index.md in.",
        control: (row) =>
          row.addText((t) =>
            t.setValue(s.excludeFolders.join(", ")).onChange((v) => {
              s.excludeFolders = list(v);
              save();
            })
          ),
      },
      { name: "Portent", heading: true },
      {
        name: "Enable Portent validation",
        desc: "Experimental (beta) — the Portent spec is pre-1.0 and may still change. Additionally validate notes against the Portent spec (portent.md): default type vocabulary (Project, Operation, Responsibility, Task, Event, Note, Topic, Person), lifecycle metadata (optional and format-free; status / organized / archived, or omitted when organized by default), and relationship shape (belongs_to, related_to as wikilinks). All Portent findings are warnings — they never block OKF conformance.",
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.enablePortent).onChange((v) => {
              s.enablePortent = v;
              save();
              // Re-render so the dependent Portent options enable/disable to match.
              this.refresh();
            })
          ),
      },
      {
        name: "Validate type vocabulary",
        desc: "Warn when `type` is not one of the configured Portent types. Turn off if you use your own type names.",
        portentDependent: true,
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.portentCheckTypeVocab).onChange((v) => {
              s.portentCheckTypeVocab = v;
              save();
            })
          ),
      },
      {
        name: "Validate lifecycle",
        desc: "Check lifecycle values when present (status maps to the configured set; `organized`/`archived` are booleans). A missing lifecycle is never flagged.",
        portentDependent: true,
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.portentCheckLifecycle).onChange((v) => {
              s.portentCheckLifecycle = v;
              save();
            })
          ),
      },
      {
        name: "Validate belongs_to",
        desc: "Check `belongs_to` shape when present (a single wikilink to the primary parent).",
        portentDependent: true,
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.portentCheckBelongsTo).onChange((v) => {
              s.portentCheckBelongsTo = v;
              save();
            })
          ),
      },
      {
        name: "Validate related_to",
        desc: "Check `related_to` shape when present (a list of wikilinks).",
        portentDependent: true,
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.portentCheckRelatedTo).onChange((v) => {
              s.portentCheckRelatedTo = v;
              save();
            })
          ),
      },
      {
        name: "Portent schema",
        desc: "Customize the frontmatter keys and vocabularies Portent checks — track your own conventions or a future spec revision without a plugin update. Leave a field blank to restore its default.",
        heading: true,
        portentDependent: true,
      },
      {
        name: "Type vocabulary",
        desc: "Comma-separated accepted `type` values.",
        portentDependent: true,
        control: (row) =>
          row.addText((t) =>
            t.setValue(s.portentTypes.join(", ")).onChange((v) => {
              const l = list(v);
              s.portentTypes = l.length ? l : [...PORTENT_TYPES];
              save();
            })
          ),
      },
      {
        name: "Lifecycle status field",
        desc: "Frontmatter key holding the single lifecycle value (default `status`; e.g. rename to `state`).",
        portentDependent: true,
        control: (row) =>
          row.addText((t) =>
            t.setValue(s.portentStatusField).onChange((v) => {
              s.portentStatusField = v.trim() || "status";
              save();
            })
          ),
      },
      {
        name: "Lifecycle status values",
        desc: "Comma-separated accepted values for the status field.",
        portentDependent: true,
        control: (row) =>
          row.addText((t) =>
            t.setValue(s.portentStatuses.join(", ")).onChange((v) => {
              const l = list(v);
              s.portentStatuses = l.length ? l : [...PORTENT_STATUSES];
              save();
            })
          ),
      },
      {
        name: "Organized field",
        desc: "Frontmatter key for the boolean `organized` lifecycle flag.",
        portentDependent: true,
        control: (row) =>
          row.addText((t) =>
            t.setValue(s.portentOrganizedField).onChange((v) => {
              s.portentOrganizedField = v.trim() || "organized";
              save();
            })
          ),
      },
      {
        name: "Archived field",
        desc: "Frontmatter key for the boolean `archived` lifecycle flag.",
        portentDependent: true,
        control: (row) =>
          row.addText((t) =>
            t.setValue(s.portentArchivedField).onChange((v) => {
              s.portentArchivedField = v.trim() || "archived";
              save();
            })
          ),
      },
      {
        name: "Belongs-to field",
        desc: "Frontmatter key for the single-parent relationship (a wikilink).",
        portentDependent: true,
        control: (row) =>
          row.addText((t) =>
            t.setValue(s.portentBelongsToField).onChange((v) => {
              s.portentBelongsToField = v.trim() || "belongs_to";
              save();
            })
          ),
      },
      {
        name: "Related-to field",
        desc: "Frontmatter key for the related-notes relationship (a list of wikilinks).",
        portentDependent: true,
        control: (row) =>
          row.addText((t) =>
            t.setValue(s.portentRelatedToField).onChange((v) => {
              s.portentRelatedToField = v.trim() || "related_to";
              save();
            })
          ),
      },
    ];
  }

  /** Apply one spec to a Setting row — shared by the imperative and declarative paths. */
  private applySpec(row: Setting, spec: OkfSettingSpec): void {
    row.setName(spec.name);
    if (spec.desc) row.setDesc(spec.desc);
    if (spec.heading) {
      row.setHeading();
    } else {
      spec.control?.(row);
    }
    if (spec.portentDependent && !this.plugin.settings.enablePortent) {
      row.setDisabled(true);
    }
  }

  /** Imperative rendering — Obsidian < 1.13's dual-support fallback. */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    for (const spec of this.settingSpecs()) {
      this.applySpec(new Setting(containerEl), spec);
    }
  }

  /**
   * Declarative settings — Obsidian 1.13+ renders from these definitions (and
   * indexes them for settings search) instead of calling display(). Each row
   * delegates to the same builders display() uses, so behavior and the Portent
   * enable/disable dependency stay identical across both paths.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.settingSpecs().map(
      (spec): SettingDefinitionItem => ({
        name: spec.name,
        desc: spec.desc,
        searchable: !spec.heading,
        render: (row: Setting) => {
          this.applySpec(row, spec);
        },
      })
    );
  }

  /** Re-render after toggling Portent: update() on 1.13+, display() on older. */
  private refresh(): void {
    const tab = this as unknown as { update?: () => void };
    if (typeof tab.update === "function") tab.update();
    else this.display();
  }
}

// ---- Prompt modal: ask the user to supply required OKF fields ----
class OkfPromptModal extends Modal {
  plugin: OkfPlugin;
  file: TFile;
  errors: OkfIssue[];
  private typeValue: string;
  private titleValue: string;
  private descValue: string;

  constructor(app: App, plugin: OkfPlugin, file: TFile, errors: OkfIssue[]) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.errors = errors;
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = (cache && cache.frontmatter) || {};
    // Pre-fill with current values (auto-fix may have set a placeholder type).
    this.typeValue =
      typeof fm["type"] === "string" ? fm["type"] : plugin.settings.defaultType;
    this.titleValue =
      typeof fm["title"] === "string" ? fm["title"] : file.basename;
    this.descValue =
      typeof fm["description"] === "string" ? fm["description"] : "";
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "OKF — required fields" });
    contentEl.createEl("p", {
      cls: "okf-modal-intro",
      text: `“${this.file.basename}” needs a valid OKF type. Set the fields below and save.`,
    });

    if (this.errors.length) {
      const box = contentEl.createDiv({ cls: "okf-modal-issues" });
      for (const e of this.errors) {
        box.createDiv({ text: `✖ ${e.rule} — ${e.message}` });
      }
    }

    // type (required)
    const typeField = contentEl.createDiv({ cls: "okf-modal-field" });
    typeField.createEl("label", { text: "type (required)" });
    const typeInput = typeField.createEl("input", { type: "text" });
    typeInput.value = this.typeValue;
    typeInput.placeholder = "e.g. Concept, Source, Playbook, Reference";
    typeInput.oninput = () => (this.typeValue = typeInput.value);
    window.setTimeout(() => {
      typeInput.focus();
      typeInput.select();
    }, 0);

    // title (recommended)
    const titleField = contentEl.createDiv({ cls: "okf-modal-field" });
    titleField.createEl("label", { text: "title" });
    const titleInput = titleField.createEl("input", { type: "text" });
    titleInput.value = this.titleValue;
    titleInput.oninput = () => (this.titleValue = titleInput.value);

    // description (recommended)
    const descField = contentEl.createDiv({ cls: "okf-modal-field" });
    descField.createEl("label", { text: "description" });
    const descInput = descField.createEl("input", { type: "text" });
    descInput.value = this.descValue;
    descInput.placeholder = "one-line summary";
    descInput.oninput = () => (this.descValue = descInput.value);

    const buttons = contentEl.createDiv({ cls: "okf-modal-buttons" });
    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();
    const save = buttons.createEl("button", {
      text: "Save",
      cls: "mod-cta",
    });
    save.onclick = async () => {
      const type = this.typeValue.trim();
      if (!type) {
        new Notice("OKF: type is required.");
        typeInput.focus();
        return;
      }
      await this.plugin.setFrontmatterFields(this.file, {
        type,
        title: this.titleValue,
        description: this.descValue,
      });
      new Notice("OKF: fields saved ✓");
      this.close();
    };

    // Enter saves.
    contentEl.onkeydown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save.click();
      }
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}
