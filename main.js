var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => OkfPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// validator.ts
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  defaultType: "Concept",
  warnRecommendedFields: true,
  warnTagsField: false,
  warnBrokenLinks: false,
  checkReservedFiles: true,
  liveCheckOnSave: true,
  scanOnStartup: true,
  fixOnSave: true,
  autoGenerateIndex: true,
  batchSize: 50,
  excludeFolders: ["Templates"]
};
var FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
var ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function basename(path) {
  const f = path.split("/").pop() || path;
  return f.replace(/\.md$/i, "");
}
function isReserved(path) {
  const f = (path.split("/").pop() || "").toLowerCase();
  if (f === "index.md") return "index";
  if (f === "log.md") return "log";
  return null;
}
function isExcluded(path, settings) {
  return settings.excludeFolders.some(
    (folder) => folder && (path === folder || path.startsWith(folder + "/"))
  );
}
function splitFrontmatter(content) {
  const m = content.match(FM_RE);
  if (!m) return { hasFm: false, raw: "", body: content };
  return { hasFm: true, raw: m[1], body: content.slice(m[0].length) };
}
function validateContent(path, content, isRoot, settings) {
  const reserved = isReserved(path);
  if (reserved === "index") return validateIndex(content, isRoot, settings);
  if (reserved === "log") return validateLog(content, settings);
  return validateConcept(path, content, settings);
}
function validateConcept(path, content, settings) {
  const issues = [];
  const { hasFm, raw } = splitFrontmatter(content);
  if (!hasFm) {
    issues.push({
      severity: "error",
      rule: "\xA79.1",
      message: "No YAML frontmatter block. Every OKF concept must begin with a `---` delimited frontmatter block.",
      fix: "add-frontmatter"
    });
    return issues;
  }
  let data = {};
  try {
    const parsed = (0, import_obsidian.parseYaml)(raw);
    if (parsed && typeof parsed === "object") {
      data = parsed;
    }
  } catch (e) {
    issues.push({
      severity: "error",
      rule: "\xA79.1",
      message: `Frontmatter is not parseable YAML: ${e.message || e}`
    });
    return issues;
  }
  const type = data["type"];
  const typeOk = typeof type === "string" && type.trim().length > 0;
  if (!typeOk) {
    issues.push({
      severity: "error",
      rule: "\xA79.2",
      message: type === void 0 ? "Missing required `type` field." : "`type` field is present but empty. It must be a non-empty string.",
      fix: "add-type"
    });
  }
  if (settings.warnRecommendedFields) {
    if (!hasNonEmpty(data, "title")) {
      issues.push({
        severity: "warning",
        rule: "\xA74.1",
        message: "Recommended `title` missing. Consumers may fall back to the filename.",
        fix: "add-title"
      });
    }
    if (!hasNonEmpty(data, "description")) {
      issues.push({
        severity: "warning",
        rule: "\xA74.1",
        message: "Recommended `description` (one-line summary) missing. Used in index listings, search snippets, and previews."
      });
    }
    if (!hasNonEmpty(data, "timestamp")) {
      issues.push({
        severity: "warning",
        rule: "\xA74.1",
        message: "Recommended `timestamp` (ISO 8601 last-modified) missing.",
        fix: "add-timestamp"
      });
    } else if (typeof data["timestamp"] === "string" && isNaN(Date.parse(data["timestamp"]))) {
      issues.push({
        severity: "warning",
        rule: "\xA74.1",
        message: "`timestamp` is not a parseable ISO 8601 datetime."
      });
    }
  }
  if (settings.warnTagsField && !("tags" in data)) {
    issues.push({
      severity: "warning",
      rule: "\xA74.1",
      message: "Recommended `tags` list missing."
    });
  }
  return issues;
}
function validateIndex(content, isRoot, settings) {
  const issues = [];
  if (!settings.checkReservedFiles) return issues;
  const split = splitFrontmatter(content);
  const hasFm = split.hasFm;
  const raw = split.raw;
  if (hasFm) {
    if (!isRoot) {
      issues.push({
        severity: "error",
        rule: "\xA76",
        message: "Non-root `index.md` must not contain frontmatter (\xA76). Only the bundle-root index.md may, and only for `okf_version`."
      });
    } else {
      let data = {};
      try {
        const parsed = (0, import_obsidian.parseYaml)(raw);
        if (parsed && typeof parsed === "object") {
          data = parsed;
        }
      } catch (e) {
        issues.push({
          severity: "error",
          rule: "\xA711",
          message: "Root `index.md` frontmatter is not parseable YAML."
        });
        return issues;
      }
      const keys = Object.keys(data);
      const extra = keys.filter((k) => k !== "okf_version");
      if (extra.length > 0) {
        issues.push({
          severity: "error",
          rule: "\xA711",
          message: `Root index.md frontmatter may only contain \`okf_version\`. Unexpected key(s): ${extra.join(
            ", "
          )}.`
        });
      }
      if ("okf_version" in data && String(data["okf_version"]) !== "0.1") {
        issues.push({
          severity: "warning",
          rule: "\xA711",
          message: `Declared okf_version "${data["okf_version"]}" is not "0.1" (this validator targets v0.1).`
        });
      }
    }
  }
  const body = hasFm ? split.body : content;
  const hasHeading = /^#{1,6}\s+\S/m.test(body);
  const hasLinkBullet = /^\s*[*-]\s+\[[^\]]+\]\([^)]+\)/m.test(body);
  if (body.trim().length > 0 && !hasLinkBullet) {
    issues.push({
      severity: "warning",
      rule: "\xA76",
      message: "`index.md` should list directory contents as bulleted markdown links grouped under section headings (progressive disclosure)."
    });
  } else if (hasLinkBullet && !hasHeading) {
    issues.push({
      severity: "warning",
      rule: "\xA76",
      message: "`index.md` entries should be grouped under at least one section heading."
    });
  }
  return issues;
}
function validateLog(content, settings) {
  const issues = [];
  if (!settings.checkReservedFiles) return issues;
  const { hasFm } = splitFrontmatter(content);
  if (hasFm) {
    issues.push({
      severity: "warning",
      rule: "\xA77",
      message: "`log.md` is not expected to contain frontmatter."
    });
  }
  const h2s = [...content.matchAll(/^##\s+(.+?)\s*$/gm)].map(
    (m) => m[1].trim()
  );
  if (h2s.length === 0) {
    issues.push({
      severity: "warning",
      rule: "\xA77",
      message: "`log.md` should contain date-grouped entries under `## YYYY-MM-DD` headings."
    });
    return issues;
  }
  const dates = [];
  for (const h of h2s) {
    if (!ISO_DATE_RE.test(h)) {
      issues.push({
        severity: "error",
        rule: "\xA77",
        message: `Log date heading "## ${h}" must be ISO 8601 \`YYYY-MM-DD\`.`
      });
    } else {
      dates.push(h);
    }
  }
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] > dates[i - 1]) {
      issues.push({
        severity: "warning",
        rule: "\xA77",
        message: `Log entries should be newest-first; "${dates[i]}" appears after "${dates[i - 1]}".`
      });
      break;
    }
  }
  return issues;
}
function hasNonEmpty(data, key) {
  const v = data[key];
  if (v === void 0 || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
function applyFixes(path, content, issues, settings) {
  const applied = [];
  const fixes = new Set(issues.filter((i) => i.fix).map((i) => i.fix));
  if (fixes.size === 0) return { content, applied };
  const nowIso = (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  const title = basename(path);
  const split = splitFrontmatter(content);
  if (!split.hasFm) {
    const lines = [
      `type: ${settings.defaultType}`,
      `title: ${title}`,
      `timestamp: ${nowIso}`
    ];
    const fm = `---
${lines.join("\n")}
---

`;
    applied.push("added frontmatter (type, title, timestamp)");
    return { content: fm + content.replace(/^\s+/, ""), applied };
  }
  const fmLines = split.raw.split(/\r?\n/);
  const body = split.body;
  const hasKey = (k) => fmLines.some((l) => new RegExp(`^${k}\\s*:`).test(l.trim()));
  if (fixes.has("add-type") && !hasKey("type")) {
    fmLines.unshift(`type: ${settings.defaultType}`);
    applied.push(`added type: ${settings.defaultType}`);
  }
  if (fixes.has("add-title") && !hasKey("title")) {
    fmLines.push(`title: ${title}`);
    applied.push("added title");
  }
  if (fixes.has("add-timestamp") && !hasKey("timestamp")) {
    fmLines.push(`timestamp: ${nowIso}`);
    applied.push("added timestamp");
  }
  const rebuilt = `---
${fmLines.join("\n")}
---${body}`;
  return { content: rebuilt, applied };
}

// report-view.ts
var import_obsidian2 = require("obsidian");
var OKF_VIEW_TYPE = "okf-report-view";
var OkfReportView = class extends import_obsidian2.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.results = [];
    this.scanned = 0;
    /** Paths whose group is expanded. Default collapsed → empty set. */
    this.expanded = /* @__PURE__ */ new Set();
    // Persistent skeleton elements (built once, survive list re-renders).
    this.progressWrap = null;
    this.progressBar = null;
    this.progressLabel = null;
    this.bodyEl = null;
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
  buildSkeleton() {
    const c = this.contentEl;
    c.empty();
    c.addClass("okf-report");
    const toolbar = c.createDiv({ cls: "okf-toolbar" });
    const rescan = toolbar.createEl("button", { text: "Rescan" });
    rescan.setAttribute("aria-label", "Re-scan the whole vault");
    rescan.onclick = () => {
      void this.plugin.scanVault();
    };
    const fixAll = toolbar.createEl("button", { text: "Fix all" });
    fixAll.setAttribute("aria-label", "Auto-fix every fixable issue in the vault");
    fixAll.onclick = () => {
      void this.plugin.fixAll();
    };
    this.progressWrap = c.createDiv({ cls: "okf-progress is-hidden" });
    const track = this.progressWrap.createDiv({ cls: "okf-progress-track" });
    this.progressBar = track.createDiv({ cls: "okf-progress-bar" });
    this.progressLabel = this.progressWrap.createDiv({ cls: "okf-progress-label" });
    this.bodyEl = c.createDiv({ cls: "okf-body" });
  }
  // ---- progress API (driven by the plugin's processQueue) ----
  showProgress(label) {
    var _a;
    if (!this.progressWrap) this.buildSkeleton();
    (_a = this.progressWrap) == null ? void 0 : _a.removeClass("is-hidden");
    this.setProgress(0, label);
  }
  setProgress(fraction, label) {
    const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
    if (this.progressBar)
      this.progressBar.style.setProperty("--okf-pct", `${pct}%`);
    if (this.progressWrap)
      this.progressWrap.setAttribute("aria-valuenow", String(pct));
    if (label && this.progressLabel)
      this.progressLabel.setText(`${label} \u2014 ${pct}%`);
  }
  hideProgress() {
    var _a;
    (_a = this.progressWrap) == null ? void 0 : _a.addClass("is-hidden");
  }
  setResults(results, scanned) {
    this.results = results;
    this.scanned = scanned;
    const paths = new Set(results.map((r) => r.path));
    for (const p of [...this.expanded]) if (!paths.has(p)) this.expanded.delete(p);
    this.renderBody();
  }
  /** Re-render only the summary + file list (leaves toolbar/progress intact). */
  renderBody() {
    if (!this.bodyEl) {
      this.buildSkeleton();
    }
    const b = this.bodyEl;
    b.empty();
    const errorFiles = this.results.filter(
      (r) => r.issues.some((i) => i.severity === "error")
    ).length;
    const warnFiles = this.results.length - errorFiles;
    const passFiles = this.scanned - this.results.length;
    const summary = b.createDiv({ cls: "okf-summary" });
    summary.createSpan({ cls: "okf-chip okf-pass", text: `\u2713 ${passFiles}` });
    summary.createSpan({ cls: "okf-chip okf-error", text: `\u2716 ${errorFiles}` });
    summary.createSpan({ cls: "okf-chip okf-warn", text: `\u26A0 ${warnFiles}` });
    if (this.scanned === 0) {
      b.createEl("div", { cls: "okf-empty", text: "No scan yet \u2014 click Rescan." });
      return;
    }
    if (this.results.length === 0) {
      b.createEl("div", { cls: "okf-empty", text: "\u2713 All notes conform." });
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
      head.createSpan({ cls: "okf-caret", text: isOpen ? "\u25BE" : "\u25B8" });
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
            text: issue.severity === "error" ? "\u2716" : "\u26A0"
          });
          const txt = row.createSpan({ cls: "okf-issue-text" });
          txt.createSpan({ text: issue.message + " " });
          txt.createSpan({ cls: "okf-rule", text: issue.rule });
          if (issue.fix) txt.createSpan({ cls: "okf-fixable", text: " \xB7 fixable" });
        }
        const open = block.createEl("a", {
          cls: "okf-open-link",
          text: "Open note \u2192"
        });
        open.onclick = (e) => {
          e.preventDefault();
          const f = this.app.vault.getAbstractFileByPath(r.path);
          if (f instanceof import_obsidian2.TFile) void this.app.workspace.getLeaf(false).openFile(f);
        };
      }
    }
  }
};

// main.ts
var OkfPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.selfWrites = /* @__PURE__ */ new Set();
    this.dirtyIndexFolders = /* @__PURE__ */ new Set();
    this.busy = false;
    this.layoutReady = false;
    this.lastSummary = null;
    this.pendingResults = null;
    this.flushIndexes = (0, import_obsidian3.debounce)(
      async () => {
        if (!this.settings.autoGenerateIndex) return;
        const folders = [...this.dirtyIndexFolders];
        this.dirtyIndexFolders.clear();
        for (const path of folders) {
          const folder = this.app.vault.getAbstractFileByPath(path);
          if (folder instanceof import_obsidian3.TFolder) {
            await this.generateIndexForFolder(folder, false);
          }
        }
      },
      1500,
      true
    );
  }
  onload() {
    this.settings = { ...DEFAULT_SETTINGS };
    void this.loadSettings();
    this.registerView(OKF_VIEW_TYPE, (leaf) => new OkfReportView(leaf, this));
    this.statusEl = this.addStatusBarItem();
    this.statusEl.setText("OKF: \u2014");
    this.statusEl.addClass("mod-clickable");
    this.statusEl.setAttribute(
      "aria-label",
      "OKF \u2014 click to auto-fix this note"
    );
    this.statusEl.onClickEvent(() => {
      void this.onStatusClick();
    });
    this.addCommand({
      id: "okf-validate-vault",
      name: "Validate vault (full report)",
      callback: () => {
        void this.scanVault();
      }
    });
    this.addCommand({
      id: "okf-validate-active",
      name: "Validate active note",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || f.extension !== "md") return false;
        if (!checking) void this.validateActive(f, true);
        return true;
      }
    });
    this.addCommand({
      id: "okf-fix-active",
      name: "Fix active note (add missing OKF fields)",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || f.extension !== "md") return false;
        if (!checking) void this.fixFile(f, true);
        return true;
      }
    });
    this.addCommand({
      id: "okf-fix-all",
      name: "Fix all auto-fixable issues in vault",
      callback: () => {
        void this.fixAll();
      }
    });
    this.addCommand({
      id: "okf-generate-index",
      name: "Generate/refresh index.md for a folder",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || !(f.parent instanceof import_obsidian3.TFolder)) return false;
        if (!checking) void this.generateIndexForFolder(f.parent);
        return true;
      }
    });
    this.addCommand({
      id: "okf-generate-all-indexes",
      name: "Generate/refresh index.md for ALL folders",
      callback: () => {
        void this.generateAllIndexes();
      }
    });
    this.addCommand({
      id: "okf-add-log-entry",
      name: "Add log.md entry (current folder)",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || !(f.parent instanceof import_obsidian3.TFolder)) return false;
        if (!checking) void this.addLogEntry(f.parent);
        return true;
      }
    });
    const liveCheck = (0, import_obsidian3.debounce)(
      (file) => {
        void this.onFileChanged(file);
      },
      500,
      true
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof import_obsidian3.TFile && file.extension === "md") {
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
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (!this.layoutReady) return;
        if (file instanceof import_obsidian3.TFile && file.extension === "md") {
          if (this.selfWrites.has(file.path)) {
            this.selfWrites.delete(file.path);
            return;
          }
          window.setTimeout(() => {
            void this.onFileChanged(file);
          }, 300);
        }
      })
    );
    this.addSettingTab(new OkfSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => {
      this.layoutReady = true;
      if (this.settings.scanOnStartup) {
        window.setTimeout(() => {
          void this.scanVault(false, true);
        }, 1500);
      }
    });
  }
  onunload() {
  }
  async loadSettings() {
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved != null ? saved : {});
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  isConcept(file) {
    if (file.extension !== "md") return false;
    if (isExcluded(file.path, this.settings)) return false;
    return true;
  }
  isRoot(file) {
    return !file.path.includes("/");
  }
  candidateFiles() {
    const configDir = this.app.vault.configDir;
    return this.app.vault.getMarkdownFiles().filter(
      (f) => !f.path.startsWith(configDir + "/") && !isExcluded(f.path, this.settings)
    );
  }
  /** Current report view, if open. */
  getReportView() {
    const leaf = this.app.workspace.getLeavesOfType(OKF_VIEW_TYPE)[0];
    return leaf && leaf.view instanceof OkfReportView ? leaf.view : null;
  }
  async processQueue(items, worker, label) {
    const size = Math.max(1, this.settings.batchSize | 0);
    const showBar = !!label && items.length > size;
    const view = showBar ? this.getReportView() : null;
    if (showBar && label) view == null ? void 0 : view.showProgress(label);
    const baseStatus = this.statusEl.getText();
    for (let i = 0; i < items.length; i += size) {
      const batch = items.slice(i, i + size);
      await Promise.all(batch.map((it) => worker(it).catch(() => {
      })));
      if (showBar) {
        const done = Math.min(i + size, items.length);
        const frac = done / items.length;
        view == null ? void 0 : view.setProgress(frac, label);
        this.statusEl.setText(`OKF ${Math.round(frac * 100)}%`);
      }
      await new Promise((r) => window.setTimeout(r, 0));
    }
    if (showBar) {
      view == null ? void 0 : view.hideProgress();
      this.statusEl.setText(baseStatus);
    }
  }
  async onFileChanged(file) {
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
    let content = await this.app.vault.read(file);
    const preIssues = validateContent(
      file.path,
      content,
      this.isRoot(file),
      this.settings
    );
    const hadRequiredError = preIssues.some((i) => i.severity === "error");
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
      this.promptForRequiredFields(file, remainingErrors);
    } else if (hadRequiredError) {
      this.promptForRequiredFields(file, preIssues.filter((i) => i.severity === "error"));
    } else {
      new import_obsidian3.Notice("OKF: note is conformant \u2705");
    }
  }
  /** Open a modal asking the user to supply required OKF fields. */
  promptForRequiredFields(file, errors) {
    new OkfPromptModal(this.app, this, file, errors).open();
  }
  async validateActive(file, openReport) {
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
      if (!issues.length) new import_obsidian3.Notice("OKF: active note is conformant \u2705");
    }
  }
  updateStatus(issues) {
    const errs = issues.filter((i) => i.severity === "error").length;
    const warns = issues.filter((i) => i.severity === "warning").length;
    this.statusEl.removeClass(
      "okf-statusbar-ok",
      "okf-statusbar-bad",
      "okf-statusbar-warn"
    );
    if (errs > 0) {
      this.statusEl.setText(`OKF \u2716 ${errs}`);
      this.statusEl.addClass("okf-statusbar-bad");
    } else if (warns > 0) {
      this.statusEl.setText(`OKF \u26A0 ${warns}`);
      this.statusEl.addClass("okf-statusbar-warn");
    } else {
      this.statusEl.setText("OKF \u2713");
      this.statusEl.addClass("okf-statusbar-ok");
    }
    if (issues.length === 0) {
      this.statusEl.setAttribute(
        "aria-label",
        "Active note conforms to OKF v0.1 \u2014 click to scan the vault"
      );
    } else {
      const lines = issues.slice(0, 8).map((i) => `${i.severity === "error" ? "\u2716" : "\u26A0"} ${i.rule} ${i.message}`);
      if (issues.length > 8) lines.push(`\u2026and ${issues.length - 8} more`);
      lines.push("");
      lines.push("Click to scan the whole vault");
      this.statusEl.setAttribute("aria-label", lines.join("\n"));
    }
  }
  /** Vault-wide summary tooltip on the status bar (set after a full scan). */
  refreshStatusTooltip() {
    if (!this.lastSummary) return;
    const { scanned, errFiles, warnFiles } = this.lastSummary;
    const ok = scanned - errFiles - warnFiles;
    this.statusEl.setAttribute(
      "aria-label",
      `OKF v0.1 \u2014 ${scanned} notes scanned
\u2713 ${ok} conformant
\u2716 ${errFiles} with errors
\u26A0 ${warnFiles} warnings only

Click to open the report`
    );
  }
  async scanVault(reveal = true, silent = false) {
    if (this.busy) {
      if (!silent) new import_obsidian3.Notice("OKF: a scan/fix is already running\u2026");
      return;
    }
    this.busy = true;
    try {
      const files = this.candidateFiles();
      const results = [];
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
        silent ? void 0 : "OKF: scanning"
      );
      results.sort((a, b) => a.path.localeCompare(b.path));
      this.renderResults(results, files.length);
      const errFiles = results.filter(
        (r) => r.issues.some((i) => i.severity === "error")
      ).length;
      const warnFiles = results.length - errFiles;
      this.lastSummary = { scanned: files.length, errFiles, warnFiles };
      this.refreshStatusTooltip();
      if (reveal && !silent) await this.activateView();
      if (!silent) {
        new import_obsidian3.Notice(
          `OKF: scanned ${files.length} notes \u2014 ${errFiles} with errors, ${warnFiles} with warnings only.`
        );
      }
    } finally {
      this.busy = false;
    }
  }
  renderResults(results, scanned) {
    const leaf = this.app.workspace.getLeavesOfType(OKF_VIEW_TYPE)[0];
    if (leaf && leaf.view instanceof OkfReportView) {
      leaf.view.setResults(results, scanned);
    } else {
      this.pendingResults = { results, scanned };
    }
  }
  async fixFile(file, notify) {
    const content = await this.app.vault.read(file);
    const issues = validateContent(
      file.path,
      content,
      this.isRoot(file),
      this.settings
    );
    if (isReserved(file.path)) {
      if (notify)
        new import_obsidian3.Notice("OKF: reserved files (index/log) are not auto-fixable.");
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
        new import_obsidian3.Notice(`OKF fixed ${file.basename}: ${applied.join(", ")}`);
      return applied.length;
    }
    if (notify) new import_obsidian3.Notice("OKF: nothing auto-fixable on this note.");
    return 0;
  }
  /**
   * Write user-supplied frontmatter values (from the prompt modal) into a note,
   * using Obsidian's safe frontmatter editor. Empty values are skipped.
   */
  async setFrontmatterFields(file, fields) {
    this.selfWrites.add(file.path);
    await this.app.fileManager.processFrontMatter(
      file,
      (fm) => {
        for (const [k, v] of Object.entries(fields)) {
          const val = (v != null ? v : "").trim();
          if (val.length > 0) fm[k] = val;
        }
      }
    );
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
      new import_obsidian3.Notice("OKF: a scan/fix is already running\u2026");
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
    new import_obsidian3.Notice(`OKF: auto-fixed ${changed} note(s).`);
    await this.scanVault();
  }
  async generateIndexForFolder(folder, notify = true) {
    var _a, _b;
    if (!folder) {
      if (notify) new import_obsidian3.Notice("OKF: no folder for the active note.");
      return;
    }
    const children = folder.children;
    const concepts = [];
    const subdirs = [];
    for (const child of children) {
      if (child instanceof import_obsidian3.TFile) {
        if (child.extension !== "md") continue;
        if (isReserved(child.path)) continue;
        const fm = (_b = (_a = this.app.metadataCache.getFileCache(child)) == null ? void 0 : _a.frontmatter) != null ? _b : {};
        const fmTitle = fm["title"];
        const fmDesc = fm["description"];
        const title = typeof fmTitle === "string" && fmTitle.length > 0 ? fmTitle : basename(child.path);
        const desc = typeof fmDesc === "string" ? fmDesc : "";
        concepts.push({ link: encodeURI(child.name), title, desc });
      } else if (child instanceof import_obsidian3.TFolder) {
        subdirs.push({ link: encodeURI(child.name) + "/", name: child.name });
      }
    }
    let out = "";
    if (subdirs.length) {
      out += "# Subdirectories\n\n";
      for (const s of subdirs) out += `* [${s.name}](${s.link}) - 
`;
      out += "\n";
    }
    out += "# Concepts\n\n";
    if (concepts.length === 0) out += "_No concepts yet._\n";
    for (const c of concepts) {
      out += `* [${c.title}](${c.link})${c.desc ? " - " + c.desc : ""}
`;
    }
    const indexPath = folder.path === "/" || folder.path === "" ? "index.md" : `${folder.path}/index.md`;
    const existing = this.app.vault.getAbstractFileByPath(indexPath);
    if (existing instanceof import_obsidian3.TFile) {
      const current = await this.app.vault.read(existing);
      if (current === out) return;
      this.selfWrites.add(indexPath);
      await this.app.vault.modify(existing, out);
    } else {
      this.selfWrites.add(indexPath);
      await this.app.vault.create(indexPath, out);
    }
    if (notify) new import_obsidian3.Notice(`OKF: wrote ${indexPath}`);
  }
  async generateAllIndexes() {
    if (this.busy) {
      new import_obsidian3.Notice("OKF: a scan/fix is already running\u2026");
      return;
    }
    this.busy = true;
    try {
      const folders = /* @__PURE__ */ new Set();
      for (const f of this.candidateFiles()) {
        if (f.parent) folders.add(f.parent);
      }
      const list = [...folders];
      await this.processQueue(
        list,
        (folder) => this.generateIndexForFolder(folder, false),
        "OKF: building indexes"
      );
      new import_obsidian3.Notice(`OKF: refreshed index.md in ${list.length} folder(s).`);
    } finally {
      this.busy = false;
    }
  }
  async addLogEntry(folder) {
    if (!folder) return;
    const logPath = folder.path === "/" || folder.path === "" ? "log.md" : `${folder.path}/log.md`;
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const entry = `* **Update**: `;
    const existing = this.app.vault.getAbstractFileByPath(logPath);
    if (existing instanceof import_obsidian3.TFile) {
      let content = await this.app.vault.read(existing);
      const heading = `## ${today}`;
      if (content.includes(heading)) {
        content = content.replace(heading, `${heading}
${entry}`);
      } else {
        const h1 = content.match(/^#\s+.+$/m);
        if (h1) {
          const idx = content.indexOf(h1[0]) + h1[0].length;
          content = content.slice(0, idx) + `

${heading}
${entry}` + content.slice(idx);
        } else {
          content = `# Update Log

${heading}
${entry}
` + content;
        }
      }
      this.selfWrites.add(logPath);
      await this.app.vault.modify(existing, content);
    } else {
      this.selfWrites.add(logPath);
      await this.app.vault.create(
        logPath,
        `# Update Log

## ${today}
${entry}
`
      );
    }
    const file = this.app.vault.getAbstractFileByPath(logPath);
    if (file instanceof import_obsidian3.TFile)
      await this.app.workspace.getLeaf(false).openFile(file);
    new import_obsidian3.Notice(`OKF: added log entry for ${today}`);
  }
  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(OKF_VIEW_TYPE);
    let leaf;
    if (existing.length) {
      leaf = existing[0];
    } else {
      leaf = this.app.workspace.getRightLeaf(false);
      await (leaf == null ? void 0 : leaf.setViewState({ type: OKF_VIEW_TYPE, active: true }));
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
};
var OkfSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian3.Setting(containerEl).setName("Default type for auto-fix").setDesc("Value inserted into `type` when fixing notes that lack it.").addText(
      (t) => t.setValue(this.plugin.settings.defaultType).onChange(async (v) => {
        this.plugin.settings.defaultType = v || "Concept";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Live check on save / open").setDesc("Validate the active note as you edit and when you open it.").addToggle(
      (tg) => tg.setValue(this.plugin.settings.liveCheckOnSave).onChange(async (v) => {
        this.plugin.settings.liveCheckOnSave = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Automation").setHeading();
    new import_obsidian3.Setting(containerEl).setName("Scan vault on startup").setDesc(
      "Run a full conformance scan automatically when the plugin loads (deferred until the workspace is ready)."
    ).addToggle(
      (tg) => tg.setValue(this.plugin.settings.scanOnStartup).onChange(async (v) => {
        this.plugin.settings.scanOnStartup = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Fix format issues on save").setDesc(
      "When you edit a note, auto-insert missing OKF frontmatter (type/title/timestamp). Non-destructive; never overwrites existing values."
    ).addToggle(
      (tg) => tg.setValue(this.plugin.settings.fixOnSave).onChange(async (v) => {
        this.plugin.settings.fixOnSave = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Auto-generate index.md").setDesc(
      "Regenerate a folder's index.md (\xA76 listing) automatically when its notes change."
    ).addToggle(
      (tg) => tg.setValue(this.plugin.settings.autoGenerateIndex).onChange(async (v) => {
        this.plugin.settings.autoGenerateIndex = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Batch size").setDesc(
      "Files processed per async chunk during scan/fix. Lower = smoother UI on large vaults; higher = faster."
    ).addText(
      (t) => t.setValue(String(this.plugin.settings.batchSize)).onChange(async (v) => {
        const n = parseInt(v, 10);
        this.plugin.settings.batchSize = isNaN(n) || n < 1 ? 50 : Math.min(n, 1e3);
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Rules").setHeading();
    new import_obsidian3.Setting(containerEl).setName("Warn on missing recommended fields").setDesc("title, description, timestamp (\xA74.1).").addToggle(
      (tg) => tg.setValue(this.plugin.settings.warnRecommendedFields).onChange(async (v) => {
        this.plugin.settings.warnRecommendedFields = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Warn on missing tags").addToggle(
      (tg) => tg.setValue(this.plugin.settings.warnTagsField).onChange(async (v) => {
        this.plugin.settings.warnTagsField = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Check reserved files (index.md / log.md)").setDesc("Validate \xA76 and \xA77 structure.").addToggle(
      (tg) => tg.setValue(this.plugin.settings.checkReservedFiles).onChange(async (v) => {
        this.plugin.settings.checkReservedFiles = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Excluded folders").setDesc("Comma-separated paths skipped during validation.").addText(
      (t) => t.setValue(this.plugin.settings.excludeFolders.join(", ")).onChange(async (v) => {
        this.plugin.settings.excludeFolders = v.split(",").map((s) => s.trim()).filter(Boolean);
        await this.plugin.saveSettings();
      })
    );
  }
};
var OkfPromptModal = class extends import_obsidian3.Modal {
  constructor(app, plugin, file, errors) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.errors = errors;
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache && cache.frontmatter || {};
    this.typeValue = typeof fm["type"] === "string" ? fm["type"] : plugin.settings.defaultType;
    this.titleValue = typeof fm["title"] === "string" ? fm["title"] : file.basename;
    this.descValue = typeof fm["description"] === "string" ? fm["description"] : "";
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "OKF \u2014 required fields" });
    contentEl.createEl("p", {
      cls: "okf-modal-intro",
      text: `\u201C${this.file.basename}\u201D needs a valid OKF type. Set the fields below and save.`
    });
    if (this.errors.length) {
      const box = contentEl.createDiv({ cls: "okf-modal-issues" });
      for (const e of this.errors) {
        box.createDiv({ text: `\u2716 ${e.rule} \u2014 ${e.message}` });
      }
    }
    const typeField = contentEl.createDiv({ cls: "okf-modal-field" });
    typeField.createEl("label", { text: "type (required)" });
    const typeInput = typeField.createEl("input", { type: "text" });
    typeInput.value = this.typeValue;
    typeInput.placeholder = "e.g. Concept, Source, Playbook, Reference";
    typeInput.oninput = () => this.typeValue = typeInput.value;
    window.setTimeout(() => {
      typeInput.focus();
      typeInput.select();
    }, 0);
    const titleField = contentEl.createDiv({ cls: "okf-modal-field" });
    titleField.createEl("label", { text: "title" });
    const titleInput = titleField.createEl("input", { type: "text" });
    titleInput.value = this.titleValue;
    titleInput.oninput = () => this.titleValue = titleInput.value;
    const descField = contentEl.createDiv({ cls: "okf-modal-field" });
    descField.createEl("label", { text: "description" });
    const descInput = descField.createEl("input", { type: "text" });
    descInput.value = this.descValue;
    descInput.placeholder = "one-line summary";
    descInput.oninput = () => this.descValue = descInput.value;
    const buttons = contentEl.createDiv({ cls: "okf-modal-buttons" });
    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();
    const save = buttons.createEl("button", {
      text: "Save",
      cls: "mod-cta"
    });
    save.onclick = async () => {
      const type = this.typeValue.trim();
      if (!type) {
        new import_obsidian3.Notice("OKF: type is required.");
        typeInput.focus();
        return;
      }
      await this.plugin.setFrontmatterFields(this.file, {
        type,
        title: this.titleValue,
        description: this.descValue
      });
      new import_obsidian3.Notice("OKF: fields saved \u2713");
      this.close();
    };
    contentEl.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save.click();
      }
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};
