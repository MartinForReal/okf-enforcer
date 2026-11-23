// §6 resolves URI references against names in the host inventory. No I/O or execution.
import MarkdownIt from "markdown-it";
import { absent, items, legacy, mapping, text, type BundleContext, type Mapping } from "./frontmatter";
import type { OkfIssue } from "./validator";

const markdown = new MarkdownIt("commonmark").enable("table");

function linkTargets(tokens: ReturnType<typeof markdown.parse>, images: boolean): Set<string> {
  const refs = new Set<string>();
  for (const t of tokens) for (const child of t.children ?? []) {
    const ref = child.type === "link_open" ? child.attrGet("href") : images && child.type === "image" ? child.attrGet("src") : null;
    if (ref && !ref.startsWith("#")) refs.add(ref);
  }
  return refs;
}
export function indexLinks(body: string): Set<string> { return linkTargets(markdown.parse(body, {}), false); }
export function citationsHeading(body: string): number | undefined {
  if (!body.includes("# Citations")) return undefined;
  const tokens = markdown.parse(body, {});
  return tokens.find((t, i) => t.type === "heading_open" && t.markup === "#" && t.level === 0 && tokens[i + 1]?.content === "Citations")?.map?.[0];
}
export function logHeadings(body: string): string[] {
  const tokens = markdown.parse(body, {});
  return tokens.flatMap((t, i) => t.type === "heading_open" && t.tag === "h2" ? [tokens[i + 1].content.trim()] : []);
}

/** null means external, hidden or not a safe vault name. Split syntax before
 * decoding so %23 is a literal '#', while an unescaped # introduces a fragment. */
export function localTarget(source: string, ref: string): string | null {
  if (/^(?:[A-Za-z][A-Za-z0-9+.\-]*:|\/\/)/.test(ref)) return null;
  const raw = ref.split(/[?#]/, 1)[0];
  if (!raw) return source;
  const parts = raw.startsWith("/") ? [] : source.split("/").slice(0, -1);
  for (const segment of raw.split("/")) {
    let s: string; try { s = decodeURIComponent(segment); } catch { return null; }
    if (!s || s === ".") continue;
    if (s === "..") { if (!parts.length) return null; parts.pop(); continue; }
    if (s.startsWith(".") || s.includes("\\") || s.includes("/") ||
        Array.from(s).some(c => c.charCodeAt(0) < 0x20) || /^[A-Za-z]:/.test(s)) return null;
    parts.push(s);
  }
  return parts.join("/");
}

export function validateReferences(path: string, data: Mapping, body: string, bundle: BundleContext, checkComputation: boolean): OkfIssue[] {
  const issues: OkfIssue[] = [];
  const warn = (rule: string, message: string) => issues.push({severity: "warning", rule, message});
  const check = (field: string, value: unknown, link = false) => {
    if (absent(value)) return;
    if (!text(value)) { warn("§6.2", `${field} should be a path or URI.`); return; }
    const target = localTarget(path, value);
    const fileOnly = field === "computation";
    if (target === null || !bundle.exists || bundle.exists(target, fileOnly)) return;
    if (!link && !value.startsWith("/") && (bundle.version === undefined || legacy(bundle.version))) {
      const alt = localTarget("index.md", value);
      if (alt !== null && alt !== target && bundle.exists(alt, fileOnly)) {
        warn("§6.2", `${field} ${value} resolves only through the legacy root fallback; use /${value} if upgrading.`);
        return;
      }
    }
    warn(link ? "§6.1" : "§6.2", `${field} ${value} not found in the bundle${field === "computation" ? "; not attestable" : ""}.`);
  };
  check("resource", data.resource);
  if (data.status === "deprecated") check("superseded_by", data.superseded_by);
  for (const entry of items(data.sources)) {
    // Unlike other path fields, a source may be a non-followable scope descriptor.
    if (mapping(entry) && text(entry.resource) && !/\s/.test(entry.resource)) check("sources.resource", entry.resource);
  }
  const computation = checkComputation && data.type === "Attested Computation";
  if (!computation && !bundle.exists) return issues;
  const tokens = markdown.parse(body, {});
  if (bundle.exists) {
    for (const ref of linkTargets(tokens, true)) check("Link", ref, true);
  }
  if (!computation) return issues;
  if (!text(data.runtime)) warn("§10.2", "An Attested Computation needs a runtime; no value can be attested.");
  for (const [i, p] of items(data.parameters).entries()) {
    if (!mapping(p) || !text(p.name) || !text(p.type)) warn("§10.2", `parameters[${i}] needs name and type; entry ignored.`);
    else if (!absent(p.required) && typeof p.required !== "boolean") warn("§10.2", `parameters[${i}].required should be a boolean (default false).`);
  }
  for (const key of ["executor", "attester"]) {
    const e = data[key]; if (absent(e)) continue;
    if (!mapping(e) || !text(e.resource)) { warn("§10.2", `${key} needs a resource.`); continue; }
    check(`${key}.resource`, e.resource);
    if (key === "executor" && !absent(e.receipt) && !Array.isArray(e.receipt)) warn("§10.2", "executor.receipt lists fields a run returns.");
  }
  let level = 0, fences = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "heading_open") {
      const depth = Number(t.tag.slice(1));
      if (level && depth <= level) break;
      if (!level && t.markup.startsWith("#") && tokens[i + 1]?.content.trim() === "Computation") level = depth;
    } else if (level && t.type === "fence") fences++;
  }
  if (!absent(data.computation)) {
    check("computation", data.computation);
    if (fences) warn("§10.3", "The computation file takes precedence over the inline fence.");
  } else if (!fences) warn("§10.3", "No computation file or fenced code block in the Computation section; not attestable.");
  else if (fences > 1) warn("§10.3", "The Computation section has multiple fenced blocks; only the first is the computation.");
  return issues;
}
