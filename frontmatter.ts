// OKF §4. Keep the exact source separate from the parsed consumer view.
import { isMap, isScalar, parseDocument, type YAMLMap } from "yaml";

export type Mapping = Record<string, unknown>;
export function mapping(value: unknown): value is Mapping {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}
export function text(value: unknown): value is string { return typeof value === "string" && value.trim() !== ""; }
export function absent(value: unknown): boolean {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}
export function items(value: unknown): unknown[] { return absent(value) ? [] : Array.isArray(value) ? value : [value]; }

export function splitFrontmatter(content: string) {
  const open = /^\uFEFF?---(?:\r?\n|$)/.exec(content);
  if (!open) return { hasFm: false, unclosed: false, raw: "", body: content };
  const end = /^---(?=\r?$)/gm;
  end.lastIndex = open[0].length;
  const close = end.exec(content);
  if (!close) return { hasFm: false, unclosed: true, raw: "", body: "" };
  return { hasFm: true, unclosed: false,
    raw: content.slice(open[0].length, close.index).replace(/\r?\n$/, ""), body: content.slice(close.index + 3) };
}

export function readFrontmatter(content: string) {
  const parts = splitFrontmatter(content);
  let data: Mapping | null = null, error: string | undefined, version: string | undefined;
  let sourceMap: YAMLMap | undefined;
  if (parts.unclosed) error = "Missing exact closing --- line.";
  if (parts.hasFm) {
    try {
      // Source ranges used by the fixer must address the exact block, including
      // its final CRLF and a block scalar's original chomping/indentation.
      const header = content.slice(content.indexOf("\n") + 1, content.length - parts.body.length - 3);
      const doc = parseDocument(header, { schema: "core", version: "1.2", resolveKnownTags: false });
      if (doc.errors.length) throw doc.errors[0];
      if (!isMap(doc.contents)) throw new Error("Expected a YAML mapping.");
      data = doc.toJS() as Mapping;
      sourceMap = doc.contents;
      const value = data.okf_version;
      if (!absent(value)) {
        // Do not certify 0.30 as 0.3 just because a YAML number rounded to it.
        const node = doc.get("okf_version", true);
        version = typeof value === "string" ? value : typeof value === "number" && isScalar(node) ? node.source : undefined;
        version ??= "(invalid declaration)";
      }
    } catch (e) { error = e instanceof Error ? e.message : "Invalid YAML"; }
  }
  return { ...parts, data, error, version, sourceMap };
}

export const OKF_VERSION = "0.3";
export const OKF_KNOWN_VERSIONS = ["0.1", "0.2", OKF_VERSION];
export interface BundleContext {
  /** Distinguishes an observed undeclared bundle from isolated v0.3 input. */
  observed?: boolean;
  version?: string;
  unreadableRoot?: boolean;
  /** Inventory only: false means missing; undefined means outside the configured scope. */
  exists?(path: string, fileOnly?: boolean): boolean | undefined;
}
export function legacy(version?: string): boolean { return version === "0.1" || version === "0.2"; }
export function supported(bundle: BundleContext): boolean {
  return !bundle.unreadableRoot && (bundle.version === undefined || OKF_KNOWN_VERSIONS.includes(bundle.version));
}
export function dotPath(path: string): boolean { return path.split("/").some(part => part.startsWith(".")); }
