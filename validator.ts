// validator.ts — OKF v0.1 conformance engine
// Spec: GoogleCloudPlatform/knowledge-catalog/okf/SPEC.md (v0.1 draft)

import { parseYaml } from "obsidian";

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
  | "add-timestamp";

export interface OkfSettings {
  defaultType: string;
  warnRecommendedFields: boolean;
  warnTagsField: boolean;
  warnBrokenLinks: boolean;
  checkReservedFiles: boolean;
  liveCheckOnSave: boolean;
  scanOnStartup: boolean;
  fixOnSave: boolean;
  autoGenerateIndex: boolean;
  batchSize: number;
  excludeFolders: string[];
  /**
   * Enable additional validation against the Portent knowledge-base spec
   * (https://portent.md). When on, notes are checked for Portent's default
   * type vocabulary, lifecycle metadata, and relationship shape — in addition
   * to the baseline OKF rules.
   */
  enablePortent: boolean;
}

export const DEFAULT_SETTINGS: OkfSettings = {
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
  excludeFolders: ["Templates"],
  enablePortent: false,
};

/**
 * Portent v0 default vocabulary.
 * Source: https://portent.md/types — "PORT" (actionable) + "ENTP" (records).
 */
export const PORTENT_TYPES = [
  "Project",
  "Operation",
  "Responsibility",
  "Task",
  "Event",
  "Note",
  "Topic",
  "Person",
] as const;

/** Portent lifecycle values when using the single-field `status` form. */
export const PORTENT_STATUSES = ["captured", "organized", "archived"] as const;

const WIKILINK_RE = /^\[\[[^[\]]+?\]\]$/;

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

export function validateContent(
  path: string,
  content: string,
  isRoot: boolean,
  settings: OkfSettings
): OkfIssue[] {
  const reserved = isReserved(path);
  if (reserved === "index") return validateIndex(content, isRoot, settings);
  if (reserved === "log") return validateLog(content, settings);
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
      rule: "§9.1",
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
      rule: "§9.1",
      message: `Frontmatter is not parseable YAML: ${
        (e as Error).message || e
      }`,
    });
    return issues;
  }

  const type = data["type"];
  const typeOk = typeof type === "string" && type.trim().length > 0;
  if (!typeOk) {
    // OKF §4.1 defines `type` as a single short string. Distinguish the
    // failure modes so the message is actionable, and only offer the
    // insert-a-value auto-fix when we can apply it safely (field absent or
    // an empty string). A list or other non-string value must be resolved
    // by the author — we never silently discard their data.
    const issue: OkfIssue = {
      severity: "error",
      rule: "§9.2",
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
    if (!hasNonEmpty(data, "timestamp")) {
      issues.push({
        severity: "warning",
        rule: "§4.1",
        message: "Recommended `timestamp` (ISO 8601 last-modified) missing.",
        fix: "add-timestamp",
      });
    } else if (
      typeof data["timestamp"] === "string" &&
      isNaN(Date.parse(data["timestamp"]))
    ) {
      issues.push({
        severity: "warning",
        rule: "§4.1",
        message: "`timestamp` is not a parseable ISO 8601 datetime.",
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

  if (settings.enablePortent) {
    issues.push(...validatePortent(data));
  }

  return issues;
}

/**
 * Portent (https://portent.md) checks — layered on top of OKF v0.1.
 *
 * Portent is not part of the OKF spec, so every issue here is a **warning**:
 * missing lifecycle metadata, non-default types, and malformed relationship
 * values never block a bundle from being OKF-conformant. Users opt in via
 * `settings.enablePortent`.
 */
function validatePortent(data: Record<string, unknown>): OkfIssue[] {
  const issues: OkfIssue[] = [];
  const type = data["type"];

  // Type must come from the 8-item default vocabulary (or be an intentional
  // extension). Only warn — the spec explicitly allows extensions.
  if (typeof type === "string" && type.trim().length > 0) {
    const t = type.trim();
    if (!(PORTENT_TYPES as readonly string[]).includes(t)) {
      issues.push({
        severity: "warning",
        rule: "portent/types",
        message: `\`type: ${t}\` is not one of Portent's default types (${PORTENT_TYPES.join(
          ", "
        )}). Extend intentionally or switch to a default.`,
      });
    }
  }

  // Lifecycle: either boolean `organized`/`archived`, or a single `status`.
  const hasOrganized = "organized" in data;
  const hasArchived = "archived" in data;
  const hasStatus = "status" in data;
  if (!hasOrganized && !hasArchived && !hasStatus) {
    issues.push({
      severity: "warning",
      rule: "portent/lifecycle",
      message:
        "Portent lifecycle metadata missing. Add `status: captured|organized|archived`, or boolean `organized`/`archived` fields.",
    });
  } else {
    if (hasStatus) {
      const s = data["status"];
      if (
        typeof s !== "string" ||
        !(PORTENT_STATUSES as readonly string[]).includes(s.trim())
      ) {
        issues.push({
          severity: "warning",
          rule: "portent/lifecycle",
          message: `\`status\` must be one of ${PORTENT_STATUSES.join(
            " | "
          )}.`,
        });
      }
    }
    if (hasOrganized && typeof data["organized"] !== "boolean") {
      issues.push({
        severity: "warning",
        rule: "portent/lifecycle",
        message: "`organized` should be a boolean (true/false).",
      });
    }
    if (hasArchived && typeof data["archived"] !== "boolean") {
      issues.push({
        severity: "warning",
        rule: "portent/lifecycle",
        message: "`archived` should be a boolean (true/false).",
      });
    }
  }

  // Relationships: `belongs_to` (single wikilink) and `related_to` (list).
  if ("belongs_to" in data) {
    const bt = data["belongs_to"];
    if (bt !== null && bt !== undefined) {
      if (typeof bt === "string") {
        if (!WIKILINK_RE.test(bt.trim())) {
          issues.push({
            severity: "warning",
            rule: "portent/relationships",
            message:
              "`belongs_to` should be a single wikilink like `\"[[Parent Note]]\"`.",
          });
        }
      } else {
        issues.push({
          severity: "warning",
          rule: "portent/relationships",
          message:
            "`belongs_to` denotes a single primary parent — expected one wikilink string, not a list or object.",
        });
      }
    }
  }

  if ("related_to" in data) {
    const rt = data["related_to"];
    if (rt !== null && rt !== undefined) {
      if (!Array.isArray(rt)) {
        issues.push({
          severity: "warning",
          rule: "portent/relationships",
          message:
            "`related_to` should be a YAML list of wikilinks (may be empty).",
        });
      } else {
        const bad = rt.filter(
          (v) => typeof v !== "string" || !WIKILINK_RE.test(v.trim())
        );
        if (bad.length > 0) {
          issues.push({
            severity: "warning",
            rule: "portent/relationships",
            message: `\`related_to\` entries should be wikilinks like \`"[[Other Note]]"\` (${bad.length} entr${
              bad.length === 1 ? "y is" : "ies are"
            } not).`,
          });
        }
      }
    }
  }

  return issues;
}

function validateIndex(
  content: string,
  isRoot: boolean,
  settings: OkfSettings
): OkfIssue[] {
  const issues: OkfIssue[] = [];
  if (!settings.checkReservedFiles) return issues;

  const split = splitFrontmatter(content);
  const hasFm = split.hasFm;
  const raw = split.raw;

  if (hasFm) {
    if (!isRoot) {
      issues.push({
        severity: "error",
        rule: "§6",
        message:
          "Non-root `index.md` must not contain frontmatter (§6). Only the bundle-root index.md may, and only for `okf_version`.",
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
          rule: "§11",
          message: "Root `index.md` frontmatter is not parseable YAML.",
        });
        return issues;
      }
      const keys = Object.keys(data);
      const extra = keys.filter((k) => k !== "okf_version");
      if (extra.length > 0) {
        issues.push({
          severity: "error",
          rule: "§11",
          message: `Root index.md frontmatter may only contain \`okf_version\`. Unexpected key(s): ${extra.join(
            ", "
          )}.`,
        });
      }
      if ("okf_version" in data && String(data["okf_version"]) !== "0.1") {
        issues.push({
          severity: "warning",
          rule: "§11",
          message: `Declared okf_version "${data["okf_version"]}" is not "0.1" (this validator targets v0.1).`,
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
      rule: "§6",
      message:
        "`index.md` should list directory contents as bulleted markdown links grouped under section headings (progressive disclosure).",
    });
  } else if (hasLinkBullet && !hasHeading) {
    issues.push({
      severity: "warning",
      rule: "§6",
      message:
        "`index.md` entries should be grouped under at least one section heading.",
    });
  }

  return issues;
}

function validateLog(content: string, settings: OkfSettings): OkfIssue[] {
  const issues: OkfIssue[] = [];
  if (!settings.checkReservedFiles) return issues;

  const { hasFm } = splitFrontmatter(content);
  if (hasFm) {
    issues.push({
      severity: "warning",
      rule: "§7",
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
      rule: "§7",
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
        rule: "§7",
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
        rule: "§7",
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
  settings: OkfSettings
): { content: string; applied: string[] } {
  const applied: string[] = [];
  const fixes = new Set(issues.filter((i) => i.fix).map((i) => i.fix));
  if (fixes.size === 0) return { content, applied };

  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const title = basename(path);
  const split = splitFrontmatter(content);

  if (!split.hasFm) {
    const lines = [
      `type: ${settings.defaultType}`,
      `title: ${title}`,
      `timestamp: ${nowIso}`,
    ];
    const fm = `---\n${lines.join("\n")}\n---\n\n`;
    applied.push("added frontmatter (type, title, timestamp)");
    return { content: fm + content.replace(/^\s+/, ""), applied };
  }

  const fmLines = split.raw.split(/\r?\n/);
  const body = split.body;
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
  if (fixes.has("add-timestamp") && !hasKey("timestamp")) {
    fmLines.push(`timestamp: ${nowIso}`);
    applied.push("added timestamp");
  }

  const rebuilt = `---\n${fmLines.join("\n")}\n---${body}`;
  return { content: rebuilt, applied };
}