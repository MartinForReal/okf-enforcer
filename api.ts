// Public, host-independent API v1 contract. This module imports no provider code.
export type Conformance = "conformant" | "non-conformant" | "unknown";
export type CheckCoverage = "full" | "reduced";
export type ApiErrorCode = "invalid-request" | "unavailable" | "busy";
export interface ApiDiagnostic {
  readonly source: "okf" | "portent";
  readonly rule: string;
  readonly severity: "error" | "warning";
  readonly message: string;
}
export interface EnabledChecks {
  readonly structure: true;
  readonly checkAttestedComputation: boolean;
  readonly warnMissingFields: readonly string[];
  readonly warnTrustFields: boolean;
  readonly reportIndexGaps: boolean;
  readonly portent: {
    readonly enabled: boolean;
    readonly types: readonly string[];
    readonly statuses: readonly string[];
    readonly fields: Readonly<Record<string, string>>;
    readonly checks: readonly string[];
  };
}
export interface ReportMetadata {
  readonly apiVersion: 1;
  readonly pluginVersion: string;
  readonly okfVersion: string;
  readonly evaluatedAt: string;
  readonly enabledChecks: EnabledChecks;
  readonly checkCoverage: CheckCoverage;
  readonly disabledErrorChecks: readonly string[];
}
export interface ContentRequest { readonly path: string; readonly content: string }
export interface ContentReport extends ReportMetadata {
  readonly scope: { readonly kind: "content"; readonly path: string };
  readonly conformance: Conformance;
  readonly diagnostics: readonly ApiDiagnostic[];
}
export interface OutcomeCounts {
  readonly candidates: number;
  readonly validated: number;
  readonly unreadable: number;
  readonly unprocessed: number;
}
export interface ScanOutcome {
  readonly path: string;
  readonly status: "validated" | "unreadable" | "unprocessed";
  readonly diagnostics: readonly ApiDiagnostic[];
  readonly error?: { readonly code: "read-failed"; readonly message: string };
}
export interface FolderOutcome extends ScanOutcome { readonly findingPath?: string }
export interface VaultReport extends ReportMetadata {
  readonly scope: {
    readonly kind: "configured-vault";
    readonly excludeFolders: readonly string[];
    readonly configDir: string;
  };
  readonly status: "complete" | "partial" | "cancelled";
  readonly conformance: Conformance;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly files: readonly ScanOutcome[];
  readonly folders: readonly FolderOutcome[];
  readonly counts: { readonly files: OutcomeCounts; readonly folders: OutcomeCounts };
}
export interface ScanOptions { readonly signal?: AbortSignal }
export interface OkfApiV1 {
  readonly apiVersion: 1;
  readonly pluginVersion: string;
  readonly okfVersion: string;
  validateContent(request: ContentRequest): Promise<ContentReport>;
  scanVault(options?: ScanOptions): Promise<VaultReport>;
}

/**
 * Conventional discovery uses PRIVATE Obsidian internals. Absence is also
 * initialization/incompatibility/unsupported discovery, not proof of no install.
 * Reacquire for each action; a retained facade may reject with unavailable.
 */
export function getOkfApi(app: unknown): OkfApiV1 | undefined {
  try {
    const api = (app as { plugins?: { plugins?: Record<string, { apiV1?: unknown }> } })
      ?.plugins?.plugins?.["okf-enforcer"]?.apiV1 as Partial<OkfApiV1> | undefined;
    if (api?.apiVersion === 1 && typeof api.pluginVersion === "string" &&
        typeof api.okfVersion === "string" && typeof api.validateContent === "function" &&
        typeof api.scanVault === "function") return api as OkfApiV1;
  } catch { /* A future host may remove or reject access to these internals. */ }
  return undefined;
}
