// Internal read models for Enforcer's collector/UI, not the extension API.
export type Conformance = "conformant" | "non-conformant" | "unknown";
export type CheckCoverage = "full" | "reduced";
export interface ApiDiagnostic {
  readonly source: string;
  readonly sourceName?: string;
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
  readonly portent: { readonly enabled: boolean; readonly types: readonly string[];
    readonly statuses: readonly string[]; readonly fields: Readonly<Record<string, string>>; readonly checks: readonly string[] };
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
export interface OutcomeCounts { readonly candidates: number; readonly validated: number; readonly unreadable: number; readonly unprocessed: number }
export interface ScanOutcome {
  readonly path: string;
  readonly status: "validated" | "unreadable" | "unprocessed";
  readonly diagnostics: readonly ApiDiagnostic[];
  readonly error?: { readonly code: "read-failed"; readonly message: string };
}
export interface FolderOutcome extends ScanOutcome { readonly findingPath?: string }
export interface VaultReport extends ReportMetadata {
  readonly extensions: ExtensionCoverage;
  readonly scope: { readonly kind: "configured-vault"; readonly excludeFolders: readonly string[]; readonly configDir: string };
  readonly status: "complete" | "partial" | "cancelled";
  readonly conformance: Conformance;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly files: readonly ScanOutcome[];
  readonly folders: readonly FolderOutcome[];
  readonly counts: { readonly files: OutcomeCounts; readonly folders: OutcomeCounts };
}
export interface ScanOptions { readonly signal?: AbortSignal }

/** Extension coverage is independent of the core OKF verdict/read coverage. */
export interface ExtensionCoverage {
  readonly complete: boolean;
  readonly evaluated: number;
  readonly failed: number;
  readonly cancelled: number;
}
