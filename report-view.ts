// report-view.ts — compact, collapsible OKF conformance report pane
import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type OkfPlugin from "./main";
import { OkfIssue } from "./validator";

export const OKF_VIEW_TYPE = "okf-report-view";

export interface FileResult {
  path: string;
  issues: OkfIssue[];
}

export class OkfReportView extends ItemView {
  plugin: OkfPlugin;
  results: FileResult[] = [];
  scanned = 0;
  /** Paths whose group is expanded. Default collapsed → empty set. */
  private expanded = new Set<string>();

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
    rescan.onclick = () => this.plugin.scanVault();
    const fixAll = toolbar.createEl("button", { text: "Fix all" });
    fixAll.setAttribute("aria-label", "Auto-fix every fixable issue in the vault");
    fixAll.onclick = () => this.plugin.fixAll();

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
    this.renderBody();
  }

  /** Re-render only the summary + file list (leaves toolbar/progress intact). */
  private renderBody() {
    if (!this.bodyEl) {
      this.buildSkeleton();
    }
    const b = this.bodyEl!;
    b.empty();

    const errorFiles = this.results.filter((r) =>
      r.issues.some((i) => i.severity === "error")
    ).length;
    const warnFiles = this.results.length - errorFiles;
    const passFiles = this.scanned - this.results.length;

    const summary = b.createDiv({ cls: "okf-summary" });
    summary.createSpan({ cls: "okf-chip okf-pass", text: `✓ ${passFiles}` });
    summary.createSpan({ cls: "okf-chip okf-error", text: `✖ ${errorFiles}` });
    summary.createSpan({ cls: "okf-chip okf-warn", text: `⚠ ${warnFiles}` });

    if (this.scanned === 0) {
      b.createEl("div", { cls: "okf-empty", text: "No scan yet — click Rescan." });
      return;
    }
    if (this.results.length === 0) {
      b.createEl("div", { cls: "okf-empty", text: "✓ All notes conform." });
      return;
    }

    const sorted = [...this.results].sort((a, b2) => {
      const ae = a.issues.some((i) => i.severity === "error") ? 0 : 1;
      const be = b2.issues.some((i) => i.severity === "error") ? 0 : 1;
      if (ae !== be) return ae - be;
      return a.path.localeCompare(b2.path);
    });

    const list = b.createDiv({ cls: "okf-list" });
    for (const r of sorted) {
      const isErr = r.issues.some((i) => i.severity === "error");
      const isOpen = this.expanded.has(r.path);
      const block = list.createDiv({ cls: "okf-file-block" });

      const head = block.createDiv({ cls: "okf-file-head" });
      head.setAttribute("aria-label", r.path);
      head.createSpan({ cls: "okf-caret", text: isOpen ? "▾" : "▸" });
      head.createSpan({ cls: `okf-dot ${isErr ? "error" : "warning"}` });
      const name = r.path.split("/").pop() || r.path;
      head.createSpan({ cls: "okf-file-name", text: name });
      head.createSpan({ cls: "okf-count", text: String(r.issues.length) });

      head.onclick = () => {
        if (this.expanded.has(r.path)) this.expanded.delete(r.path);
        else this.expanded.add(r.path);
        this.renderBody();
      };

      if (isOpen) {
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
        const open = block.createEl("a", {
          cls: "okf-open-link",
          text: "Open note →",
        });
        open.onclick = (e) => {
          e.preventDefault();
          const f = this.app.vault.getAbstractFileByPath(r.path);
          if (f instanceof TFile) this.app.workspace.getLeaf(false).openFile(f);
        };
      }
    }
  }
}
