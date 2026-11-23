// OKF v0.3 validation and index maintenance. SPEC pin and compatibility: see README.
import { isScalar, type YAMLMap } from "yaml";
import { PortentSettings, PORTENT_DEFAULTS, validatePortent } from "./portent";
import { instant, trustTier, validateSignals } from "./signals";
import { citationsHeading, indexLinks, localTarget, logHeadings, validateReferences } from "./references";
import { absent, dotPath, items, legacy, mapping, OKF_KNOWN_VERSIONS, readFrontmatter, splitFrontmatter, supported, text, type BundleContext } from "./frontmatter";
export { OKF_KNOWN_VERSIONS, OKF_VERSION, splitFrontmatter } from "./frontmatter";
export { isStale, normalizeVerified, OKF_STATUSES, trustTier } from "./signals";

export type Severity = "error" | "warning";

export interface OkfIssue {
  /** Best-effort read, not a verdict for a version this engine doesn't know. */
  unknownVersion?: boolean;
  severity: Severity;
  rule: string;
  message: string;
  fix?: FixKind;
  /** Host-owned attribution; extensions cannot supply core fixes. */
  providerId?: string;
  providerName?: string;
  providerFailure?: boolean;
}

export type FixKind =
  | "add-frontmatter"
  | "add-type"
  | "add-title"
  | "add-generated"
  // Migration fixes (§13): only applied by the explicit "migrate" action,
  // never by ordinary save-time auto-fix.
  | "migrate-timestamp"
  | "migrate-citations";


/**
 * Plugin settings: the OKF core plus the composed Portent layer (see
 * `PortentSettings`). Portent fields live flat here — rather than nested — for
 * backward compatibility with persisted `data.json` from prior versions.
 */
export interface OkfSettings extends PortentSettings {
  defaultType: string;
  /**
   * Actor written to `generated.by` when auto-fix creates a `generated` block
   * (§5.2, §7). Follows the actor convention — e.g. `okf-enforcer/0.6` for the
   * plugin, or `human:<id>` if a person wants edits attributed to them.
   */
  defaultActor: string;
  /**
   * Which absent-but-recommended frontmatter fields are worth a warning:
   * any of `title`, `description`, `generated` (§4.1, §5.2) and `tags`. A set
   * rather than a toggle per field, because these are one judgment — how much
   * the vault wants said about what a note is missing — and answering it four
   * times in four rows made the question look bigger than it is. Unknown names
   * are ignored, so a vault can carry a token this version doesn't check yet.
   */
  warnMissingFields: string[];
  /**
   * Validate the optional trust/lifecycle families when present: `verified`
   * shape + actors, `status` vocabulary, `stale_after` date form (§5.2–§5.5).
   * Advisory — off by default so vaults not using these fields stay quiet.
   */
  warnTrustFields: boolean;
  /**
   * Validate `Attested Computation` concepts (§10): required `runtime`,
   * `parameters`/`executor`/`attester` shape, and a present computation.
   */
  checkAttestedComputation: boolean;
  /**
   * Validate the active note as it is edited. Gates the save path only — a note
   * is always validated when it is opened, because the report pane's active-note
   * section reads that verdict and would otherwise go stale behind the tab.
   */
  liveCheckOnSave: boolean;
  scanOnStartup: boolean;
  fixOnSave: boolean;
  autoGenerateIndex: boolean;
  /**
   * Bring every folder's `index.md` up to date once, when the plugin loads.
   * Off by default: the on-create/rename/delete hooks already keep listings
   * current while the plugin is running, so this is for what changed while it
   * wasn't — a vault synced from another machine, or edited outside Obsidian —
   * and it writes across the whole vault, which is not something to do to
   * someone's notes unasked.
   */
  generateIndexOnStartup: boolean;
  /**
   * Rebuild an existing `index.md` from scratch instead of adding to it (§8).
   * Off by default: generation appends the entries a listing is missing and
   * leaves prose, ordering, and hand-edited descriptions alone. On, the listing
   * is rewritten from the folder's contents, which also drops entries for notes
   * that are gone.
   */
  overwriteExistingIndex: boolean;
  /**
   * Heading in a subfolder's `index.md` whose first paragraph describes that
   * folder (e.g. `Purpose`), used as the description of its entry in the parent
   * listing. Non-root indexes carry no frontmatter (§8), so a body section is
   * the only place a folder can say what it holds. Blank turns the lookup off.
   */
  indexSubdirDescSection: string;
  /**
   * Report what a folder's listing is missing instead of writing it (§8): a
   * folder with no `index.md` at all, and the notes an existing one doesn't
   * name anywhere in the file. Off by default. This is for a vault that keeps
   * its listings by hand — its own headings, its own order, its own groupings —
   * where generating over them writes a shape the vault didn't choose. Findings
   * are warnings in the vault report and nothing else: §8 makes an index
   * optional and §11 forbids failing a bundle for a missing one, and nothing
   * here is written.
   */
  reportIndexGaps: boolean;
  batchSize: number;
  excludeFolders: string[];
}

/** The fields "Warn about missing fields" can name, in the order shown. */
export const WARNABLE_FIELDS = ["title", "description", "generated", "tags"] as const;

export const DEFAULT_SETTINGS: OkfSettings = {
  defaultType: "Concept",
  defaultActor: "okf-enforcer/0.6",
  // Optional authoring preferences; none of these are conformance requirements.
  warnMissingFields: ["title", "description", "generated"],
  warnTrustFields: false,
  checkAttestedComputation: true,
  liveCheckOnSave: true,
  scanOnStartup: true,
  fixOnSave: true,
  autoGenerateIndex: true,
  generateIndexOnStartup: false,
  overwriteExistingIndex: false,
  indexSubdirDescSection: "",
  reportIndexGaps: false,
  batchSize: 50,
  excludeFolders: ["Templates"],
  ...PORTENT_DEFAULTS,
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Active-note tooltip only; malformed or untyped Markdown has no trust tier. */
export function trustTierOfContent(content: string, version?: string) {
  const { data } = readFrontmatter(content);
  return data && text(data.type) ? trustTier(data, version) : null;
}

export function basename(path: string): string {
  const f = path.split("/").pop() || path;
  return f.replace(/\.md$/i, "");
}

/**
 * The folder holding `path`, written the way Obsidian paths its folders — `/`
 * for the vault root. Derived from the path rather than a `parent` reference,
 * which is gone by the time a delete is reported and stale after a rename.
 */
export function parentPath(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "/" : path.slice(0, cut);
}

export function isReserved(path: string): "index" | "log" | null {
  const f = path.split("/").pop();
  if (f === "index.md") return "index";
  if (f === "log.md") return "log";
  return null;
}

/** Bare names match folder segments; slash-containing paths start at the vault
 * root. Pass a folder (or a file's parent), never a filename as an exclusion. */
export function isExcludedFolder(path: string, settings: OkfSettings, configDir: string): boolean {
  if (path === "/" || path === "") return false;
  if (dotPath(path) || path === configDir || path.startsWith(configDir + "/")) return true;
  const segments = path.split("/");
  return settings.excludeFolders.some(entry => entry && (entry.includes("/")
    ? path === entry || path.startsWith(entry + "/") : segments.includes(entry)));
}


/**
 * One-line summary: collapse whitespace and clip, so a multi-line
 * `description` or section paragraph still fits on a single index.md bullet.
 */
export function oneLine(text: string, max = 200): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

/** Line index of the `# <section>` heading in `lines`, or -1. */
function headingIndex(lines: string[], section: string): number {
  const wanted = section.trim().toLowerCase();
  if (!wanted) return -1;
  return lines.findIndex((l) => {
    const m = l.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    return !!m && m[1].trim().toLowerCase() === wanted;
  });
}

/**
 * First paragraph under the `# <section>` heading of `content`, as a one-line
 * summary — how a folder describes itself to its parent's index.md (§8).
 * Returns "" when the section is missing or empty.
 */
export function sectionSummary(content: string, section: string): string {
  const lines = splitFrontmatter(content).body.split(/\r?\n/);
  let i = headingIndex(lines, section);
  if (i < 0) return "";

  const para: string[] = [];
  for (i++; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,6}\s+\S/.test(line)) break; // next section
    if (!line.trim()) {
      if (para.length) break; // blank line ends the paragraph
      continue; // …but leading blanks are just spacing
    }
    // Strip list/quote markers so a bulleted purpose reads as a sentence.
    para.push(line.trim().replace(/^([*\-+]|>|\d+\.)\s+/, ""));
  }
  return oneLine(para.join(" "));
}

/**
 * The whole `# <section>` block of `content` — the heading line plus everything
 * up to the next heading — so prose a folder wrote about itself survives a
 * regenerated listing. Returns "" when the section is absent.
 */
export function sectionBlock(content: string, section: string): string {
  const lines = splitFrontmatter(content).body.split(/\r?\n/);
  const start = headingIndex(lines, section);
  if (start < 0) return "";
  let end = start + 1;
  while (end < lines.length && !/^#{1,6}\s+\S/.test(lines[end])) end++;
  return lines.slice(start, end).join("\n").trim();
}

/** One entry of a §8 listing. */
export interface IndexEntry {
  /** Heading it belongs under, e.g. `Concepts`. */
  section: string;
  /** Relative link target, URI-encoded as it should be written. */
  link: string;
  title: string;
  desc: string;
}

/**
 * Link text with its brackets escaped, so a title can't close the link it sits
 * in: a note titled `See](elsewhere.md) this` would otherwise render an entry
 * pointing somewhere the folder never named.
 */
function escapeLinkText(text: string): string {
  return text.replace(/([\\[\]])/g, "\\$1");
}

/**
 * A file name as a link destination. `encodeURI` leaves the reserved delimiters
 * alone, and every one of them changes how the destination reads: an unescaped
 * `(` in `report (1).pdf` ends the destination early, and an unescaped `#` in
 * `Meeting #3.md` starts a fragment, so Obsidian looks for a note called
 * `Meeting ` — the plugin has to be able to re-read the entries it writes, and
 * so does the reader.
 */
export function encodeLink(name: string): string {
  return encodeURI(name)
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F");
}

/** The §8 entry shape: `* [Title](link) - description`. */
export function renderEntry(e: IndexEntry): string {
  return `* [${escapeLinkText(e.title)}](${e.link})${e.desc ? ` - ${e.desc}` : ""}`;
}

/**
 * The §8 sections that no `type` names: subdirectories, notes whose `type` is
 * missing or unusable (§11 reports those separately — the listing just doesn't
 * pretend to know what they are), and files that aren't notes at all.
 */
export const INDEX_SECTIONS = {
  subdirs: "Subdirectories",
  untyped: "Untyped",
  files: "Files",
} as const;

/** Plurals the suffix rules below get wrong. */
const IRREGULAR_PLURALS: Record<string, string> = {
  person: "people",
  child: "children",
};

/** The plural of a single word, for use as a section heading. */
function pluralize(word: string): string {
  const lower = word.toLowerCase();
  const irregular = IRREGULAR_PLURALS[lower];
  if (irregular) {
    // Keep whatever capitalisation the author used for the first letter.
    return word[0] === lower[0]
      ? irregular
      : irregular[0].toUpperCase() + irregular.slice(1);
  }
  // `Analysis` → `Analyses`, not `Analysises`.
  if (/[a-z]{2}is$/i.test(word)) return word.slice(0, -2) + "es";
  // Already plural — `Notes` stays `Notes`. `Process`, `Status` and `Analysis`
  // only look plural, so they're excluded and pluralised below.
  if (/[^su]s$/i.test(word)) return word;
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + "es";
  return word + "s";
}

/**
 * Capitalises a word written entirely in lower case, and leaves any other one
 * alone: `wiki` heads a `Wikis` section, while `API` keeps its capitals rather
 * than being flattened to `Api`.
 */
function headingCase(word: string): string {
  return word === word.toLowerCase()
    ? word.charAt(0).toUpperCase() + word.slice(1)
    : word;
}

/**
 * Section heading for the notes of one `type` — `Concept` → `Concepts`,
 * `Attested Computation` → `Attested Computations`. Grouping by type is what
 * makes a listing say what a directory holds rather than only that it holds
 * something, which is the progressive disclosure §8 is after.
 *
 * Only the last word is pluralised. A heading is prose, so a lower-case `type`
 * is capitalised for it, but a word the author already capitalised is left as
 * written — an acronym stays an acronym. A type that is missing or says nothing
 * usable gets the `Untyped` section rather than being silently filed under
 * `Concepts`.
 */
export function sectionForType(type: unknown): string {
  if (typeof type !== "string") return INDEX_SECTIONS.untyped;
  // A heading is one line, so a `type` carrying newlines or its own `#` can't
  // be pasted in raw.
  const t = oneLine(type, 80).replace(/^#+\s*/, "").trim();
  if (!t) return INDEX_SECTIONS.untyped;
  const words = t.split(/\s+/).map(headingCase);
  words[words.length - 1] = pluralize(words[words.length - 1]);
  return words.join(" ");
}

const BULLET_RE = /^\s*[*\-+]\s+\S/;
const BULLET_MARKER_RE = /^(\s*[*\-+]\s+)/;
// An ordered list is the other shape a hand-authored index is commonly written
// in. Recognized so its entries aren't listed a second time, never rewritten.
const LIST_MARKER_RE = /^(\s*(?:[*\-+]|\d{1,9}[.)])\s+)/;
const ORDINAL_RE = /^\s*(\d{1,9})[.)]\s/;
const PLACEHOLDER_RE = /^\s*_No .+ yet\._\s*$/;
// `[[note]]`, `[[note|Alias]]`, `[[note#heading]]`, `[[note#^block]]` — read
// only, never written. Obsidian's own link syntax is what a hand-authored index
// is most likely to be written in. An embed (`![[x]]`) is deliberately not
// matched: it displays a file rather than linking to one, so it doesn't stand in
// for the entry §8 asks for, and the embed itself is still left as written.
const BULLET_WIKILINK_RE = /^\s*(?:[*\-+]|\d{1,9}[.)])\s+\[\[([^\]|#^]*)/;

/** A `* [Title](dest)` entry, split so its destination can be replaced in place. */
interface BulletLink {
  /** Everything up to and including the `(` that opens the destination. */
  prefix: string;
  /** The destination exactly as written, between the parens. */
  dest: string;
  /** The closing paren and everything after it — usually ` - description`. */
  suffix: string;
  /** Whether the marker is a numbered one, which is the author's to keep. */
  ordered: boolean;
  /**
   * The destination of a link nested inside the title, when there is one.
   * CommonMark forbids a link inside a link, so in `[a [b](x) c](y)` only `x`
   * renders — `dest` is what this plugin would rewrite, `nested` is what the
   * reader actually clicks.
   */
  nested?: string;
}

/**
 * The paren-delimited destination starting at `open`, with parens balanced so a
 * file name may hold them, or null when the parens never close.
 */
function readDest(line: string, open: number): { dest: string; end: number } | null {
  let j = open;
  for (let depth = 1; j < line.length; j++) {
    const c = line[j];
    if (c === "\\") j++;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) break;
  }
  return line[j] === ")" ? { dest: line.slice(open, j), end: j } : null;
}

/**
 * The link a bullet entry opens with, or null when it doesn't open with one.
 *
 * Scanned rather than matched with one pattern because both halves nest: a
 * title may hold brackets (`Rev [2]`) and a destination may hold parens
 * (`report (1).pdf`). A pattern that stops at the first `]` or `)` fails on the
 * very line `renderEntry` wrote, and an entry that can't be read back is
 * appended again on every pass. Only the link the entry *starts* with is
 * parsed, so a markdown link written inside a description is never mistaken for
 * the entry's own.
 */
function parseBulletLink(line: string): BulletLink | null {
  const marker = line.match(LIST_MARKER_RE);
  if (!marker || line[marker[0].length] !== "[") return null;

  const start = marker[0].length + 1;
  let nested: string | undefined;
  let i = start;
  for (let depth = 1; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") i++;
    else if (c === "[") depth++;
    else if (c === "]") {
      if (depth > 1 && nested === undefined && line[i + 1] === "(") {
        nested = readDest(line, i + 2)?.dest;
      }
      if (--depth === 0) break;
    }
  }
  if (line[i] !== "]" || line[i + 1] !== "(") {
    // A title left holding an unmatched `[` never balances — and that is exactly
    // what this plugin wrote before titles were escaped. Fall back to the
    // reading the old pattern gave such a line, so an index already on disk is
    // recognized rather than listed a second time.
    const first = line.indexOf("]", start);
    if (first < 0 || line[first + 1] !== "(") return null;
    i = first;
    nested = undefined;
  }

  const open = i + 2;
  const dest = readDest(line, open);
  if (!dest) return null;

  return {
    prefix: line.slice(0, open),
    dest: dest.dest,
    suffix: line.slice(dest.end),
    ordered: !BULLET_MARKER_RE.test(marker[0]),
    nested,
  };
}

/**
 * A markdown destination split into what it points at and any trailing link
 * title, so a corrected destination keeps the `"…"` an author wrote after it.
 */
function splitDest(dest: string): { target: string; trailer: string } {
  const rest = dest.replace(/^\s+/, "");
  const angled = rest.match(/^<([^>]*)>/);
  if (angled) {
    return { target: angled[1], trailer: rest.slice(angled[0].length) };
  }
  const title = rest.search(/\s+["'(]/);
  return title < 0
    ? { target: rest.trimEnd(), trailer: "" }
    : { target: rest.slice(0, title), trailer: rest.slice(title) };
}

/**
 * A target with its escapes resolved, so `my%20notes` and `my notes` compare
 * equal. `decodeURI` deliberately preserves the reserved delimiters it would
 * change the meaning of, so `%23`/`%3F` are folded back by hand — otherwise the
 * link `encodeLink` writes for `Meeting #3.md` never compares equal to the one
 * an author typed, and the note is listed twice.
 */
export function decodePath(target: string): string {
  const t = target.replace(/^\.\//, "");
  // Folded before `decodeURI`, not after: decoding turns `%25` into a literal
  // `%`, so folding afterwards would read the `%23` that surfaces in
  // `a%2523b.md` — a file whose name really does hold the three characters
  // `%23` — as an escaped `#`, and the entry would be pruned as missing.
  const literal = (s: string) => s.replace(/%23/gi, "#").replace(/%3F/gi, "?");
  try {
    return decodeURI(literal(t));
  } catch {
    // A malformed escape is compared as written rather than dropped.
    return literal(t);
  }
}

/**
 * A destination split from the `#fragment` or `?query` trailing it. Linking at
 * a heading in a sibling note — `paxos.md#simple` — is idiomatic in Obsidian,
 * and it names the same note `paxos.md` does. Asking the vault for the whole
 * string finds nothing, which would read as a note that had been deleted.
 *
 * Only a separator with something before it splits. A destination that *starts*
 * with one is either a same-document anchor (`#top`) or a file whose name starts
 * with `#`; either way the whole string is what identifies it, and collapsing it
 * to `""` would put every such destination on one key.
 */
function splitFragment(target: string): { path: string; fragment: string } {
  const at = target.slice(1).search(/[#?]/);
  return at < 0
    ? { path: target, fragment: "" }
    : { path: target.slice(0, at + 1), fragment: target.slice(at + 1) };
}

/** Whether two destinations resolve to the same file — `./a.md` and `a.md` do. */
function sameTarget(a: string, b: string): boolean {
  return decodePath(splitFragment(a).path) === decodePath(splitFragment(b).path);
}

/**
 * A path reduced to what identifies the thing it points at, so a folder listed
 * as `notes/` and the same folder rendered as `notes/index.md` are recognized
 * as one entry rather than appended twice.
 */
function pathKey(path: string): string {
  return decodePath(path)
    .replace(/\/index\.md$/, "")
    .replace(/\/+$/, "");
}

/** The same, for a whole destination — title trailer and fragment removed. */
function linkKey(dest: string): string {
  return pathKey(splitFragment(splitDest(dest).target).path);
}

/**
 * The one key a wikilink target is listing. Obsidian writes `[[note]]` for
 * `note.md`, so the extension a generated entry carries has to be added or the
 * two never line up and the note is listed twice.
 *
 * Exactly one key, never both spellings: a subdirectory's entry keys as `alpha`
 * once `/index.md` is stripped, so claiming the bare name as well would let a
 * single `* [[alpha]]` silence both the note `alpha.md` and the folder
 * `alpha/` — and a folder missing from its parent's listing is a dead end. A
 * wikilink names a file, so the `.md` reading wins wherever the folder holds
 * one; `[[alpha/index]]` still lands on the folder, because that is the file a
 * subdirectory's entry points at.
 */
function wikilinkKeys(target: string, canonical: Map<string, string>): string[] {
  const t = target.trim();
  if (!t) return [];
  // Keyed with `pathKey`, not `linkKey`: a wikilink target is not a markdown
  // destination, so none of a destination's punctuation rules apply to it.
  // `[[notes (draft)]]` names a file with brackets in it, and reading the
  // ` (` as the start of a link title would key it as `notes` — silencing a
  // sibling folder `notes/` that nothing else would then list.
  if (/\.[a-z0-9]+$/i.test(t) || t.endsWith("/")) return [pathKey(t)];
  const md = pathKey(`${t}.md`);
  return canonical.has(md) ? [md] : [pathKey(t)];
}

/** The full listing for a folder, replacing whatever the index held before. */
export function renderIndex(entries: IndexEntry[], keep = ""): string {
  // A directory with nothing in it gets an empty index rather than a listing
  // that describes emptiness: §8 asks an index to enumerate what a directory
  // holds, and there is nothing to enumerate. The file is still written, so the
  // entry naming it in the parent listing still points at something real.
  if (entries.length === 0) return keep ? `${keep}\n` : "";
  let out = keep ? `${keep}\n\n` : "";
  let section = "";
  for (const e of entries) {
    if (e.section !== section) {
      if (section) out += "\n";
      section = e.section;
      out += `# ${section}\n\n`;
    }
    out += `${renderEntry(e)}\n`;
  }
  return out;
}

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * Per-line flag marking fenced code blocks, including the fence markers. A
 * bullet in there is sample text — a root index that documents the format is
 * not listing the folders it shows — so it is neither an entry to correct nor a
 * place to append one.
 */
function fencedLines(lines: string[]): boolean[] {
  const mask: boolean[] = [];
  let fence = "";
  for (const line of lines) {
    const open = line.match(FENCE_RE);
    if (open) {
      if (!fence) fence = open[1][0];
      else if (open[1][0] === fence) fence = "";
      mask.push(true);
      continue;
    }
    mask.push(fence !== "");
  }
  return mask;
}

/**
 * Whether an ordered marker on `lines[i]` opens a list rather than continuing
 * the prose above it. CommonMark only lets an ordered list interrupt a
 * paragraph when it starts at `1`, so a `2.` written straight under a line of
 * prose is a lazy continuation of that paragraph: the link on it is part of a
 * sentence, and reading it as an entry would leave the note it names listed by
 * nothing at all. Inside a list the number is the author's to choose, so the
 * scan only walks back as far as the paragraph a marker would have to
 * interrupt.
 */
function ordinalOpensList(lines: string[], i: number): boolean {
  const n = lines[i].match(ORDINAL_RE);
  if (!n || n[1] === "1") return true;
  for (let j = i - 1; j >= 0; j--) {
    if (LIST_MARKER_RE.test(lines[j]) || /^\s{2,}\S/.test(lines[j])) return true;
    // Directly above, a blank line or a heading means nothing is open for the
    // marker to interrupt; further up, the lines between are that paragraph.
    if (!lines[j].trim() || /^#{1,6}\s/.test(lines[j])) return j === i - 1;
  }
  return i === 0;
}

/**
 * Whether a destination names something the folder holds directly, and so is
 * this plugin's to remove once it's gone: `a.md`, `sub`, `sub/`, or
 * `sub/index.md`. Anything else — a cross-link deeper into the tree, a path out
 * of the folder, an absolute bundle path, a URL, a bare anchor — belongs to
 * whoever wrote it and is left alone however broken it is (§6.1).
 */
function isOwnEntry(target: string): boolean {
  if (!target || target.startsWith("/") || target.startsWith("#")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false;
  const parts = target.replace(/\/+$/, "").split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return false;
  if (parts.length === 1) return true;
  return parts.length === 2 && parts[1] === "index.md";
}

/**
 * Adds the entries an index doesn't list yet, under their section headings,
 * corrects the destination of one that points at the right thing by the wrong
 * path, and drops one whose note the folder no longer holds. Everything else is
 * left exactly as written — prose, ordering, entry titles, hand-edited
 * descriptions, and sections this plugin knows nothing about. Returns
 * `existing` unchanged when there is nothing to do, so no write is needed.
 *
 * `exists` reports whether a path relative to this folder still resolves in the
 * vault. Without it nothing is dropped, since a link that can't be checked
 * can't be known to be stale.
 *
 * Returns the merged text alongside the entries the file didn't already list,
 * so that reporting a listing's gaps and closing them are one reading of the
 * index rather than two that can come to disagree about it.
 */
function mergeIndexParts(
  existing: string,
  entries: IndexEntry[],
  exists?: (target: string) => boolean,
  indexPath = "index.md"
): { text: string; unlisted: IndexEntry[] } {
  const { body } = splitFrontmatter(existing);
  const prefix = existing.slice(0, existing.length - body.length);
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);

  const canonical = new Map<string, string>();
  for (const e of entries) canonical.set(linkKey(e.link), e.link);

  const listed = new Set<string>();
  // Equivalent absolute, relative and reference-style links already list a
  // child. Do not rewrite the author's chosen spelling or fold filename case.
  const children = new Map(entries.map(e => [localTarget(indexPath, e.link), linkKey(e.link)]));
  for (const ref of indexLinks(body)) {
    const target = localTarget(indexPath, ref), key = target === null ? undefined : children.get(target);
    if (key !== undefined) listed.add(key);
  }
  const stale: number[] = [];
  const emptied = new Set<string>();
  const fenced = fencedLines(lines);
  let section = "";
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue;
    const head = lines[i].match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (head) {
      section = head[1].trim();
      continue;
    }
    if (!ordinalOpensList(lines, i)) continue;
    const link = parseBulletLink(lines[i]);
    if (!link) {
      // A wikilink entry is recognized but never rewritten or pruned: §8 asks
      // for markdown links, and rewriting the syntax an author chose would be
      // the same destructive move in a new coat. Counting it as already listed
      // is what keeps a hand-authored index from being doubled on first
      // contact with the plugin.
      const wiki = lines[i].match(BULLET_WIKILINK_RE);
      if (wiki) for (const key of wikilinkKeys(wiki[1], canonical)) listed.add(key);
      continue;
    }
    const { target, trailer } = splitDest(link.dest);
    const split = splitFragment(target);
    // `#` and `?` are legal in a file name, so a destination holding one may be
    // naming a fragment or may be naming a file. It is read as a fragment only
    // where this folder is the authority on the answer — otherwise
    // `research#2024/papers/paxos.md` collapses to `research`, which the folder
    // looks to have held and lost, and a link that works is rewritten onto a
    // sibling folder or dropped for a file that is still there.
    const wholeKey = pathKey(target);
    const splitKey = pathKey(split.path);
    let names = false;
    if (wholeKey !== splitKey) {
      if (canonical.has(wholeKey) || !isOwnEntry(target)) {
        // Either the folder holds exactly this, or the destination reaches past
        // the folder: `research#2024/papers/paxos.md` is a cross-link deeper
        // into the tree, not `research` with a fragment on it. Neither is this
        // plugin's to correct or remove (§6.1), and reading the prefix as the
        // entry's identity would rewrite a working link onto a sibling.
        names = true;
      } else {
        // One segment, or `sub/index.md` — the folder's own business, so the
        // vault is the authority on whether the separator is part of the name.
        const alt = canonical.get(splitKey);
        const risky =
          alt === undefined ? !!exists && isOwnEntry(split.path) : !sameTarget(split.path, alt);
        names = risky && !!exists && exists(decodePath(target).replace(/\/+$/, ""));
      }
    }
    const targetPath = names ? target : split.path;
    const fragment = names ? "" : split.fragment;
    // A link nested in the title is what the reader actually clicks — CommonMark
    // renders only the inner one — so that is the entry's key, and the line is
    // otherwise left alone. Claiming the outer destination as well would mark a
    // note listed that nothing in the file points at, and it would never appear.
    if (link.nested !== undefined) {
      listed.add(linkKey(link.nested));
      continue;
    }
    const key = pathKey(targetPath);
    listed.add(key);
    // A numbered marker is the author's too: §8's bullet is not worth rewriting
    // their list to get, and an entry read this way is never pruned either.
    if (link.ordered) continue;
    const want = canonical.get(key);
    if (want === undefined) {
      // Not in the listing this folder would generate. If it named a note the
      // folder held and that note is gone, the entry goes with it.
      //
      // Ownership is judged on the destination as written, never on the
      // fragment-stripped one: `#` is legal in a folder name, so reading
      // `research#2024/papers/paxos.md` as a fragment would turn a cross-link
      // deeper into the tree into something that looks like a direct child this
      // folder had lost, and destroy the entry for a file that is still there.
      // The stripped path is only a second chance at resolving.
      const whole = decodePath(target).replace(/\/+$/, "");
      const path = decodePath(targetPath).replace(/\/+$/, "");
      if (exists && isOwnEntry(target) && !exists(whole) && (path === whole || !exists(path))) {
        stale.push(i);
        emptied.add(section);
      }
      continue;
    }
    // Right thing, wrong path — a subdirectory listed as `sub/` instead of
    // `sub/index.md`, which Obsidian turns into a new empty note when clicked.
    // Only the destination is rewritten; the rest of the entry is the author's,
    // the heading they linked at included.
    if (!sameTarget(targetPath, want)) {
      lines[i] = link.prefix + want + fragment + trailer + link.suffix;
      changed = true;
    }
  }

  for (let i = stale.length - 1; i >= 0; i--) {
    const at = stale[i];
    lines.splice(at, 1);
    // Don't leave the blank line that set the entry off doubled up.
    if (at > 0 && at < lines.length && !lines[at - 1].trim() && !lines[at].trim()) {
      lines.splice(at, 1);
    }
    changed = true;
  }
  // A heading left with nothing under it by that pruning is a listing for a
  // section that no longer has anything in it. Prose the author wrote under the
  // heading keeps it, and so does the heading being one this plugin never
  // generates: `# Reading list` is the author's even when the entry beneath it
  // named a note that is gone. A type heading that has emptied out is left in
  // place rather than removed, which is the conservative half of that trade.
  const owned = new Set<string>(
    Object.values(INDEX_SECTIONS).map((s) => s.toLowerCase())
  );
  for (const e of entries) owned.add(e.section.trim().toLowerCase());
  for (const name of emptied) {
    if (!name || !owned.has(name.trim().toLowerCase())) continue;
    const at = headingIndex(lines, name);
    if (at < 0) continue;
    let end = at + 1;
    while (end < lines.length && !/^#{1,6}\s+\S/.test(lines[end])) end++;
    if (lines.slice(at + 1, end).every((l) => !l.trim())) lines.splice(at, end - at);
  }

  const missing = entries.filter((e) => !listed.has(linkKey(e.link)));
  if (missing.length > 0) {
    const sections: string[] = [];
    for (const e of missing) {
      if (!sections.includes(e.section)) sections.push(e.section);
    }
    for (const section of sections) {
      appendToSection(
        lines,
        section,
        missing.filter((e) => e.section === section).map(renderEntry)
      );
    }
    changed = true;
  }
  if (!changed) return { text: existing, unlisted: missing };

  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  // A frontmatter block ends at its closing `---` with no newline of its own,
  // so a listing that starts on the body's first line would be glued to the
  // fence — `---# Concepts`, which is a fixpoint no later pass repairs.
  if (prefix && lines.length && lines[0].trim()) lines.unshift("", "");
  // Pruning can empty a listing outright, which is what a folder whose last
  // note was deleted should end up with — the same empty index a rebuild would
  // write, not a lone newline.
  if (lines.length === 0) {
    return { text: prefix ? prefix + eol : "", unlisted: missing };
  }
  return { text: prefix + lines.join(eol) + eol, unlisted: missing };
}

/** The merge itself — see `mergeIndexParts` for what it does and doesn't touch. */
export function mergeIndex(
  existing: string,
  entries: IndexEntry[],
  exists?: (target: string) => boolean, indexPath = "index.md"
): string {
  return mergeIndexParts(existing, entries, exists, indexPath).text;
}

/**
 * The entries an existing `index.md` names nowhere in the file — under any
 * heading, in any order, in whatever grouping its author invented. A vault that
 * keeps its listings by hand wants to be told what slipped rather than have it
 * inserted, so this is the reading `mergeIndex` appends from, stopped one step
 * short of the append.
 */
export function unlistedEntries(
  existing: string,
  entries: IndexEntry[],
  exists?: (target: string) => boolean, indexPath = "index.md"
): IndexEntry[] {
  return mergeIndexParts(existing, entries, exists, indexPath).unlisted;
}

/** Whether a fence is still open when the document runs out of lines. */
function fenceOpenAtEnd(lines: string[]): boolean {
  let fence = "";
  for (const line of lines) {
    const open = line.match(FENCE_RE);
    if (!open) continue;
    if (!fence) fence = open[1][0];
    else if (open[1][0] === fence) fence = "";
  }
  return fence !== "";
}

/**
 * The last position a new line could take without landing inside a fenced
 * block. A fence that never closes runs to the end of the file, so appending
 * below it writes an entry the next pass reads as sample text and appends
 * again — growth with no fixpoint, from nothing worse than a stray ``` in
 * prose. Only that case moves the limit: a document whose fences all close
 * ends at `lines.length` even when its very last line is a closing fence,
 * which `fencedLines` marks as fenced along with the block it terminates.
 */
function writableEnd(lines: string[]): number {
  if (!fenceOpenAtEnd(lines)) return lines.length;
  const fenced = fencedLines(lines);
  let end = lines.length;
  while (end > 0 && fenced[end - 1]) end--;
  return end;
}

/** Appends `items` to the end of `section`'s list, creating the section if absent. */
function appendToSection(
  lines: string[],
  section: string,
  items: string[]
): void {
  const limit = writableEnd(lines);
  const start = headingIndex(lines.slice(0, limit), section);
  if (start < 0) {
    let at = limit;
    while (at > 0 && !lines[at - 1].trim()) at--;
    // Blank lines at the true end of the file are trailing noise; the same
    // lines above an unterminated fence are the author's spacing, and stay.
    const drop = limit === lines.length ? limit - at : 0;
    const head = at > 0 ? ["", `# ${section}`, ""] : [`# ${section}`, ""];
    lines.splice(at, drop, ...head, ...items);
    return;
  }

  let end = start + 1;
  while (end < limit && !/^#{1,6}\s+\S/.test(lines[end])) end++;
  const fenced = fencedLines(lines);
  // A placeholder left by a hand-written index, or by an earlier version of
  // this plugin, gives way to real entries.
  for (let i = end - 1; i > start; i--) {
    if (!fenced[i] && PLACEHOLDER_RE.test(lines[i])) {
      lines.splice(i, 1);
      fenced.splice(i, 1);
      end--;
    }
  }

  let at = -1;
  for (let i = start + 1; i < end; i++) {
    if (!fenced[i] && BULLET_RE.test(lines[i])) at = i + 1;
  }
  if (at < 0) {
    // No list yet: start one below the heading and any prose under it.
    at = end;
    while (at > start + 1 && !lines[at - 1].trim()) at--;
    items = ["", ...items];
  }
  lines.splice(at, 0, ...items);
}

export function validateContent(
  path: string, content: string, isRoot: boolean, settings: OkfSettings,
  today: Date = new Date(), bundle: BundleContext = {}, fm = readFrontmatter(content)
): OkfIssue[] {
  if (dotPath(path) || !path.endsWith(".md")) return [];
  const reserved = isReserved(path);
  if (isRoot && reserved === "index") bundle = { ...bundle, version: fm.version, unreadableRoot: false };
  const issues: OkfIssue[] = [];
  if (!supported(bundle)) issues.push({ severity: "warning", rule: "§12", unknownVersion: true,
    message: bundle.unreadableRoot ? "Cannot determine the bundle version: root index unreadable." :
      `Unsupported okf_version ${bundle.version}; best-effort checks only (known: ${OKF_KNOWN_VERSIONS.join(", ")}).` });
  if (fm.error) return [...issues, { severity: "error", rule: "§4", message: `Invalid YAML frontmatter: ${fm.error}` }];
  if (reserved) issues.push(...validateReferences(path, {}, fm.body, bundle, false));
  if (reserved === "index") return [...issues, ...validateIndex(fm, isRoot, bundle)];
  if (reserved === "log") {
    const ambiguous = !!bundle.observed && bundle.version === undefined && fm.data?.type === "Log";
    return [...issues, ...validateLog(fm, legacy(bundle.version), ambiguous)];
  }
  if (!text(fm.data?.type)) {
    // Even in a declared legacy bundle, the validator does not decide that a README should become a concept.
    issues.push({ severity: legacy(bundle.version) ? "error" : "warning", rule: "§3.2",
      message: `Not a concept: ${fm.hasFm ? "no non-empty string type" : "no frontmatter"}.` });
    return issues;
  }
  return [...issues, ...validateConcept(fm.data!, fm.body, path, settings, today, bundle)];
}

function validateConcept(data: Record<string, unknown>, content: string, path: string, settings: OkfSettings, today: Date, bundle: BundleContext): OkfIssue[] {
  const issues: OkfIssue[] = [];

  const warnFor = new Set(settings.warnMissingFields);
  if (warnFor.has("title") && !hasNonEmpty(data, "title")) {
    issues.push({
      severity: "warning",
      rule: "§4.1",
      message:
        "Optional title missing. Consumers may fall back to the filename.",
      fix: "add-title",
    });
  }
  if (warnFor.has("description") && !hasNonEmpty(data, "description")) {
    issues.push({
      severity: "warning",
      rule: "§4.1",
      message:
        "Optional description missing. Index listings and previews can use a one-line summary.",
    });
  }
  const allowLegacy = bundle.version === undefined || legacy(bundle.version);
  if (allowLegacy && absent(data.generated) && !absent(data.timestamp)) {
    const usable = !!instant(data.timestamp);
    issues.push({ severity: "warning", rule: "Appendix B", message: usable
      ? "Legacy timestamp; use the explicit legacy-field migration if desired."
      : "Legacy timestamp is not a valid date or offset date-time; left as authored.",
      ...(usable ? { fix: "migrate-timestamp" as const } : {}) });
  } else if (warnFor.has("generated") && absent(data.generated)) {
    issues.push({ severity: "warning", rule: "§5.2", message: "Optional generated field is missing.",
      // Do not invent a last-change date and thereby invalidate existing verification history.
      ...(absent(data.verified) && absent(data.timestamp) ? { fix: "add-generated" as const } : {}) });
  }
  if (settings.warnTrustFields || warnFor.has("generated")) issues.push(...validateSignals(data, today, !settings.warnTrustFields));

  if (items(data.tags).some(tag => !text(tag))) {
    issues.push({ severity: "warning", rule: "§4.1", message: "tags should contain strings; a scalar string is one tag." });
  }
  if (warnFor.has("tags") && absent(data.tags)) {
    issues.push({
      severity: "warning",
      rule: "§4.1",
      message: "Optional tags missing.",
    });
  }

  if (allowLegacy && !("sources" in data) && citationsHeading(content) !== undefined) {
    issues.push({ severity: "warning", rule: "Appendix B", message: "Legacy Citations section; migrate only if desired.",
      ...(migrateCitations(content) ? { fix: "migrate-citations" as const } : {}) });
  }

  issues.push(...validateReferences(path, data, content, bundle, settings.checkAttestedComputation));

  if (settings.enablePortent) {
    issues.push(...validatePortent(data, settings));
  }

  return issues;
}



/**
 * §11.1: a reserved file follows §8 when present. Not optional — the
 * structure of an `index.md` that exists is part of what makes a bundle
 * conformant, while a *missing* one is explicitly permitted (§8, §11).
 */
function validateIndex(fm: ReturnType<typeof readFrontmatter>, isRoot: boolean, bundle: BundleContext): OkfIssue[] {
  const issues: OkfIssue[] = [];
  if (fm.hasFm && !isRoot) issues.push({ severity: "error", rule: "§8", message: "Only the bundle-root index.md may contain frontmatter (§8.1)." });
  if (isRoot && fm.data) {
    if (!absent(fm.data.okf_version) && typeof fm.data.okf_version !== "string") issues.push({ severity: "warning", rule: "§8.1", message: "Quote okf_version as a major.minor string." });
    for (const key of ["title", "description", "license"]) {
      if (!absent(fm.data[key]) && !text(fm.data[key])) issues.push({ severity: "warning", rule: "§8.1", message: `Bundle ${key} should be a string.` });
    }
    const license = fm.data.license;
    if (text(license) && license.includes("/") && bundle.exists) {
      const target = localTarget("index.md", license);
      if (target !== null && bundle.exists(target, true) === false) issues.push({ severity: "warning", rule: "§8.1", message: `License file ${license} not found in the bundle.` });
    }
  }
  const body = fm.body;
  const hasHeading = /^#{1,6}\s+\S/m.test(body);
  // Entries are read with the same scanner `mergeIndex` uses, so one reader
  // decides what an entry is. A pattern that stops at the first `]` can't see
  // the line `renderEntry` writes for a title holding brackets (`Rev [2]`), and
  // an index this plugin had just generated would be reported as listing
  // nothing. A wikilink entry counts too: the merger treats it as a listing, so
  // §8 shouldn't be raised against an index written entirely in that syntax.
  const hasLinkBullet = indexLinks(body).size > 0 || body
    .split(/\r?\n/)
    .some((l) => parseBulletLink(l) !== null || BULLET_WIKILINK_RE.test(l));
  // An empty directory has nothing to enumerate, and §8 asks an index to
  // enumerate what is there. This plugin now leaves such an index empty, which
  // the `body.trim()` guard below already passes; a listing holding only its
  // headings and a `_No concepts yet._` placeholder is saying the same thing in
  // words — written by hand, or by an earlier version of this plugin — and is
  // let through on the same grounds.
  const saysEmpty = body
    .split(/\r?\n/)
    .every(
      (l) => !l.trim() || /^#{1,6}\s+\S/.test(l) || PLACEHOLDER_RE.test(l)
    );
  if (body.trim().length > 0 && !hasLinkBullet && !saysEmpty) {
    issues.push({
      severity: "warning",
      rule: "§8",
      message:
        "`index.md` should list directory contents as bulleted markdown links grouped under section headings (progressive disclosure).",
    });
  } else if (hasLinkBullet && !hasHeading) {
    issues.push({
      severity: "warning",
      rule: "§8",
      message:
        "`index.md` entries should be grouped under at least one section heading.",
    });
  }

  return issues;
}

/** §11.1: `log.md` follows §9 when present. */
function validateLog(fm: ReturnType<typeof readFrontmatter>, legacyBundle: boolean, ambiguous: boolean): OkfIssue[] {
  const issues: OkfIssue[] = [];

  if (fm.hasFm) {
    issues.push({
      severity: legacyBundle || ambiguous ? "warning" : "error",
      ...(ambiguous ? { unknownVersion: true } : {}),
      rule: "§9",
      message: ambiguous ? "Legacy type: Log in an unversioned bundle: permitted in v0.2, not v0.3; declare the intended version." : "OKF v0.3 log.md has no frontmatter.",
    });
  }

  const h2s = logHeadings(fm.body);
  if (h2s.length === 0) {
    issues.push({
      severity: "warning",
      rule: "§9",
      message:
        "`log.md` should contain date-grouped entries under `## YYYY-MM-DD` headings.",
    });
    return issues;
  }

  const dates: string[] = [];
  for (const h of h2s) {
    if (!ISO_DATE_RE.test(h) || !instant(h)) {
      issues.push({
        severity: "error",
        rule: "§9",
        message: `Log date heading "## ${h}" must be ISO 8601 \`YYYY-MM-DD\`.`,
      });
    } else {
      dates.push(h);
    }
  }

  for (let i = 1; i < dates.length; i++) {
    if (dates[i] > dates[i - 1]) {
      issues.push({
        severity: "warning",
        rule: "§9",
        message: `Log entries should be newest-first; "${dates[i]}" appears after "${dates[i - 1]}".`,
      });
      break;
    }
  }

  return issues;
}

function hasNonEmpty(data: Record<string, unknown>, key: string): boolean {
  const v = data[key];
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

// JSON strings cover YAML quoting and ASCII controls. Also escape characters
// that YAML readers can interpret as non-printable or physical line breaks.
function yamlString(value: string): string {
  return JSON.stringify(value).replace(/[\u007f-\u009f\u2028\u2029\ufffe\uffff]/g,
    ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Move only the top-level YAML scalar. Its tag/anchor, comments, and quoted
 * or multiline spelling travel with it. Do not stringify the rest of the map. */
function relocateTimestamp(header: string, map: YAMLMap, indent: string, actor: string, eol: string): string | null {
  const pair = map.items.find(p => isScalar(p.key) && p.key.value === "timestamp");
  if (!pair || !isScalar(pair.key) || !pair.key.range || !isScalar(pair.value) || !pair.value.range || !text(pair.value.value)) return null;
  const [key, keyEnd] = pair.key.range, [start, end] = pair.value.range;
  const separator = header.slice(keyEnd, start);
  if (header.slice(header.lastIndexOf("\n", key - 1) + 1, key) !== indent || !/^[ \t]*:/.test(separator)) return null;
  let scalar = header.slice(start, end);
  if (pair.value.type === "PLAIN" && !pair.value.tag && /^\d{4}-\d\d?-\d\d?/.test(scalar)) {
    // A timestamp-resolving reader must not normalize a numeric offset or
    // fractional precision. For folded plain text retain the actual line folds.
    scalar = scalar.includes("\n") ? `!!str ${scalar}` : yamlString(scalar);
  }
  const nested = (separator + scalar).replace(/\n(?=[^\r\n])/g, "\n  ");
  return header.slice(0, key) + `generated:${eol}${indent}  by: ${actor}${eol}${indent}  at${nested}` + header.slice(end);
}

export function applyFixes(path: string, content: string, issues: OkfIssue[], settings: OkfSettings, migrateOnly = false): { content: string; applied: string[] } {
  const unchanged = { content, applied: [] as string[] };
  if (dotPath(path) || isReserved(path) || issues.some(i => i.unknownVersion)) return unchanged;
  const fm = readFrontmatter(content);
  if (!fm.data || !text(fm.data.type) || !fm.sourceMap || fm.sourceMap.flow) return unchanged;
  const fixes = new Set(issues.filter(i => !i.providerId).map(i => i.fix));
  const open = content.slice(0, content.indexOf("\n") + 1), eol = open.endsWith("\r\n") ? "\r\n" : "\n";
  const actor = yamlString(settings.defaultActor || DEFAULT_SETTINGS.defaultActor);
  const applied: string[] = [], additions: string[] = [];
  let header = content.slice(open.length, content.length - fm.body.length - 3), body = fm.body;
  const first = fm.sourceMap.items[0]?.key;
  if (!isScalar(first) || !first.range) return unchanged;
  const indent = header.slice(header.lastIndexOf("\n", first.range[0] - 1) + 1, first.range[0]);
  if (!/^ *$/.test(indent)) return unchanged;
  let writtenAt: string | undefined;
  if (migrateOnly) {
    if (fixes.has("migrate-timestamp") && !("generated" in fm.data) && text(fm.data.timestamp)) {
      const moved = relocateTimestamp(header, fm.sourceMap, indent, actor, eol);
      if (moved !== null) { header = moved; writtenAt = fm.data.timestamp; applied.push("migrated timestamp → generated"); }
    }
    if (fixes.has("migrate-citations") && !("sources" in fm.data)) {
      const migrated = migrateCitations(body);
      if (migrated) {
        additions.push("sources:", ...migrated.resources.map(r => `  - resource: ${yamlString(r)}`));
        body = migrated.body; applied.push("migrated Citations → sources");
      }
    }
  } else {
    if (fixes.has("add-title") && !("title" in fm.data)) {
      additions.push(`title: ${yamlString(basename(path))}`); applied.push("added title");
    }
    if (fixes.has("add-generated") && !("generated" in fm.data) && absent(fm.data.timestamp) && absent(fm.data.verified)) {
      writtenAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      additions.push("generated:", `  by: ${actor}`, `  at: ${yamlString(writtenAt)}`); applied.push("added generated");
    }
  }
  if (!applied.length) return unchanged;
  const candidate = open + header + additions.map(line => indent + line + eol).join("") + "---" + body;
  // If a flow mapping, unusual indentation, alias, etc. cannot be edited this
  // way, keep the original bytes instead of re-serializing the author's YAML.
  const after = readFrontmatter(candidate).data;
  if (!after || after.type !== fm.data.type || additions.some(line => !line.startsWith(" ") && !(line.split(":", 1)[0] in after))) return unchanged;
  if (writtenAt !== undefined && (!mapping(after.generated) || after.generated.at !== writtenAt || after.generated.by !== (settings.defaultActor || DEFAULT_SETTINGS.defaultActor))) return unchanged;
  return { content: candidate, applied };
}

/** Migrate only a simple list of bare resources. Mixed prose, titled links,
 * code samples and anything ambiguous stay verbatim for a human to migrate. */
function migrateCitations(body: string): { body: string; resources: string[] } | null {
  const lines = body.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const start = citationsHeading(body);
  if (start === undefined) return null;
  const resources: string[] = [];
  let end = start + 1;
  while (end < lines.length && !/^#\s+/.test(lines[end])) {
    const line = lines[end++].trimEnd();
    if (!line.trim()) continue;
    const item = /^[-*+]\s+(\S+)$/.exec(line);
    if (!item || /[<>\[\]`]/.test(item[1])) return null;
    resources.push(item[1]);
  }
  return resources.length ? { resources, body: lines.slice(0, start).join("") + lines.slice(end).join("") } : null;
}
