// main.ts — OKF Enforcer plugin entry point
import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  SettingDefinitionItem,
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
  OkfIssue,
  PORTENT_TYPES,
  PORTENT_STATUSES,
} from "./validator";
import { OkfReportView, OKF_VIEW_TYPE, FileResult } from "./report-view";

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

    this.addSettingTab(new OkfSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.layoutReady = true;
      // The panel is hidden by default simply because we never auto-open it;
      // we do not detach existing leaves, so a user-positioned view is preserved.
      if (this.settings.scanOnStartup) {
        // Silent: update the status bar/tooltip only, never open the panel.
        window.setTimeout(() => { void this.scanVault(false, true); }, 1500);
      }
    });
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
        this.dirtyIndexFolders.add(file.parent.path);
      }
    }

    if (this.settings.liveCheckOnSave) {
      const active = this.app.workspace.getActiveFile();
      if (active && active.path === file.path) {
        await this.validateActive(file, false);
      }
    }

    if (this.settings.autoGenerateIndex && file.parent) {
      this.dirtyIndexFolders.add(file.parent.path);
      this.flushIndexes();
    }
  }

  private flushIndexes = debounce(
    async () => {
      if (!this.settings.autoGenerateIndex) return;
      const folders = [...this.dirtyIndexFolders];
      this.dirtyIndexFolders.clear();
      for (const path of folders) {
        const folder = this.app.vault.getAbstractFileByPath(path);
        if (folder instanceof TFolder) {
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

    // Auto-fix structure (frontmatter block, placeholder type, title, timestamp).
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
        "Active note conforms to OKF v0.1 — click to scan the vault"
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
      `OKF v0.1 — ${scanned} notes scanned\n✓ ${ok} conformant\n✖ ${errFiles} with errors\n⚠ ${warnFiles} warnings only\n\nClick to open the report`
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
      this.settings
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

  async generateIndexForFolder(folder: TFolder, notify = true) {
    if (!folder) {
      if (notify) new Notice("OKF: no folder for the active note.");
      return;
    }
    const children = folder.children;
    const concepts: { link: string; title: string; desc: string }[] = [];
    const subdirs: { link: string; name: string }[] = [];

    for (const child of children) {
      if (child instanceof TFile) {
        if (child.extension !== "md") continue;
        if (isReserved(child.path)) continue;
        const fm: Record<string, unknown> =
          this.app.metadataCache.getFileCache(child)?.frontmatter ?? {};
        const fmTitle = fm["title"];
        const fmDesc = fm["description"];
        const title =
          typeof fmTitle === "string" && fmTitle.length > 0
            ? fmTitle
            : basename(child.path);
        const desc = typeof fmDesc === "string" ? fmDesc : "";
        concepts.push({ link: encodeURI(child.name), title, desc });
      } else if (child instanceof TFolder) {
        subdirs.push({ link: encodeURI(child.name) + "/", name: child.name });
      }
    }

    let out = "";
    if (subdirs.length) {
      out += "# Subdirectories\n\n";
      for (const s of subdirs) out += `* [${s.name}](${s.link}) - \n`;
      out += "\n";
    }
    out += "# Concepts\n\n";
    if (concepts.length === 0) out += "_No concepts yet._\n";
    for (const c of concepts) {
      out += `* [${c.title}](${c.link})${c.desc ? " - " + c.desc : ""}\n`;
    }

    const indexPath =
      folder.path === "/" || folder.path === ""
        ? "index.md"
        : `${folder.path}/index.md`;
    const existing = this.app.vault.getAbstractFileByPath(indexPath);
    if (existing instanceof TFile) {
      const current = await this.app.vault.read(existing);
      if (current === out) return;
      this.selfWrites.add(indexPath);
      await this.app.vault.modify(existing, out);
    } else {
      this.selfWrites.add(indexPath);
      await this.app.vault.create(indexPath, out);
    }
    if (notify) new Notice(`OKF: wrote ${indexPath}`);
  }

  async generateAllIndexes() {
    if (this.busy) {
      new Notice("OKF: a scan/fix is already running…");
      return;
    }
    this.busy = true;
    try {
      const folders = new Set<TFolder>();
      for (const f of this.candidateFiles()) {
        if (f.parent) folders.add(f.parent);
      }
      const list = [...folders];
      await this.processQueue(
        list,
        (folder) => this.generateIndexForFolder(folder, false),
        "OKF: building indexes"
      );
      new Notice(`OKF: refreshed index.md in ${list.length} folder(s).`);
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
      this.app.workspace.revealLeaf(leaf);
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

type OkfSettingSpec = {
  name: string;
  desc?: string;
  heading?: boolean;
  portentDependent?: boolean;
  control?: (row: Setting) => void;
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
    const save = () => this.plugin.saveSettings();
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
            t.setValue(s.defaultType).onChange(async (v) => {
              s.defaultType = v || "Concept";
              await save();
            })
          ),
      },
      {
        name: "Live check on save / open",
        desc: "Validate the active note as you edit and when you open it.",
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.liveCheckOnSave).onChange(async (v) => {
              s.liveCheckOnSave = v;
              await save();
            })
          ),
      },
      { name: "Automation", heading: true },
      {
        name: "Scan vault on startup",
        desc: "Run a full conformance scan automatically when the plugin loads (deferred until the workspace is ready).",
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.scanOnStartup).onChange(async (v) => {
              s.scanOnStartup = v;
              await save();
            })
          ),
      },
      {
        name: "Fix format issues on save",
        desc: "When you edit a note, auto-insert missing OKF frontmatter (type/title/timestamp). Non-destructive; never overwrites existing values.",
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.fixOnSave).onChange(async (v) => {
              s.fixOnSave = v;
              await save();
            })
          ),
      },
      {
        name: "Auto-generate index.md",
        desc: "Regenerate a folder's index.md (§6 listing) automatically when its notes change.",
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.autoGenerateIndex).onChange(async (v) => {
              s.autoGenerateIndex = v;
              await save();
            })
          ),
      },
      {
        name: "Batch size",
        desc: "Files processed per async chunk during scan/fix. Lower = smoother UI on large vaults; higher = faster.",
        control: (row) =>
          row.addText((t) =>
            t.setValue(String(s.batchSize)).onChange(async (v) => {
              const n = parseInt(v, 10);
              s.batchSize = isNaN(n) || n < 1 ? 50 : Math.min(n, 1000);
              await save();
            })
          ),
      },
      { name: "Rules", heading: true },
      {
        name: "Warn on missing recommended fields",
        desc: "title, description, timestamp (§4.1).",
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.warnRecommendedFields).onChange(async (v) => {
              s.warnRecommendedFields = v;
              await save();
            })
          ),
      },
      {
        name: "Warn on missing tags",
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.warnTagsField).onChange(async (v) => {
              s.warnTagsField = v;
              await save();
            })
          ),
      },
      {
        name: "Check reserved files (index.md / log.md)",
        desc: "Validate §6 and §7 structure.",
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.checkReservedFiles).onChange(async (v) => {
              s.checkReservedFiles = v;
              await save();
            })
          ),
      },
      {
        name: "Excluded folders",
        desc: "Comma-separated paths skipped during validation.",
        control: (row) =>
          row.addText((t) =>
            t.setValue(s.excludeFolders.join(", ")).onChange(async (v) => {
              s.excludeFolders = list(v);
              await save();
            })
          ),
      },
      { name: "Portent", heading: true },
      {
        name: "Enable Portent validation",
        desc: "Experimental (beta) — the Portent spec is pre-1.0 and may still change. Additionally validate notes against the Portent spec (portent.md): default type vocabulary (Project, Operation, Responsibility, Task, Event, Note, Topic, Person), lifecycle metadata (optional and format-free; status / organized / archived, or omitted when organized by default), and relationship shape (belongs_to, related_to as wikilinks). All Portent findings are warnings — they never block OKF conformance.",
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.enablePortent).onChange(async (v) => {
              s.enablePortent = v;
              await save();
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
            tg.setValue(s.portentCheckTypeVocab).onChange(async (v) => {
              s.portentCheckTypeVocab = v;
              await save();
            })
          ),
      },
      {
        name: "Validate lifecycle",
        desc: "Check lifecycle values when present (status maps to the configured set; `organized`/`archived` are booleans). A missing lifecycle is never flagged.",
        portentDependent: true,
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.portentCheckLifecycle).onChange(async (v) => {
              s.portentCheckLifecycle = v;
              await save();
            })
          ),
      },
      {
        name: "Validate belongs_to",
        desc: "Check `belongs_to` shape when present (a single wikilink to the primary parent).",
        portentDependent: true,
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.portentCheckBelongsTo).onChange(async (v) => {
              s.portentCheckBelongsTo = v;
              await save();
            })
          ),
      },
      {
        name: "Validate related_to",
        desc: "Check `related_to` shape when present (a list of wikilinks).",
        portentDependent: true,
        control: (row) =>
          row.addToggle((tg) =>
            tg.setValue(s.portentCheckRelatedTo).onChange(async (v) => {
              s.portentCheckRelatedTo = v;
              await save();
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
            t.setValue(s.portentTypes.join(", ")).onChange(async (v) => {
              const l = list(v);
              s.portentTypes = l.length ? l : [...PORTENT_TYPES];
              await save();
            })
          ),
      },
      {
        name: "Lifecycle status field",
        desc: "Frontmatter key holding the single lifecycle value (default `status`; e.g. rename to `state`).",
        portentDependent: true,
        control: (row) =>
          row.addText((t) =>
            t.setValue(s.portentStatusField).onChange(async (v) => {
              s.portentStatusField = v.trim() || "status";
              await save();
            })
          ),
      },
      {
        name: "Lifecycle status values",
        desc: "Comma-separated accepted values for the status field.",
        portentDependent: true,
        control: (row) =>
          row.addText((t) =>
            t.setValue(s.portentStatuses.join(", ")).onChange(async (v) => {
              const l = list(v);
              s.portentStatuses = l.length ? l : [...PORTENT_STATUSES];
              await save();
            })
          ),
      },
      {
        name: "Organized field",
        desc: "Frontmatter key for the boolean `organized` lifecycle flag.",
        portentDependent: true,
        control: (row) =>
          row.addText((t) =>
            t.setValue(s.portentOrganizedField).onChange(async (v) => {
              s.portentOrganizedField = v.trim() || "organized";
              await save();
            })
          ),
      },
      {
        name: "Archived field",
        desc: "Frontmatter key for the boolean `archived` lifecycle flag.",
        portentDependent: true,
        control: (row) =>
          row.addText((t) =>
            t.setValue(s.portentArchivedField).onChange(async (v) => {
              s.portentArchivedField = v.trim() || "archived";
              await save();
            })
          ),
      },
      {
        name: "Belongs-to field",
        desc: "Frontmatter key for the single-parent relationship (a wikilink).",
        portentDependent: true,
        control: (row) =>
          row.addText((t) =>
            t.setValue(s.portentBelongsToField).onChange(async (v) => {
              s.portentBelongsToField = v.trim() || "belongs_to";
              await save();
            })
          ),
      },
      {
        name: "Related-to field",
        desc: "Frontmatter key for the related-notes relationship (a list of wikilinks).",
        portentDependent: true,
        control: (row) =>
          row.addText((t) =>
            t.setValue(s.portentRelatedToField).onChange(async (v) => {
              s.portentRelatedToField = v.trim() || "related_to";
              await save();
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

  /** Imperative rendering — used by Obsidian < 1.13. */
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
