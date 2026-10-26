// Internal provider registry: bounded async work, attribution, no core-rule mutation.
import { parseYaml } from "obsidian";
import type { ValidationContext, ValidationDiagnostic, ValidationProvider } from "./api";
import { isReserved, splitFrontmatter, type OkfIssue } from "./validator";
import { apiError } from "./validation";

interface Entry {
  id: string;
  name: string;
  validate: ValidationProvider["validate"];
  active: boolean;
  pending: Set<() => void>;
}
export interface ValidatorSnapshot { readonly revision: number; readonly entries: readonly Entry[] }
export interface ValidatorAssessment {
  id: string;
  name: string;
  status: "passed" | "findings" | "failed" | "cancelled";
  reason?: "exception" | "invalid-result" | "timeout" | "cancelled";
}
export interface ExtensionEvaluation {
  revision: number;
  issues: OkfIssue[];
  assessments: ValidatorAssessment[];
  complete: boolean;
}
interface ProviderResult { issues: OkfIssue[]; assessment: ValidatorAssessment }

function messageOf(error: unknown): string {
  try { return error instanceof Error ? error.message : String(error); }
  catch { return "Unknown validator failure"; }
}

/** Copy/freeze structured YAML without sharing aliases or mutating prototypes. */
function immutableData(value: ValidationContext["frontmatter"]): ValidationContext["frontmatter"];
function immutableData(value: ValidationContext["coreDiagnostics"]): ValidationContext["coreDiagnostics"];
function immutableData(value: unknown, seen?: WeakMap<object, unknown>): unknown;
function immutableData(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  if (seen.has(value)) return seen.get(value);
  const copy = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  for (const key of Object.keys(value)) {
    Object.defineProperty(copy, key, { value: immutableData((value as Record<string, unknown>)[key], seen), enumerable: true });
  }
  return Object.freeze(copy);
}

function contextTemplate(path: string, content: string, core: readonly OkfIssue[], now: Date): Omit<ValidationContext, "signal"> {
  const parts = splitFrontmatter(content);
  let frontmatter: Record<string, unknown> | null = null;
  let frontmatterState: ValidationContext["frontmatterState"] = parts.hasFm ? "invalid" : "missing";
  if (parts.hasFm) {
    try {
      const parsed: unknown = parseYaml(parts.raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        frontmatter = parsed as Record<string, unknown>; frontmatterState = "valid";
      }
    } catch { /* Body validators still receive explicit invalid frontmatter. */ }
  }
  return { path, content, kind: isReserved(path) ?? "concept", body: parts.body,
    frontmatter, frontmatterState, evaluatedAt: now.toISOString(),
    coreDiagnostics: core.filter((issue) => !issue.providerId && !issue.rule.startsWith("portent/"))
      .map(({ rule, severity, message }) => ({ rule, severity, message })) };
}

export class ExtensionRegistry {
  private entries = new Map<string, Entry>();
  private version = 0;
  private disposed = false;
  constructor(private onChange: () => void = () => {}, private timeoutMs = 2000) {}

  get revision(): number { return this.version; }

  register(provider: ValidationProvider): () => void {
    if (this.disposed) throw apiError("unavailable", "The validation host has unloaded; reacquire its API.");
    if (!provider || typeof provider !== "object" || typeof provider.id !== "string" ||
        !/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/.test(provider.id) ||
        /^(okf|okf-enforcer)(\/|$)/.test(provider.id) || typeof provider.name !== "string" ||
        !provider.name.trim() || typeof provider.validate !== "function") {
      throw apiError("invalid-provider", "A validator needs a unique non-reserved lowercase ID, display name, and validate callback.");
    }
    if (this.entries.has(provider.id)) throw apiError("duplicate-provider", `Validator ID is already registered: ${provider.id}`);
    const entry: Entry = { id: provider.id, name: provider.name.trim(), validate: provider.validate.bind(provider), active: true, pending: new Set() };
    this.entries.set(entry.id, entry); this.changed();
    return () => {
      if (!entry.active) return;
      entry.active = false;
      if (this.entries.get(entry.id) === entry) this.entries.delete(entry.id);
      [...entry.pending].forEach((cancel) => cancel()); this.changed();
    };
  }

  snapshot(): ValidatorSnapshot { return { revision: this.version, entries: [...this.entries.values()] }; }

  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const entry of this.entries.values()) {
      entry.active = false; [...entry.pending].forEach((cancel) => cancel());
    }
    this.entries.clear(); this.version++;
  }

  async validate(path: string, content: string, core: readonly OkfIssue[], now: Date,
    snapshot = this.snapshot(), signal?: AbortSignal): Promise<ExtensionEvaluation> {
    if (!snapshot.entries.length) return { revision: snapshot.revision, issues: [], assessments: [], complete: true };
    const template = contextTemplate(path, content, core, now);
    const results = await Promise.all(snapshot.entries.map((entry) => this.invoke(entry, template, signal)));
    return { revision: snapshot.revision, issues: results.flatMap((result) => result.issues),
      assessments: results.map((result) => result.assessment),
      complete: results.every((result) => result.assessment.status === "passed" || result.assessment.status === "findings") };
  }

  private changed() { this.version++; this.onChange(); }

  private invoke(entry: Entry, template: Omit<ValidationContext, "signal">, signal?: AbortSignal): Promise<ProviderResult> {
    const cancelled = (): ProviderResult => ({ issues: [], assessment: { id: entry.id, name: entry.name, status: "cancelled", reason: "cancelled" } });
    const failed = (reason: "exception" | "invalid-result" | "timeout", message: string): ProviderResult => ({
      assessment: { id: entry.id, name: entry.name, status: "failed", reason },
      issues: [{ severity: "warning", rule: "validator/failure", message: `Validator ${entry.name} failed: ${message}`,
        providerId: entry.id, providerName: entry.name, providerFailure: true }],
    });
    if (!entry.active || this.disposed || signal?.aborted) return Promise.resolve(cancelled());
    return new Promise((resolve) => {
      const controller = new AbortController(); let done = false;
      let timer: number | undefined;
      const finish = (result: ProviderResult) => {
        if (done) return; done = true;
        if (timer !== undefined) window.clearTimeout(timer);
        signal?.removeEventListener("abort", cancel); entry.pending.delete(cancel); resolve(result);
      };
      const cancel = () => { finish(cancelled()); controller.abort(); };
      entry.pending.add(cancel);
      if (signal?.aborted) { cancel(); return; }
      signal?.addEventListener("abort", cancel, { once: true });
      timer = window.setTimeout(() => {
        finish(failed("timeout", `asynchronous deadline exceeded (${this.timeoutMs} ms)`)); controller.abort();
      }, this.timeoutMs);
      const context: ValidationContext = Object.freeze({ ...template,
        frontmatter: immutableData(template.frontmatter), coreDiagnostics: immutableData(template.coreDiagnostics), signal: controller.signal });
      Promise.resolve().then(() => {
        if (done || !entry.active) return [];
        return entry.validate(context);
      }).then((diagnostics) => {
        if (done) return;
        if (!entry.active || this.disposed) { cancel(); return; }
        try {
          if (!Array.isArray(diagnostics)) throw new Error("expected an array of diagnostics");
          // Array.from visits holes too; sparse output is malformed, not success.
          const issues: OkfIssue[] = Array.from(diagnostics, (diagnostic: ValidationDiagnostic) => {
            if (!diagnostic || typeof diagnostic.rule !== "string" || !diagnostic.rule.trim() ||
                typeof diagnostic.message !== "string" || !diagnostic.message.trim() ||
                (diagnostic.severity !== "error" && diagnostic.severity !== "warning")) {
              throw new Error("each diagnostic needs rule, message and error/warning severity");
            }
            return { rule: diagnostic.rule, message: diagnostic.message, severity: diagnostic.severity,
              providerId: entry.id, providerName: entry.name };
          });
          finish({ issues, assessment: { id: entry.id, name: entry.name, status: issues.length ? "findings" : "passed" } });
        } catch (error) { finish(failed("invalid-result", messageOf(error))); }
      }, (error) => { finish(failed("exception", messageOf(error))); });
    });
  }
}
