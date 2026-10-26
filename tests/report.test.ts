import assert from "node:assert/strict";
import { test } from "node:test";
import { OkfReportView } from "../report-view";
import type { ScanSummary } from "../scan";
// Minimal DOM boundary, not a copy of the report rendering logic.
class Element {
  children: Element[] = []; attrs: Record<string, string> = {}; text = ""; cls = "";
  style = { setProperty() {} };
  get textContent(): string { return this.text + " " + this.children.map((c) => c.textContent).join(" "); }
  createDiv(options: any = {}) { return this.createEl("div", options); }
  createSpan(options: any = {}) { return this.createEl("span", options); }
  createEl(_tag: string, options: any = {}) {
    const element = new Element(); element.text = options.text ?? ""; element.cls = options.cls ?? "";
    this.children.push(element); return element;
  }
  empty() { this.children = []; } addClass() {} removeClass() {}
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
}
function harness() {
  const element = new Element();
  const view = new OkfReportView({ contentEl: element, app: { vault: { getAbstractFileByPath: () => null } } } as any, {} as any);
  return { element, view };
}
const summary: ScanSummary = { conformance: "conformant", status: "complete", checkCoverage: "full",
  counts: { files: { candidates: 1, validated: 1, unreadable: 0, unprocessed: 0 }, folders: { candidates: 0, validated: 0, unreadable: 0, unprocessed: 0 } },
  cleanFiles: 0, errorFiles: 1, warningFiles: 0, folderFindings: 0, coreErrorFiles: 0, extensionErrorFiles: 1,
  extensions: { complete: true, evaluated: 1, failed: 0, cancelled: 0 } };

test("report attributes extension errors while showing successful core conformance", async () => {
  const { view, element } = harness(); await view.onOpen();
  view.setResults([{ path: "one.md", issues: [{ rule: "owner", message: "Needs owner", severity: "error", providerId: "example/owner", providerName: "Owner checks" }] }], 1, summary);
  view.setActive("one.md", view.results[0].issues, "conformant", true);
  assert.match(element.textContent, /Core OKF: conformant/);
  assert.match(element.textContent, /0 core errors/);
  assert.match(element.textContent, /1 extension errors/);
  assert.match(element.textContent, /Owner checks/);
  assert.doesNotMatch(element.textContent, /fixable/);
});

test("reduced or unreadable scans never render all notes conform", async () => {
  const { view, element } = harness(); await view.onOpen();
  view.setResults([], 1, { ...summary, conformance: "unknown", status: "partial", checkCoverage: "reduced", extensions: { ...summary.extensions, complete: false } });
  assert.match(element.textContent, /incomplete/i);
  assert.doesNotMatch(element.textContent, /All notes conform/);
  view.invalidate(); assert.doesNotMatch(element.textContent, /Core OKF: conformant/);
});
