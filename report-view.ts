// report-view.ts — compact, collapsible OKF conformance report pane
import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type OkfPlugin from "./main";
import { OkfIssue } from "./validator";

export const OKF_VIEW_TYPE = "okf-report-view";

export interface FileResult {
  path: string;
  issues: OkfIssue[];
}

/** The folder a vault-relative path sits in; "" for a note at the vault root. */
function dirOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut >= 0 ? path.slice(0, cut) : "";
}

function hasError(r: FileResult): boolean {
  return r.issues.some((i) => i.severity === "error");
}

export class OkfReportView extends ItemView {
  plugin: OkfPlugin;
  results: FileResult[] = [];
  scanned = 0;
  /** Paths whose file block is expanded. Default collapsed → empty set. */
  private expanded = new Set<string>();
  /** Folders whose group is collapsed. Default expanded → empty set: a group
   *  header is there to say where its findings live, not to hide them. */
  private collapsed = new Set<string>();
  /** The note in the editor and its findings, held apart from the scan so the
   *  summary keeps counting the vault while this follows the tab. */
  private activePath: string | null = null;
  private activeIssues: OkfIssue[] = [];

  // Persistent skeleton elements (built once, survive list re-renders).
  private progressWrap: HTMLElement | null = null;
  private progressBar: HTMLElement | null = null;
  private progressLabel: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: OkfPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return OKF_VIEW_TYPE;
  }
  getDisplayText() {
    return "OKF conformance";
  }
  getIcon() {
    return "shield-check";
  }

  async onOpen() {
    this.buildSkeleton();
    this.renderBody();
  }

  /** Build the parts that persist across scans (toolbar + progress + body host). */
  private buildSkeleton() {
    const c = this.contentEl;
    c.empty();
    c.addClass("okf-report");

    const toolbar = c.createDiv({ cls: "okf-toolbar" });
    const rescan = toolbar.createEl("button", { text: "Rescan" });
    rescan.setAttribute("aria-label", "Re-scan the whole vault");
    rescan.onclick = () => { void this.plugin.scanVault(); };
    const fixAll = toolbar.createEl("button", { text: "Fix all" });
    fixAll.setAttribute("aria-label", "Auto-fix every fixable issue in the vault");
    fixAll.onclick = () => { void this.plugin.fixAll(); };

    // Progress bar — hidden until a scan/fix is running.
    this.progressWrap = c.createDiv({ cls: "okf-progress is-hidden" });
    const track = this.progressWrap.createDiv({ cls: "okf-progress-track" });
    this.progressBar = track.createDiv({ cls: "okf-progress-bar" });
    this.progressLabel = this.progressWrap.createDiv({ cls: "okf-progress-label" });

    this.bodyEl = c.createDiv({ cls: "okf-body" });
  }

  // ---- progress API (driven by the plugin's processQueue) ----
  showProgress(label: string) {
    if (!this.progressWrap) this.buildSkeleton();
    this.progressWrap?.removeClass("is-hidden");
    this.setProgress(0, label);
  }
  setProgress(fraction: number, label?: string) {
    const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
    // Drive width via a CSS custom property (styles.css consumes --okf-pct),
    // avoiding direct static-style manipulation flagged by plugin review.
    if (this.progressBar)
      this.progressBar.style.setProperty("--okf-pct", `${pct}%`);
    if (this.progressWrap)
      this.progressWrap.setAttribute("aria-valuenow", String(pct));
    if (label && this.progressLabel)
      this.progressLabel.setText(`${label} — ${pct}%`);
  }
  hideProgress() {
    this.progressWrap?.addClass("is-hidden");
  }

  setResults(results: FileResult[], scanned: number) {
    this.results = results;
    this.scanned = scanned;
    const paths = new Set(results.map((r) => r.path));
    for (const p of [...this.expanded]) if (!paths.has(p)) this.expanded.delete(p);
    const dirs = new Set(results.map((r) => dirOf(r.path)));
    for (const d of [...this.collapsed]) if (!dirs.has(d)) this.collapsed.delete(d);
    this.renderBody();
  }

  /** Point the pane at the note in the editor. Pass null when what is open is
   *  not a markdown note. */
  setActive(path: string | null, issues: OkfIssue[]) {
    this.activePath = path;
    this.activeIssues = issues;
    this.renderBody();
  }

  /** Re-render only the summary + file list (leaves toolbar/progress intact). */
  private renderBody() {
    if (!this.bodyEl) {
      this.buildSkeleton();
    }
    const b = this.bodyEl!;
    b.empty();
    this.renderSummary(b);
    this.renderActive(b);
    this.renderList(b);
  }

  private renderSummary(b: HTMLElement) {
    const errorFiles = this.results.filter(hasError).length;
    const warnFiles = this.results.length - errorFiles;
    const passFiles = this.scanned - this.results.length;

    const summary = b.createDiv({ cls: "okf-summary" });
    summary.createSpan({ cls: "okf-chip okf-pass", text: `✓ ${passFiles}` });
    summary.createSpan({ cls: "okf-chip okf-error", text: `✖ ${errorFiles}` });
    summary.createSpan({ cls: "okf-chip okf-warn", text: `⚠ ${warnFiles}` });
  }

  /**
   * The note in the editor, listed open in a section of its own. Hunting the
   * vault list for the row of the note you are already looking at is the long
   * way round, and it only works if that note happened to be failing when the
   * last scan ran — before the first scan there is no list to hunt at all.
   */
  private renderActive(b: HTMLElement) {
    const path = this.activePath;
    if (!path) return;

    const sec = b.createDiv({ cls: "okf-active" });
    sec.createDiv({ cls: "okf-active-title", text: "Active note" });

    // Said out loud rather than left blank: an empty section reads as a pane
    // that has lost track of the tab, not as a note with nothing wrong.
    if (!this.activeIssues.length) {
      const line = sec.createDiv({ cls: "okf-active-clean" });
      line.setAttribute("aria-label", `${path} — no issues`);
      line.createSpan({ cls: "okf-ok", text: "✓" });
      this.renderLabel(line, path, true);
      return;
    }

    this.renderFileBlock(sec, { path, issues: this.activeIssues }, "active");
  }

  private renderList(b: HTMLElement) {
    if (this.scanned === 0) {
      b.createDiv({ cls: "okf-empty", text: "No scan yet — click Rescan." });
      return;
    }
    if (this.results.length === 0) {
      b.createDiv({ cls: "okf-empty", text: "✓ All notes conform." });
      return;
    }

    // Grouped by folder: with the full path on every row, a folder with a
    // dozen findings spends most of a sidebar's width repeating its own name.
    // The header carries the folder once and the rows under it carry names.
    const groups = new Map<string, FileResult[]>();
    for (const r of this.results) {
      const dir = dirOf(r.path);
      const at = groups.get(dir);
      if (at) at.push(r);
      else groups.set(dir, [r]);
    }

    // Errors first at both levels, then alphabetical: the folder holding the
    // worst news sorts to the top, and the order survives a rescan.
    const dirs = [...groups.keys()].sort((a, b2) => {
      const ae = groups.get(a)!.some(hasError) ? 0 : 1;
      const be = groups.get(b2)!.some(hasError) ? 0 : 1;
      if (ae !== be) return ae - be;
      return a.localeCompare(b2);
    });

    const list = b.createDiv({ cls: "okf-list" });
    for (const dir of dirs) {
      const rows = groups.get(dir)!.sort((a, b2) => {
        const ae = hasError(a) ? 0 : 1;
        const be = hasError(b2) ? 0 : 1;
        if (ae !== be) return ae - be;
        return a.path.localeCompare(b2.path);
      });
      const isOpen = !this.collapsed.has(dir);
      const group = list.createDiv({ cls: "okf-group" });

      const head = group.createDiv({ cls: "okf-group-head" });
      head.setAttribute("aria-label", dir || "Vault root");
      head.createSpan({ cls: "okf-caret", text: isOpen ? "▾" : "▸" });
      head.createSpan({ cls: "okf-group-name", text: dir ? `${dir}/` : "/" });
      head.createSpan({
        cls: "okf-count",
        text: String(rows.reduce((n, r) => n + r.issues.length, 0)),
      });
      head.onclick = () => {
        if (this.collapsed.has(dir)) this.collapsed.delete(dir);
        else this.collapsed.add(dir);
        this.renderBody();
      };

      if (!isOpen) continue;
      const body = group.createDiv({ cls: "okf-group-body" });
      for (const r of rows) this.renderFileBlock(body, r, "list");
    }
  }

  /**
   * One file's findings. In the list the group header above already names the
   * folder, so the row shows the file name alone; the active-note section
   * stands on its own and shows the whole path. Either way the head's
   * aria-label is the full path, so nothing has to reconstruct it from
   * whatever happens to be rendered above.
   */
  private renderFileBlock(
    host: HTMLElement,
    r: FileResult,
    mode: "list" | "active"
  ) {
    const inList = mode === "list";
    const isErr = hasError(r);
    const isOpen = inList ? this.expanded.has(r.path) : true;
    const block = host.createDiv({ cls: "okf-file-block" });

    const head = block.createDiv({ cls: "okf-file-head" });
    head.setAttribute("aria-label", r.path);
    // Blank rather than absent where there is nothing to toggle: the caret's
    // width is what holds the issue rows below in line with the list's.
    head.createSpan({
      cls: "okf-caret",
      text: inList ? (isOpen ? "▾" : "▸") : "",
    });
    head.createSpan({ cls: `okf-dot ${isErr ? "error" : "warning"}` });
    this.renderLabel(head, r.path, !inList);
    head.createSpan({ cls: "okf-count", text: String(r.issues.length) });

    if (inList)
      head.onclick = () => {
        if (this.expanded.has(r.path)) this.expanded.delete(r.path);
        else this.expanded.add(r.path);
        this.renderBody();
      };

    if (!isOpen) return;

    const body = block.createDiv({ cls: "okf-issues" });
    for (const issue of r.issues) {
      const row = body.createDiv({ cls: "okf-issue" });
      row.createSpan({
        cls: `okf-sev ${issue.severity}`,
        text: issue.severity === "error" ? "✖" : "⚠",
      });
      const txt = row.createSpan({ cls: "okf-issue-text" });
      txt.createSpan({ text: issue.message + " " });
      txt.createSpan({ cls: "okf-rule", text: issue.rule });
      if (issue.fix) txt.createSpan({ cls: "okf-fixable", text: " · fixable" });
    }

    // Offered only when there is something to open, and never for the note
    // already in the editor. A gap report names the index.md a folder hasn't
    // got, and a button that silently does nothing reads as a broken pane
    // rather than as a file that isn't there.
    if (!inList) return;
    const target = this.app.vault.getAbstractFileByPath(r.path);
    if (target instanceof TFile) {
      const open = block.createEl("a", {
        cls: "okf-open-link",
        text: "Open note →",
      });
      open.onclick = (e) => {
        e.preventDefault();
        void this.app.workspace.getLeaf(false).openFile(target);
      };
    }
  }

  /**
   * A path as a muted folder part plus the file name, or the name alone when
   * the group header above already carries the folder. The folder part is what
   * gives way when the pane is narrow, so the name stays readable at any width.
   */
  private renderLabel(head: HTMLElement, path: string, withDir: boolean) {
    const cut = path.lastIndexOf("/");
    const label = head.createSpan({ cls: "okf-file-label" });
    if (withDir && cut >= 0)
      label.createSpan({ cls: "okf-file-dir", text: path.slice(0, cut + 1) });
    label.createSpan({ cls: "okf-file-name", text: path.slice(cut + 1) });
  }
}
