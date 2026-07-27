// portent.ts — optional Portent (https://portent.md) validation layer.
//
// Portent is a knowledge-base spec layered *on top of* OKF; it is not part of
// the OKF spec, so nothing here can make a bundle non-conformant — every issue
// is a warning. Users opt in via `PortentSettings.enablePortent`. This module
// owns Portent's vocabulary, settings, and checks so the OKF core in
// validator.ts stays focused on the spec itself.

import type { OkfIssue } from "./validator";

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

/**
 * Portent configuration. Composed into the plugin's settings object, so the
 * fields live flat alongside the OKF settings for backward compatibility with
 * persisted `data.json`.
 */
export interface PortentSettings {
  /**
   * Enable additional validation against the Portent knowledge-base spec
   * (https://portent.md). When on, notes are checked for Portent's default
   * type vocabulary, lifecycle metadata, and relationship shape — in addition
   * to the baseline OKF rules.
   */
  enablePortent: boolean;
  /**
   * Free-form Portent schema. Field-name settings map each Portent concept onto
   * whatever frontmatter key the vault actually uses (e.g. `status` → `state`),
   * and the vocabulary lists define the accepted `type` and lifecycle values.
   * This lets users follow their own conventions — or a future revision of the
   * spec — without waiting for a plugin update. Consulted only when
   * `enablePortent` is true; blank values fall back to the Portent v0 defaults.
   */
  portentTypes: string[];
  portentStatusField: string;
  portentStatuses: string[];
  portentOrganizedField: string;
  portentArchivedField: string;
  portentBelongsToField: string;
  portentRelatedToField: string;
  /**
   * Per-check toggles for Portent's optional fields. Each gates one optional-
   * field check and defaults to on (matching prior behavior) when Portent is
   * enabled — turn a check off to skip validating an optional field the vault
   * does not use.
   */
  portentCheckTypeVocab: boolean;
  portentCheckLifecycle: boolean;
  portentCheckBelongsTo: boolean;
  portentCheckRelatedTo: boolean;
}

export const PORTENT_DEFAULTS: PortentSettings = {
  enablePortent: false,
  portentTypes: [...PORTENT_TYPES],
  portentStatusField: "status",
  portentStatuses: [...PORTENT_STATUSES],
  portentOrganizedField: "organized",
  portentArchivedField: "archived",
  portentBelongsToField: "belongs_to",
  portentRelatedToField: "related_to",
  portentCheckTypeVocab: true,
  portentCheckLifecycle: true,
  portentCheckBelongsTo: true,
  portentCheckRelatedTo: true,
};

const WIKILINK_RE = /^\[\[[^[\]]+?\]\]$/;

function hasNonEmpty(data: Record<string, unknown>, key: string): boolean {
  const v = data[key];
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * Portent checks — layered on top of OKF.
 *
 * Every issue is a **warning**: non-default types and malformed
 * lifecycle/relationship values never block a bundle from being
 * OKF-conformant. The schema is free-form (see `PortentSettings`): field names
 * are remapped onto the vault's own frontmatter keys and the `type`/lifecycle
 * vocabularies come from settings, so a renamed field (e.g. `status` → `state`)
 * or a future spec revision needs no code change. Blank settings fall back to
 * the Portent v0 defaults.
 */
export function validatePortent(
  data: Record<string, unknown>,
  settings: PortentSettings
): OkfIssue[] {
  const issues: OkfIssue[] = [];
  const type = data["type"];

  const types = settings.portentTypes.length
    ? settings.portentTypes
    : [...PORTENT_TYPES];
  const statuses = settings.portentStatuses.length
    ? settings.portentStatuses
    : [...PORTENT_STATUSES];
  const statusField = settings.portentStatusField || "status";
  const organizedField = settings.portentOrganizedField || "organized";
  const archivedField = settings.portentArchivedField || "archived";
  const belongsToField = settings.portentBelongsToField || "belongs_to";
  const relatedToField = settings.portentRelatedToField || "related_to";

  // Type must come from the configured vocabulary (or be an intentional
  // extension). Only warn — the spec explicitly allows extensions.
  if (
    settings.portentCheckTypeVocab &&
    typeof type === "string" &&
    type.trim().length > 0
  ) {
    const t = type.trim();
    if (!types.includes(t)) {
      issues.push({
        severity: "warning",
        rule: "portent/types",
        message: `\`type: ${t}\` is not one of the Portent types (${types.join(
          ", "
        )}). Extend intentionally or switch to a configured type.`,
      });
    }
  }

  // Lifecycle metadata is representation-free (Portent — "Lifecycle Fields"):
  // an object MAY omit it entirely (organized by default) and implementations
  // choose their own field names, so a *missing* lifecycle is never flagged.
  // When a recognized field is present we still offer a light value check — the
  // spec says statuses SHOULD map to captured/organized/archived, and the
  // boolean flags are true/false.
  if (settings.portentCheckLifecycle && statusField in data) {
    const s = data[statusField];
    if (typeof s !== "string" || !statuses.includes(s.trim())) {
      issues.push({
        severity: "warning",
        rule: "portent/lifecycle",
        message: `\`${statusField}\` should map to one of ${statuses.join(
          " | "
        )}.`,
      });
    }
  }
  if (
    settings.portentCheckLifecycle &&
    organizedField in data &&
    typeof data[organizedField] !== "boolean"
  ) {
    issues.push({
      severity: "warning",
      rule: "portent/lifecycle",
      message: `\`${organizedField}\` should be a boolean (true/false).`,
    });
  }
  if (
    settings.portentCheckLifecycle &&
    archivedField in data &&
    typeof data[archivedField] !== "boolean"
  ) {
    issues.push({
      severity: "warning",
      rule: "portent/lifecycle",
      message: `\`${archivedField}\` should be a boolean (true/false).`,
    });
  }

  // Relationships: belongs_to (single wikilink) and related_to (list). An empty
  // value — null, blank string, or empty list — is treated as "not set" (e.g. a
  // template placeholder) and never warns; only a non-empty malformed value does.
  if (settings.portentCheckBelongsTo && belongsToField in data) {
    const bt = data[belongsToField];
    if (hasNonEmpty(data, belongsToField)) {
      if (typeof bt === "string") {
        if (!WIKILINK_RE.test(bt.trim())) {
          issues.push({
            severity: "warning",
            rule: "portent/relationships",
            message: `\`${belongsToField}\` should be a single wikilink like \`"[[Parent Note]]"\`.`,
          });
        }
      } else {
        issues.push({
          severity: "warning",
          rule: "portent/relationships",
          message: `\`${belongsToField}\` denotes a single primary parent — expected one wikilink string, not a list or object.`,
        });
      }
    }
  }

  if (settings.portentCheckRelatedTo && relatedToField in data) {
    const rt = data[relatedToField];
    if (hasNonEmpty(data, relatedToField)) {
      if (!Array.isArray(rt)) {
        issues.push({
          severity: "warning",
          rule: "portent/relationships",
          message: `\`${relatedToField}\` should be a YAML list of wikilinks (may be empty).`,
        });
      } else {
        const bad = rt.filter(
          (v) => typeof v !== "string" || !WIKILINK_RE.test(v.trim())
        );
        if (bad.length > 0) {
          issues.push({
            severity: "warning",
            rule: "portent/relationships",
            message: `\`${relatedToField}\` entries should be wikilinks like \`"[[Other Note]]"\` (${bad.length} entr${
              bad.length === 1 ? "y is" : "ies are"
            } not).`,
          });
        }
      }
    }
  }

  return issues;
}
