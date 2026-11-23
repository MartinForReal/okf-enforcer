// §5 consumer semantics. Signals never change structural conformance.
import { absent, items, legacy, mapping, text, type Mapping } from "./frontmatter";
import type { OkfIssue } from "./validator";

const actor = (v: unknown): v is string => text(v) && /^(?:[^\s/:]+\/\S+|[A-Za-z][A-Za-z\d+.-]*:(?=.*\S).+)$/.test(v);
export const OKF_STATUSES = ["draft", "stable", "deprecated"] as const;
const stamp = /^(\d{4}-\d\d-\d\d)(?:[Tt](\d\d):(\d\d):(\d\d)(?:\.(\d+))?(?:[Zz]|([+-])(\d\d):(\d\d)))?$/;
type Instant = { seconds: number; leap: number; fraction: string };

/** Parse the RFC 3339 spelling before comparing. Date.parse alone normalizes
 * invalid dates, accepts local times, and rounds away sub-millisecond reviews. */
export function instant(value: unknown): Instant | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) value = value.toISOString();
  const m = typeof value === "string" && stamp.exec(value);
  if (!m) return null;
  const day = Date.parse(`${m[1]}T00:00:00Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== m[1]) return null;
  const [hour, minute, second, offsetH, offsetM] = [m[2], m[3], m[4], m[7], m[8]].map(n => Number(n ?? 0));
  if (hour > 23 || minute > 59 || second > 60 || offsetH > 23 || offsetM > 59) return null;
  const offset = (m[6] === "-" ? -1 : 1) * (offsetH * 60 + offsetM);
  const seconds = day / 1000 + (hour * 60 + minute - offset) * 60 + Math.min(second, 59);
  if (second === 60) {
    // A leap second can only be inserted at the end of a UTC month.
    const next = new Date((seconds + 1) * 1000);
    if (next.getUTCDate() !== 1 || next.getUTCHours() || next.getUTCMinutes() || next.getUTCSeconds()) return null;
  }
  return { seconds, leap: Number(second === 60), fraction: (m[5] ?? "").replace(/0+$/, "") };
}
function compare(a: Instant, b: Instant): number {
  return a.seconds - b.seconds || a.leap - b.leap || (a.fraction > b.fraction ? 1 : a.fraction < b.fraction ? -1 : 0);
}

export function normalizeVerified(data: Mapping): Mapping[] { return items(data.verified).filter(mapping); }

export function trustTier(data: Mapping, version?: string): "unverified" | "machine-confirmed" | "human-reviewed" {
  let baseline: Instant | null = null;
  if (!absent(data.generated)) {
    baseline = mapping(data.generated) ? instant(data.generated.at) : null;
    if (!baseline) return "unverified"; // no evidence this review covers this generation
  } else if ((!version || legacy(version)) && !absent(data.timestamp)) {
    baseline = instant(data.timestamp);
    if (!baseline) return "unverified";
  }
  let machine = false;
  for (const event of normalizeVerified(data)) {
    if (!actor(event.by)) continue;
    const at = instant(event.at);
    if (!at || (baseline && compare(at, baseline) < 0)) continue;
    if (event.by.startsWith("human:")) return "human-reviewed";
    machine = true;
  }
  return machine ? "machine-confirmed" : "unverified";
}

function freshness(value: unknown, now: Date): "absent" | "malformed" | "due" | "fresh" {
  if (absent(value)) return "absent";
  const deadline = instant(value), current = instant(now);
  return !deadline || !current ? "malformed" : compare(current, deadline) >= 0 ? "due" : "fresh";
}
export function isStale(data: Mapping, now = new Date()): boolean {
  const state = freshness(data.stale_after, now);
  return state === "due" || state === "malformed";
}

export function validateSignals(data: Mapping, now: Date, onlyGenerated: boolean): OkfIssue[] {
  const issues: OkfIssue[] = [];
  const warn = (rule: string, message: string) => issues.push({severity: "warning", rule, message});
  const checkAt = (name: string, value: unknown) => {
    if (!absent(value) && !instant(value)) warn("§5", `${name}: expected an RFC 3339 date or date-time with offset.`);
  };
  const checkActor = (name: string, value: unknown) => {
    if (!actor(value)) warn("§7", `${name}: expected a <producer>/<version> or <scheme>:<id> actor.`);
  };
  if (!absent(data.generated)) {
    if (!mapping(data.generated) || !text(data.generated.by)) warn("§5.2", "generated needs a by actor.");
    else { checkActor("generated.by", data.generated.by); checkAt("generated.at", data.generated.at); }
  }
  if (onlyGenerated) return issues;
  for (const [i, e] of items(data.verified).entries()) {
    if (!mapping(e) || !text(e.by) || absent(e.at)) { warn("§5.2", `verified[${i}] needs by and at; event ignored.`); continue; }
    checkActor(`verified[${i}].by`, e.by); checkAt(`verified[${i}].at`, e.at);
  }
  if (!absent(data.status) && !OKF_STATUSES.some(s => s === data.status)) {
    warn("§5.4", `Unknown status ${text(data.status) ? data.status : "(non-string)"}; not considered stable.`);
  }
  if (!absent(data.superseded_by) && (data.status !== "deprecated" || !text(data.superseded_by))) {
    warn("§5.4", "superseded_by is a single replacement path, meaningful only with status: deprecated.");
  }
  const state = freshness(data.stale_after, now);
  if (state === "malformed") warn("§5.5", "Malformed stale_after; freshness is unknown, not fresh.");
  if (state === "due") warn("§5.5", "stale_after has passed; this concept is due for review.");
  const window = (name: string, w: unknown) => {
    if (absent(w)) return;
    if (!mapping(w) || absent(w.from) || absent(w.to)) warn("§5.1", `${name} needs from and to timestamps.`);
    else { checkAt(`${name}.from`, w.from); checkAt(`${name}.to`, w.to); }
  };
  window("usage_window", data.usage_window);
  for (const [i, e] of items(data.sources).entries()) {
    const name = `sources[${i}]`;
    if (!mapping(e) || !text(e.resource)) { warn("§5.1", `${name} needs a resource; entry ignored.`); continue; }
    if (!absent(e.author)) checkActor(`${name}.author`, e.author);
    if (!absent(e.usage_count) && typeof e.usage_count !== "number") warn("§5.1", `${name}.usage_count should be a number.`);
    checkAt(`${name}.last_modified`, e.last_modified); window(`${name}.usage_window`, e.usage_window);
  }
  return issues;
}
