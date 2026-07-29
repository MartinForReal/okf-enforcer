// validator.ts — OKF v0.2 conformance engine
// Spec: GoogleCloudPlatform/knowledge-catalog/okf/SPEC.md (v0.2)
// Targets v0.2 with v0.1 back-compat: a legacy `timestamp` is read as a
// fallback for `generated.at`, and a legacy `# Citations` body list is
// recognized as a fallback for `sources` (SPEC §13).

import { parseYaml } from "obsidian";
import {
  PortentSettings,
  PORTENT_DEFAULTS,
  validatePortent,
} from "./portent";

/** The OKF spec version this engine targets. */
export const OKF_VERSION = "0.2";
/** Versions a bundle may declare in its root index.md `okf_version` (§12). */
export const OKF_KNOWN_VERSIONS = ["0.1", "0.2"] as const;

export type Severity = "error" | "warning";

export interface OkfIssue {
  severity: Severity;
  rule: string;
  message: string;
  fix?: FixKind;
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

/** OKF v0.2 lifecycle values for `status` (§5.4). Absent ⇒ `stable`. */
export const OKF_STATUSES = ["draft", "stable", "deprecated"] as const;

/**
 * Actor convention (§7): `<producer>/<version>`, `human:<id>`, or
 * `process:<id>`. Used by `generated.by` and `verified[].by`. Trust tiers key
 * off the `human:` prefix, so the shape matters.
 */
const ACTOR_RE = /^(human:.+|process:.+|[^/\s]+\/[^/\s]+)$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;

/**
 * Plugin settings: the OKF core plus the composed Portent layer (see
 * `PortentSettings`). Portent fields live flat here — rather than nested — for
 * backward compatibility with persisted `data.json` from prior versions.
 */
export interface OkfSettings extends PortentSettings {
  defaultType: string;
  /**
   * Actor written to `generated.by` when auto-fix creates a `generated` block
   * (§5.2, §7). Follows the actor convention — e.g. `okf-enforcer/0.4` for the
   * plugin, or `human:<id>` if a person wants edits attributed to them.
   */
  defaultActor: string;
  warnRecommendedFields: boolean;
  /**
   * Validate the v0.2 trust/lifecycle families when present: `verified`
   * shape + actors, `status` vocabulary, `stale_after` date form (§5.2–§5.5).
   * Advisory — off by default so vaults not using these fields stay quiet.
   */
  warnTrustFields: boolean;
  /**
   * Validate `Attested Computation` concepts (§10): required `runtime`,
   * `parameters`/`executor`/`attester` shape, and a present computation.
   */
  checkAttestedComputation: boolean;
  warnTagsField: boolean;
  warnBrokenLinks: boolean;
  liveCheckOnSave: boolean;
  scanOnStartup: boolean;
  fixOnSave: boolean;
  autoGenerateIndex: boolean;
  /**
   * Overwrite an existing `index.md` when generating (§8). On by default —
   * generate/refresh rewrites the listing from the folder's contents. Turn it
   * off to make generation additive: a missing `index.md` is still created, but
   * an existing one — and any prose written into it — is never touched.
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
   * Let ordinary auto-fix (including fix-on-save) also apply the v0.1→v0.2
   * migrations — rename `timestamp`→`generated`, lift `# Citations`→`sources`.
   * On by default. Turn off to keep migrations manual (only via the explicit
   * "Migrate note to OKF v0.2" command), since they rewrite existing content.
   */
  autoMigrateOnFix: boolean;
  batchSize: number;
  excludeFolders: string[];
}

export const DEFAULT_SETTINGS: OkfSettings = {
  defaultType: "Concept",
  defaultActor: "okf-enforcer/0.4",
  warnRecommendedFields: true,
  warnTrustFields: false,
  checkAttestedComputation: true,
  warnTagsField: false,
  warnBrokenLinks: false,
  liveCheckOnSave: true,
  scanOnStartup: true,
  fixOnSave: true,
  autoGenerateIndex: true,
  overwriteExistingIndex: true,
  indexSubdirDescSection: "",
  autoMigrateOnFix: true,
  batchSize: 50,
  excludeFolders: ["Templates"],
  ...PORTENT_DEFAULTS,
};

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The `verified` events as a list (§5.2). A single verifier MAY be written as a
 * bare `{ by, at }` mapping without the list dash; consumers MUST treat it as a
 * one-element list.
 */
export function normalizeVerified(
  data: Record<string, unknown>
): Record<string, unknown>[] {
  const v = data["verified"];
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.filter((e) => e && typeof e === "object") as Record<string, unknown>[];
  if (typeof v === "object") return [v as Record<string, unknown>];
  return [];
}

/**
 * Trust tier derived from `verified` (§5.3), lowest to highest:
 * no `verified` ⇒ "unverified"; only non-`human:` actors ⇒ "machine-confirmed";
 * any `human:<id>` actor ⇒ "human-reviewed".
 */
export function trustTier(
  data: Record<string, unknown>
): "unverified" | "machine-confirmed" | "human-reviewed" {
  const events = normalizeVerified(data);
  if (events.length === 0) return "unverified";
  for (const e of events) {
    if (String(e["by"] ?? "").startsWith("human:")) return "human-reviewed";
  }
  return "machine-confirmed";
}

/**
 * Whether a concept is stale per `stale_after` (§5.5): stale when
 * `today >= stale_after`. False when absent or unparseable.
 */
export function isStale(
  data: Record<string, unknown>,
  today: Date = new Date()
): boolean {
  const raw = data["stale_after"];
  if (!raw) return false;
  const s = String(raw).slice(0, 10);
  if (!ISO_DATE_RE.test(s)) return false;
  const t = today.toISOString().slice(0, 10);
  return t >= s;
}

export function basename(path: string): string {
  const f = path.split("/").pop() || path;
  return f.replace(/\.md$/i, "");
}

export function isReserved(path: string): "index" | "log" | null {
  const f = (path.split("/").pop() || "").toLowerCase();
  if (f === "index.md") return "index";
  if (f === "log.md") return "log";
  return null;
}

export function isExcluded(path: string, settings: OkfSettings): boolean {
  return settings.excludeFolders.some(
    (folder) => folder && (path === folder || path.startsWith(folder + "/"))
  );
}

export function splitFrontmatter(
  content: string
): { hasFm: boolean; raw: string; body: string } {
  const m = content.match(FM_RE);
  if (!m) return { hasFm: false, raw: "", body: content };
  return { hasFm: true, raw: m[1], body: content.slice(m[0].length) };
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

export function validateContent(
  path: string,
  content: string,
  isRoot: boolean,
  settings: OkfSettings
): OkfIssue[] {
  const reserved = isReserved(path);
  if (reserved === "index") return validateIndex(content, isRoot);
  if (reserved === "log") return validateLog(content);
  return validateConcept(path, content, settings);
}

function validateConcept(
  path: string,
  content: string,
  settings: OkfSettings
): OkfIssue[] {
  const issues: OkfIssue[] = [];
  const { hasFm, raw } = splitFrontmatter(content);

  if (!hasFm) {
    issues.push({
      severity: "error",
      rule: "§11",
      message:
        "No YAML frontmatter block. Every OKF concept must begin with a `---` delimited frontmatter block.",
      fix: "add-frontmatter",
    });
    return issues;
  }

  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = parseYaml(raw);
    if (parsed && typeof parsed === "object") {
      data = parsed as Record<string, unknown>;
    }
  } catch (e) {
    issues.push({
      severity: "error",
      rule: "§11",
      message: `Frontmatter is not parseable YAML: ${
        (e as Error).message || e
      }`,
    });
    return issues;
  }

  const type = data["type"];
  const typeOk = typeof type === "string" && type.trim().length > 0;
  if (!typeOk) {
    // OKF §4.1 defines `type` as a single short string, and §11 makes a
    // non-empty `type` the only always-required key. Distinguish the failure
    // modes so the message is actionable, and only offer the insert-a-value
    // auto-fix when we can apply it safely (field absent or an empty string).
    // A list or other non-string value must be resolved by the author — we
    // never silently discard their data.
    const issue: OkfIssue = {
      severity: "error",
      rule: "§11",
      message:
        "`type` field is present but empty. It must be a non-empty string.",
    };
    if (type === undefined) {
      issue.message = "Missing required `type` field.";
      issue.fix = "add-type";
    } else if (Array.isArray(type)) {
      issue.message =
        "`type` must be a single string, not a list (OKF §4.1 — only `tags` is list-valued).";
    } else if (typeof type !== "string") {
      issue.message = "`type` must be a non-empty string (OKF §4.1).";
    } else {
      issue.fix = "add-type";
    }
    issues.push(issue);
  }

  if (settings.warnRecommendedFields) {
    if (!hasNonEmpty(data, "title")) {
      issues.push({
        severity: "warning",
        rule: "§4.1",
        message:
          "Recommended `title` missing. Consumers may fall back to the filename.",
        fix: "add-title",
      });
    }
    if (!hasNonEmpty(data, "description")) {
      issues.push({
        severity: "warning",
        rule: "§4.1",
        message:
          "Recommended `description` (one-line summary) missing. Used in index listings, search snippets, and previews.",
      });
    }
    // §5.2: `generated: { by, at }` records how the current content was
    // produced and when it last meaningfully changed, superseding v0.1's
    // `timestamp`. A legacy `timestamp` is accepted as a fallback (§13.1) and
    // surfaces a migrate hint rather than a "missing" warning.
    const generated = data["generated"];
    const hasGenerated = generated !== null && typeof generated === "object";
    const legacyTs = data["timestamp"];
    const hasLegacyTs = typeof legacyTs === "string" && legacyTs.length > 0;
    if (hasGenerated) {
      const g = generated as Record<string, unknown>;
      if (!hasNonEmpty(g, "by")) {
        issues.push({
          severity: "warning",
          rule: "§5.2",
          message: "`generated.by` (an actor) is required within `generated`.",
        });
      } else if (!ACTOR_RE.test(String(g["by"]).trim())) {
        issues.push({
          severity: "warning",
          rule: "§7",
          message:
            "`generated.by` should follow the actor convention: `<producer>/<version>`, `human:<id>`, or `process:<id>`.",
        });
      }
      if (g["at"] !== undefined && !ISO_DATETIME_RE.test(String(g["at"]))) {
        issues.push({
          severity: "warning",
          rule: "§5.2",
          message: "`generated.at` is not a parseable ISO 8601 datetime.",
        });
      }
    } else if (hasLegacyTs) {
      issues.push({
        severity: "warning",
        rule: "§13.1",
        message:
          "Legacy `timestamp` found. OKF v0.2 records this as `generated: { by, at }` — run \"Migrate note to OKF v0.2\".",
        fix: "migrate-timestamp",
      });
    } else {
      issues.push({
        severity: "warning",
        rule: "§5.2",
        message:
          "Recommended `generated: { by, at }` missing (records who produced the content and when).",
        fix: "add-generated",
      });
    }
  }

  if (settings.warnTagsField && !("tags" in data)) {
    issues.push({
      severity: "warning",
      rule: "§4.1",
      message: "Recommended `tags` list missing.",
    });
  }

  // §13.1: the v0.1 body `# Citations` list is superseded by `sources`.
  if (/^#{1,6}\s+Citations\s*$/m.test(content) && !("sources" in data)) {
    issues.push({
      severity: "warning",
      rule: "§13.1",
      message:
        "Legacy `# Citations` section found. OKF v0.2 records provenance in the `sources` frontmatter field — run \"Migrate note to OKF v0.2\".",
      fix: "migrate-citations",
    });
  }

  if (settings.warnTrustFields) {
    issues.push(...validateTrustFamilies(data));
  }

  if (
    settings.checkAttestedComputation &&
    typeof type === "string" &&
    type.trim() === "Attested Computation"
  ) {
    issues.push(...validateAttestedComputation(data, content));
  }

  if (settings.enablePortent) {
    issues.push(...validatePortent(data, settings));
  }

  return issues;
}

/**
 * Provenance/trust/lifecycle family checks (§5). All advisory warnings — a
 * concept missing any of these is still conformant (§11). Gated by
 * `settings.warnTrustFields`.
 */
function validateTrustFamilies(data: Record<string, unknown>): OkfIssue[] {
  const issues: OkfIssue[] = [];

  // `verified` (§5.2): a list of `{ by, at }` events, or a bare mapping.
  if ("verified" in data && data["verified"] !== null) {
    const events = normalizeVerified(data);
    const raw = data["verified"];
    if (events.length === 0 && raw !== undefined) {
      issues.push({
        severity: "warning",
        rule: "§5.2",
        message:
          "`verified` should be a `{ by, at }` mapping or a list of them.",
      });
    }
    for (const e of events) {
      if (!hasNonEmpty(e, "by")) {
        issues.push({
          severity: "warning",
          rule: "§5.2",
          message: "A `verified` entry is missing its `by` actor.",
        });
      } else if (!ACTOR_RE.test(String(e["by"]).trim())) {
        issues.push({
          severity: "warning",
          rule: "§7",
          message: `\`verified\` actor \`${String(
            e["by"]
          )}\` should follow the actor convention (\`<producer>/<version>\`, \`human:<id>\`, \`process:<id>\`).`,
        });
      }
      if (e["at"] !== undefined && !ISO_DATETIME_RE.test(String(e["at"]))) {
        issues.push({
          severity: "warning",
          rule: "§5.2",
          message: "A `verified` entry's `at` is not a parseable ISO 8601 datetime.",
        });
      }
    }
  }

  // `status` (§5.4): draft | stable | deprecated. Absent ⇒ stable.
  if ("status" in data) {
    const s = data["status"];
    if (typeof s !== "string" || !OKF_STATUSES.includes(s.trim() as never)) {
      issues.push({
        severity: "warning",
        rule: "§5.4",
        message: `\`status\` should be one of ${OKF_STATUSES.join(" | ")}.`,
      });
    }
  }

  // `stale_after` (§5.5): an absolute YYYY-MM-DD date.
  if ("stale_after" in data && data["stale_after"] != null) {
    const s = String(data["stale_after"]).slice(0, 10);
    if (!ISO_DATE_RE.test(s)) {
      issues.push({
        severity: "warning",
        rule: "§5.5",
        message: "`stale_after` should be an absolute date (`YYYY-MM-DD`).",
      });
    }
  }

  // `sources` (§5.1): a list; each entry needs a `resource`.
  if ("sources" in data && data["sources"] != null) {
    const src = data["sources"];
    if (!Array.isArray(src)) {
      issues.push({
        severity: "warning",
        rule: "§5.1",
        message: "`sources` should be a YAML list of source entries.",
      });
    } else {
      src.forEach((entry, i) => {
        if (!entry || typeof entry !== "object") {
          issues.push({
            severity: "warning",
            rule: "§5.1",
            message: `\`sources[${i}]\` should be a mapping with at least a \`resource\`.`,
          });
          return;
        }
        const e = entry as Record<string, unknown>;
        if (!hasNonEmpty(e, "resource")) {
          issues.push({
            severity: "warning",
            rule: "§5.1",
            message: `\`sources[${i}]\` is missing the required \`resource\`.`,
          });
        }
        if ("usage_count" in e && typeof e["usage_count"] !== "number") {
          issues.push({
            severity: "warning",
            rule: "§5.1",
            message: `\`sources[${i}].usage_count\` should be a number.`,
          });
        }
        if (
          "last_modified" in e &&
          e["last_modified"] != null &&
          !ISO_DATE_RE.test(String(e["last_modified"]).slice(0, 10))
        ) {
          issues.push({
            severity: "warning",
            rule: "§5.1",
            message: `\`sources[${i}].last_modified\` should be an absolute date (\`YYYY-MM-DD\`).`,
          });
        }
      });
    }
  }

  return issues;
}

/**
 * Attested Computation concept checks (§10). A sanctioned way to compute a
 * value: `runtime` is required for the type; the computation must be present
 * (an inline `# Computation` fence or a `computation` path); `executor` and
 * `attester` carry the run + check interface.
 */
function validateAttestedComputation(
  data: Record<string, unknown>,
  content: string
): OkfIssue[] {
  const issues: OkfIssue[] = [];

  if (!hasNonEmpty(data, "runtime")) {
    issues.push({
      severity: "error",
      rule: "§10.2",
      message:
        "`runtime` is required for an Attested Computation (e.g. `bigquery`, `dbt`, `python`).",
    });
  }

  if ("parameters" in data && data["parameters"] != null) {
    const params = data["parameters"];
    if (!Array.isArray(params)) {
      issues.push({
        severity: "warning",
        rule: "§10.2",
        message: "`parameters` should be a list of `{ name, type, required }`.",
      });
    } else {
      params.forEach((p, i) => {
        if (!p || typeof p !== "object" || !hasNonEmpty(p as Record<string, unknown>, "name")) {
          issues.push({
            severity: "warning",
            rule: "§10.2",
            message: `\`parameters[${i}]\` should have at least a \`name\`.`,
          });
        }
      });
    }
  }

  // The computation itself: an inline body `# Computation` fence, or a
  // `computation` path (§10.3). Warn when neither is present.
  const hasComputationHeading = /^#{1,6}\s+Computation\s*$/m.test(content);
  if (!hasComputationHeading && !hasNonEmpty(data, "computation")) {
    issues.push({
      severity: "warning",
      rule: "§10.3",
      message:
        "An Attested Computation needs its computation — either a body `# Computation` fenced block or a `computation` path.",
    });
  }

  if ("executor" in data && data["executor"] != null) {
    const ex = data["executor"];
    if (!ex || typeof ex !== "object") {
      issues.push({
        severity: "warning",
        rule: "§10.2",
        message: "`executor` should be a mapping with `resource` and `receipt`.",
      });
    } else {
      const e = ex as Record<string, unknown>;
      if (!hasNonEmpty(e, "resource")) {
        issues.push({
          severity: "warning",
          rule: "§10.2",
          message: "`executor.resource` (run instructions or code) is missing.",
        });
      }
      if ("receipt" in e && !Array.isArray(e["receipt"])) {
        issues.push({
          severity: "warning",
          rule: "§10.2",
          message: "`executor.receipt` should be a list of fields a run must return.",
        });
      }
    }
  }

  if ("attester" in data && data["attester"] != null) {
    const at = data["attester"];
    if (!at || typeof at !== "object" || !hasNonEmpty(at as Record<string, unknown>, "resource")) {
      issues.push({
        severity: "warning",
        rule: "§10.2",
        message: "`attester.resource` (deterministic check code) is missing.",
      });
    }
  }

  return issues;
}

/**
 * §11 rule 3: a reserved file follows §8 when present. Not optional — the
 * structure of an `index.md` that exists is part of what makes a bundle
 * conformant, while a *missing* one is explicitly permitted (§8, §11).
 */
function validateIndex(content: string, isRoot: boolean): OkfIssue[] {
  const issues: OkfIssue[] = [];

  const split = splitFrontmatter(content);
  const hasFm = split.hasFm;
  const raw = split.raw;

  if (hasFm) {
    if (!isRoot) {
      issues.push({
        severity: "error",
        rule: "§8",
        message:
          "Non-root `index.md` must not contain frontmatter (§8). Only the bundle-root index.md may, and only for `okf_version`.",
      });
    } else {
      let data: Record<string, unknown> = {};
      try {
        const parsed: unknown = parseYaml(raw);
        if (parsed && typeof parsed === "object") {
          data = parsed as Record<string, unknown>;
        }
      } catch {
        issues.push({
          severity: "error",
          rule: "§12",
          message: "Root `index.md` frontmatter is not parseable YAML.",
        });
        return issues;
      }
      const keys = Object.keys(data);
      const extra = keys.filter((k) => k !== "okf_version");
      if (extra.length > 0) {
        issues.push({
          severity: "error",
          rule: "§12",
          message: `Root index.md frontmatter may only contain \`okf_version\`. Unexpected key(s): ${extra.join(
            ", "
          )}.`,
        });
      }
      if (
        "okf_version" in data &&
        !OKF_KNOWN_VERSIONS.includes(String(data["okf_version"]) as never)
      ) {
        issues.push({
          severity: "warning",
          rule: "§12",
          message: `Declared okf_version "${data["okf_version"]}" is not one of ${OKF_KNOWN_VERSIONS.join(
            " / "
          )} (this validator targets v${OKF_VERSION}).`,
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

/** §11 rule 3 for the other reserved file: `log.md` follows §9 when present. */
function validateLog(content: string): OkfIssue[] {
  const issues: OkfIssue[] = [];

  const { hasFm } = splitFrontmatter(content);
  if (hasFm) {
    issues.push({
      severity: "warning",
      rule: "§9",
      message: "`log.md` is not expected to contain frontmatter.",
    });
  }

  const h2s: string[] = [];
  const h2Re = /^##\s+(.+?)\s*$/gm;
  let h2Match: RegExpExecArray | null;
  while ((h2Match = h2Re.exec(content)) !== null) {
    h2s.push(h2Match[1].trim());
  }
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
    if (!ISO_DATE_RE.test(h)) {
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

export function applyFixes(
  path: string,
  content: string,
  issues: OkfIssue[],
  settings: OkfSettings,
  includeMigrations = false
): { content: string; applied: string[] } {
  const applied: string[] = [];
  const MIGRATIONS: FixKind[] = ["migrate-timestamp", "migrate-citations"];
  const fixes = new Set(
    issues
      .map((i) => i.fix)
      .filter(
        (f): f is FixKind =>
          !!f && (includeMigrations || !MIGRATIONS.includes(f))
      )
  );
  if (fixes.size === 0) return { content, applied };

  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const actor = settings.defaultActor || "okf-enforcer/0.4";
  const title = basename(path);
  const split = splitFrontmatter(content);

  if (!split.hasFm) {
    const lines = [
      `type: ${settings.defaultType}`,
      `title: ${title}`,
      `generated: { by: ${actor}, at: ${nowIso} }`,
    ];
    const fm = `---\n${lines.join("\n")}\n---\n\n`;
    applied.push("added frontmatter (type, title, generated)");
    return { content: fm + content.replace(/^\s+/, ""), applied };
  }

  const fmLines = split.raw.split(/\r?\n/);
  let body = split.body;
  const hasKey = (k: string) =>
    fmLines.some((l) => new RegExp(`^${k}\\s*:`).test(l.trim()));

  if (fixes.has("add-type") && !hasKey("type")) {
    fmLines.unshift(`type: ${settings.defaultType}`);
    applied.push(`added type: ${settings.defaultType}`);
  }
  if (fixes.has("add-title") && !hasKey("title")) {
    fmLines.push(`title: ${title}`);
    applied.push("added title");
  }
  if (fixes.has("add-generated") && !hasKey("generated")) {
    fmLines.push(`generated: { by: ${actor}, at: ${nowIso} }`);
    applied.push("added generated");
  }

  // §13.1 migration: rewrite a legacy `timestamp: X` into `generated: { by, at: X }`,
  // preserving the original timestamp value as `generated.at`.
  if (fixes.has("migrate-timestamp") && hasKey("timestamp") && !hasKey("generated")) {
    for (let i = 0; i < fmLines.length; i++) {
      const m = fmLines[i].match(/^(\s*)timestamp\s*:\s*(.+?)\s*$/);
      if (m) {
        const at = m[2].replace(/^["']|["']$/g, "");
        fmLines[i] = `${m[1]}generated: { by: ${actor}, at: ${at} }`;
        applied.push("migrated timestamp → generated");
        break;
      }
    }
  }

  // §13.1 migration: lift a body `# Citations` list into a `sources` frontmatter
  // block and drop the section. Each bullet becomes a `{ resource }` entry.
  if (fixes.has("migrate-citations") && !hasKey("sources")) {
    const migrated = migrateCitations(body);
    if (migrated) {
      body = migrated.body;
      fmLines.push("sources:");
      for (const r of migrated.resources) fmLines.push(`  - resource: ${r}`);
      applied.push(`migrated # Citations → sources (${migrated.resources.length})`);
    }
  }

  const rebuilt = `---\n${fmLines.join("\n")}\n---${body}`;
  return { content: rebuilt, applied };
}

/**
 * Extract a body `# Citations` section into source resources and return the body
 * with that section removed. Returns null when there's no such section or it
 * holds no bullet entries.
 */
function migrateCitations(
  body: string
): { body: string; resources: string[] } | null {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s+Citations\s*$/.test(l));
  if (start === -1) return null;

  // The section runs until the next heading of the same-or-higher level (any
  // `#`-prefixed line here) or end of file.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s+\S/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const resources: string[] = [];
  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(/^\s*[-*]\s+(.+?)\s*$/);
    if (m) resources.push(m[1].replace(/^["']|["']$/g, ""));
  }
  if (resources.length === 0) return null;

  const kept = [...lines.slice(0, start), ...lines.slice(end)];
  // Collapse the blank-line gap the removed section may leave behind.
  const newBody = kept.join("\n").replace(/\n{3,}/g, "\n\n");
  return { body: newBody, resources };
}