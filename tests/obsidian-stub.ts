// Node tests deliberately use JSON-flow frontmatter, a valid YAML subset.
// This is not a YAML implementation or a substitute for real Obsidian E2E.
export function parseYaml(text: string): unknown {
  return JSON.parse(text);
}

// Only the Obsidian boundary is doubled; tests execute the real plugin/pipeline.
export class Plugin {
  private cleanups: (() => void)[] = [];
  constructor(public app: any, public manifest: any) {}
  register(cleanup: () => void) { this.cleanups.push(cleanup); }
  registerEvent(ref: any) { this.register(() => ref.off?.()); }
  registerView() {}
  addCommand() {}
  addSettingTab() {}
  addStatusBarItem() { return this.app.status; }
  loadData(): Promise<unknown> { return Promise.resolve(null); }
  saveData(): Promise<void> { return Promise.resolve(); }
  unload() { (this as any).onunload?.(); this.cleanups.forEach((fn) => fn()); }
}
export class ItemView {
  app: any; contentEl: any;
  constructor(leaf: any) { this.app = leaf.app; this.contentEl = leaf.contentEl; }
}
export class Modal {}
export class PluginSettingTab { constructor(public app: any, public plugin: any) {} }
export class Setting {}
export class TFolder { children: any[] = []; constructor(public path: string) {} }
export class TFile {
  extension = "md"; basename: string; parent: TFolder | null = null;
  constructor(public path: string) { this.basename = path.replace(/\.md$/, ""); }
}
export class Notice { constructor(_message: string) {} }
export function debounce(fn: (...args: any[]) => any, delay: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const callback = (...args: any[]) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
  callback.cancel = () => clearTimeout(timer);
  return callback;
}
