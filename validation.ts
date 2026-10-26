// Internal content/report adapter. Only api.ts is the consumer-facing contract.
import type { ApiErrorCode } from "./api";
import type { ApiDiagnostic, CheckCoverage, Conformance, ContentReport, ContentRequest, ReportMetadata } from "./validation-types";
import { OKF_VERSION, validateContent, type OkfIssue, type OkfSettings } from "./validator";
import { PORTENT_TYPES, PORTENT_STATUSES } from "./portent";

export interface EvaluationContext { pluginVersion: string; now: Date }

export function apiError(code: ApiErrorCode, message: string): Error & { code: ApiErrorCode } {
  return Object.assign(new Error(message), { name: "OkfApiError", code });
}

/** Settings are persisted plain JSON; copy all nested arrays, never host objects. */
export function snapshotSettings(settings: OkfSettings): OkfSettings {
  return JSON.parse(JSON.stringify(settings));
}

export function reportMetadata(settings: OkfSettings, context: EvaluationContext): ReportMetadata {
  const disabledErrorChecks = settings.checkAttestedComputation ? [] : ["checkAttestedComputation"];
  return {
    apiVersion: 1,
    pluginVersion: context.pluginVersion,
    okfVersion: OKF_VERSION,
    evaluatedAt: context.now.toISOString(),
    checkCoverage: disabledErrorChecks.length ? "reduced" : "full",
    disabledErrorChecks,
    enabledChecks: {
      structure: true,
      checkAttestedComputation: settings.checkAttestedComputation,
      warnMissingFields: [...settings.warnMissingFields],
      warnTrustFields: settings.warnTrustFields,
      reportIndexGaps: settings.reportIndexGaps,
      portent: {
        enabled: settings.enablePortent,
        types: settings.portentTypes.length ? [...settings.portentTypes] : [...PORTENT_TYPES],
        statuses: settings.portentStatuses.length ? [...settings.portentStatuses] : [...PORTENT_STATUSES],
        fields: {
          status: settings.portentStatusField || "status",
          organized: settings.portentOrganizedField || "organized",
          archived: settings.portentArchivedField || "archived",
          belongs_to: settings.portentBelongsToField || "belongs_to",
          related_to: settings.portentRelatedToField || "related_to",
        },
        checks: [
          settings.portentCheckTypeVocab && "type",
          settings.portentCheckLifecycle && "lifecycle",
          settings.portentCheckBelongsTo && "belongs_to",
          settings.portentCheckRelatedTo && "related_to",
        ].filter((check): check is string => !!check),
      },
    },
  };
}

export function publicDiagnostics(issues: readonly OkfIssue[]): ApiDiagnostic[] {
  return issues.map(({ rule, severity, message, providerId, providerName }) => ({
    source: providerId ?? (rule.startsWith("portent/") ? "portent" : "okf"),
    ...(providerName ? { sourceName: providerName } : {}), rule, severity, message,
  }));
}

export function conformanceFor(issues: readonly OkfIssue[], coverage: CheckCoverage, complete = true): Conformance {
  if (!complete || coverage !== "full") return "unknown";
  return issues.some((issue) => issue.severity === "error" && !issue.providerId && !issue.rule.startsWith("portent/"))
    ? "non-conformant" : "conformant";
}

export function validateProvidedContent(input: ContentRequest, settings: OkfSettings, context: EvaluationContext): ContentReport {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      typeof input.path !== "string" || typeof input.content !== "string" ||
      !input.path.endsWith(".md") || /^[A-Za-z]:/.test(input.path) ||
      /[\\\x00-\x1f]/.test(input.path) ||
      input.path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw apiError("invalid-request", "Expected Markdown content and a vault-relative .md path without absolute paths, backslashes or dot segments.");
  }
  const metadata = reportMetadata(settings, context);
  const issues = validateContent(input.path, input.content, !input.path.includes("/"), settings, context.now);
  return {
    ...metadata,
    scope: { kind: "content", path: input.path },
    conformance: conformanceFor(issues, metadata.checkCoverage),
    diagnostics: publicDiagnostics(issues),
  };
}
