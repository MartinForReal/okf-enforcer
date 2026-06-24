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
  OkfIssue,
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

  async onload() {
    await this.loadSettings();

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
    this.statusEl.onClickEvent(() => this.onStatusClick());

    this.addCommand({
      id: "okf-validate-vault",
      name: "Validate vault (full report)",
      callback: () => this.scanVault(),
    });
    this.addCommand({
      id: "okf-validate-active",
      name: "Validate active note",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || f.extension !== "md") return false;
        if (!checking) this.validateActive(f, true);
        return true;
      },
    });
    this.addCommand({
      id: "okf-fix-active",
      name: "Fix active note (add missing OKF fields)",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || f.extension !== "md") return false;
        if (!checking) this.fixFile(f, true);
        return true;
      },
    });
    this.addCommand({
      id: "okf-fix-all",
      name: "Fix all auto-fixable issues in vault",
      callback: () => this.fixAll(),
    });
    this.addCommand({
      id: "okf-generate-index",
      name: "Generate/refresh index.md for a folder",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f) return false;
        if (!checking) this.generateIndexForFolder(f.parent as TFolder);
        return true;
      },
    });
    this.addCommand({
      id: "okf-generate-all-indexes",
      name: "Generate/refresh index.md for ALL folders",
      callback: () => this.generateAllIndexes(),
    });
    this.addCommand({
      id: "okf-add-log-entry",
      name: "Add log.md entry (current folder)",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f) return false;
        if (!checking) this.addLogEntry(f.parent as TFolder);
        return true;
      },
    });

    const liveCheck = debounce(
      (file: TFile) => {
        this.onFileChanged(file);
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
        if (file && file.extension === "md") this.validateActive(file, false);
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
          window.setTimeout(() => this.onFileChanged(file), 300);
        }
      })
    );

    this.addSettingTab(new OkfSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.layoutReady = true;
      // Panel is hidden by default: if Obsidian restored a saved OKF leaf from
      // a previous session, detach it so the view only appears on demand.
      this.app.workspace.detachLeavesOfType(OKF_VIEW_TYPE);
      if (this.settings.scanOnStartup) {
        // Silent: update the status bar/tooltip only, never open the panel.
        window.setTimeout(() => this.scanVault(false, true), 1500);
      }
    });
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(OKF_VIEW_TYPE);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => !isExcluded(f.path, this.settings));
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
    if (showBar) view?.showProgress(label as string);
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
      this.activateView();
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
    await this.app.fileManager.processFrontMatter(file, (fm: any) => {
      for (const [k, v] of Object.entries(fields)) {
        const val = (v ?? "").trim();
        if (val.length > 0) fm[k] = val;
      }
    });
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
        const cache = this.app.metadataCache.getFileCache(child);
        const fm = cache?.frontmatter || {};
        const title = (fm["title"] as string) || basename(child.path);
        const desc = (fm["description"] as string) || "";
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
        async (folder) => this.generateIndexForFolder(folder, false),
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

class OkfSettingTab extends PluginSettingTab {
  plugin: OkfPlugin;
  constructor(app: App, plugin: OkfPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "OKF Enforcer — settings" });
    containerEl.createEl("p", {
      text: "Targets Open Knowledge Format v0.1. §9 conformance rules are enforced as errors; recommended fields and SHOULD-guidance are warnings you can toggle.",
    });

    new Setting(containerEl)
      .setName("Default type for auto-fix")
      .setDesc("Value inserted into `type` when fixing notes that lack it.")
      .addText((t) =>
        t.setValue(this.plugin.settings.defaultType).onChange(async (v) => {
          this.plugin.settings.defaultType = v || "Concept";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Live check on save / open")
      .setDesc("Validate the active note as you edit and when you open it.")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.liveCheckOnSave).onChange(async (v) => {
          this.plugin.settings.liveCheckOnSave = v;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl("h3", { text: "Automation" });

    new Setting(containerEl)
      .setName("Scan vault on startup")
      .setDesc(
        "Run a full conformance scan automatically when the plugin loads (deferred until the workspace is ready)."
      )
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.scanOnStartup).onChange(async (v) => {
          this.plugin.settings.scanOnStartup = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Fix format issues on save")
      .setDesc(
        "When you edit a note, auto-insert missing OKF frontmatter (type/title/timestamp). Non-destructive; never overwrites existing values."
      )
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.fixOnSave).onChange(async (v) => {
          this.plugin.settings.fixOnSave = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Auto-generate index.md")
      .setDesc(
        "Regenerate a folder's index.md (§6 listing) automatically when its notes change."
      )
      .addToggle((tg) =>
        tg
          .setValue(this.plugin.settings.autoGenerateIndex)
          .onChange(async (v) => {
            this.plugin.settings.autoGenerateIndex = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Batch size")
      .setDesc(
        "Files processed per async chunk during scan/fix. Lower = smoother UI on large vaults; higher = faster."
      )
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.batchSize))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            this.plugin.settings.batchSize =
              isNaN(n) || n < 1 ? 50 : Math.min(n, 1000);
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Rules" });

    new Setting(containerEl)
      .setName("Warn on missing recommended fields")
      .setDesc("title, description, timestamp (§4.1).")
      .addToggle((tg) =>
        tg
          .setValue(this.plugin.settings.warnRecommendedFields)
          .onChange(async (v) => {
            this.plugin.settings.warnRecommendedFields = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Warn on missing tags")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.warnTagsField).onChange(async (v) => {
          this.plugin.settings.warnTagsField = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Check reserved files (index.md / log.md)")
      .setDesc("Validate §6 and §7 structure.")
      .addToggle((tg) =>
        tg
          .setValue(this.plugin.settings.checkReservedFiles)
          .onChange(async (v) => {
            this.plugin.settings.checkReservedFiles = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Excluded folders")
      .setDesc("Comma-separated paths skipped during validation.")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.excludeFolders.join(", "))
          .onChange(async (v) => {
            this.plugin.settings.excludeFolders = v
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          })
      );
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
