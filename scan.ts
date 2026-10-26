// Internal read-only collector shared by API and UI. No presentation or writes.
import type { OutcomeCounts, ScanOutcome, VaultReport } from "./validation-types";
import type { NoteEvaluation } from "./api-service";
import type { ExtensionEvaluation } from "./extensions";
import { isExcluded, validateContent, type OkfIssue, type OkfSettings } from "./validator";
import { apiError, conformanceFor, publicDiagnostics, reportMetadata, type EvaluationContext } from "./validation";

export interface ScanFile { path: string; read(): Promise<string> }
export interface ScanFolder {
  path: string;
  check(settings: OkfSettings): Promise<{ path: string; issues: OkfIssue[] } | null>;
}
export interface ScanHost {
  configDir: string;
  files(): ScanFile[];
  folders(settings: OkfSettings): ScanFolder[];
}
export interface CollectedOutcome {
  extensions?: ExtensionEvaluation;
  path: string;
  status: ScanOutcome["status"];
  issues: OkfIssue[];
  error?: { code: "read-failed"; message: string };
  findingPath?: string;
}
export interface CollectedScan extends Omit<VaultReport, "files" | "folders"> {
  files: CollectedOutcome[];
  folders: CollectedOutcome[];
}
export interface CollectContext extends EvaluationContext {
  evaluateNote?(path: string, content: string): Promise<NoteEvaluation>;
  guard(): void;
  signal?: AbortSignal;
  clock?: () => Date;
  onProgress?(completed: number, total: number): void;
}
export interface ScanSummary {
  coreErrorFiles: number;
  extensionErrorFiles: number;
  extensions: VaultReport["extensions"];
  status: VaultReport["status"];
  checkCoverage: VaultReport["checkCoverage"];
  conformance: VaultReport["conformance"];
  counts: VaultReport["counts"];
  cleanFiles: number;
  errorFiles: number;
  warningFiles: number;
  folderFindings: number;
}

function counts(outcomes: CollectedOutcome[]): OutcomeCounts {
  return {
    candidates: outcomes.length,
    validated: outcomes.filter((o) => o.status === "validated").length,
    unreadable: outcomes.filter((o) => o.status === "unreadable").length,
    unprocessed: outcomes.filter((o) => o.status === "unprocessed").length,
  };
}

export async function collectVault(host: ScanHost, settings: OkfSettings, context: CollectContext): Promise<CollectedScan> {
  context.guard();
  const now = new Date(context.now.getTime());
  const metadata = reportMetadata(settings, { ...context, now });
  const configDir = host.configDir;
  const included = (path: string) =>
    path !== configDir && !path.startsWith(configDir + "/") && !isExcluded(path, settings);
  let files: ScanFile[], folders: ScanFolder[];
  try {
    files = host.files().filter((file) => included(file.path)).sort((a, b) => a.path.localeCompare(b.path));
    folders = settings.reportIndexGaps
      ? host.folders(settings).filter((folder) => included(folder.path)).sort((a, b) => a.path.localeCompare(b.path))
      : [];
  } catch (error) {
    context.guard();
    throw apiError("unavailable", `Cannot enumerate the configured vault scope: ${error instanceof Error ? error.message : String(error)}`);
  }
  const pending = (path: string): CollectedOutcome => ({ path, status: "unprocessed", issues: [] });
  const fileOutcomes = files.map((file) => pending(file.path));
  const folderOutcomes = folders.map((folder) => pending(folder.path));
  const jobs = [
    ...files.map((file, index) => async () => {
      const outcome = fileOutcomes[index];
      let content: string;
      try { content = await file.read(); }
      catch (error) { failed(outcome, error); return; }
      context.guard();
      if (context.signal?.aborted) return;
      if (context.evaluateNote) {
        const result = await context.evaluateNote(file.path, content);
        context.guard();
        outcome.issues = result.issues; outcome.extensions = result.extensions;
      } else outcome.issues = validateContent(file.path, content, !file.path.includes("/"), settings, now);
      outcome.status = "validated";
    }),
    ...folders.map((folder, index) => async () => {
      const outcome = folderOutcomes[index];
      let result: Awaited<ReturnType<ScanFolder["check"]>>;
      try { result = await folder.check(settings); }
      catch (error) { failed(outcome, error); return; }
      context.guard();
      if (context.signal?.aborted) return;
      outcome.status = "validated";
      if (result) {
        outcome.findingPath = result.path;
        outcome.issues = result.issues.map((issue) => ({ ...issue }));
      }
    }),
  ];
  function failed(outcome: CollectedOutcome, error: unknown) {
    // Lifecycle/activity errors must escape, never become ordinary read errors.
    context.guard();
    if (context.signal?.aborted) return;
    outcome.status = "unreadable";
    outcome.error = { code: "read-failed", message: error instanceof Error ? error.message : String(error) };
  }
  const batchSize = Math.max(1, settings.batchSize | 0);
  for (let start = 0; start < jobs.length; start += batchSize) {
    context.guard();
    if (context.signal?.aborted) break;
    await Promise.all(jobs.slice(start, start + batchSize).map((job) => job()));
    context.guard();
    context.onProgress?.(Math.min(start + batchSize, jobs.length), jobs.length);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
  context.guard();
  const fileCounts = counts(fileOutcomes), folderCounts = counts(folderOutcomes);
  const status = context.signal?.aborted ? "cancelled"
    : fileCounts.unreadable || folderCounts.unreadable ? "partial" : "complete";
  const assessments = fileOutcomes.flatMap((o) => o.extensions?.assessments ?? []);
  const failedExtensions = assessments.filter((a) => a.status === "failed").length;
  const cancelledExtensions = assessments.filter((a) => a.status === "cancelled").length;
  return {
    ...metadata,
    scope: { kind: "configured-vault", configDir, excludeFolders: [...settings.excludeFolders] },
    status,
    extensions: { complete: !failedExtensions && !cancelledExtensions && status === "complete",
      evaluated: assessments.length, failed: failedExtensions, cancelled: cancelledExtensions },
    conformance: conformanceFor([...fileOutcomes, ...folderOutcomes].flatMap((o) => o.issues), metadata.checkCoverage, status === "complete"),
    startedAt: now.toISOString(),
    finishedAt: (context.clock?.() ?? new Date()).toISOString(),
    files: fileOutcomes,
    folders: folderOutcomes,
    counts: { files: fileCounts, folders: folderCounts },
  };
}

export function toPublicVaultReport(scan: CollectedScan): VaultReport {
  const { files, folders, ...metadata } = scan;
  const outcome = (value: CollectedOutcome): ScanOutcome => ({
    path: value.path,
    status: value.status,
    diagnostics: publicDiagnostics(value.issues),
    ...(value.error ? { error: { ...value.error } } : {}),
  });
  return {
    ...metadata,
    enabledChecks: { ...metadata.enabledChecks,
      warnMissingFields: [...metadata.enabledChecks.warnMissingFields],
      portent: { ...metadata.enabledChecks.portent,
        types: [...metadata.enabledChecks.portent.types],
        statuses: [...metadata.enabledChecks.portent.statuses],
        fields: { ...metadata.enabledChecks.portent.fields },
        checks: [...metadata.enabledChecks.portent.checks],
      },
    },
    disabledErrorChecks: [...metadata.disabledErrorChecks],
    scope: { ...metadata.scope, excludeFolders: [...metadata.scope.excludeFolders] },
    extensions: { ...metadata.extensions },
    counts: { files: { ...metadata.counts.files }, folders: { ...metadata.counts.folders } },
    files: files.map(outcome),
    folders: folders.map((folder) => ({ ...outcome(folder), ...(folder.findingPath ? { findingPath: folder.findingPath } : {}) })),
  };
}

/** Keep legacy fixable metadata in UI rows, never in public DTOs. */
export function scanResults(scan: CollectedScan): { path: string; issues: OkfIssue[] }[] {
  const byPath = new Map<string, OkfIssue[]>();
  const add = (outcome: CollectedOutcome, folder: boolean) => {
    const path = outcome.findingPath ?? (folder ? (outcome.path && outcome.path !== "/" ? `${outcome.path}/index.md` : "index.md") : outcome.path);
    const issues = outcome.issues.map((issue) => ({ ...issue }));
    if (outcome.error) issues.push({ severity: "warning", rule: "scan/read", message: `Unable to read ${outcome.path || "/"}: ${outcome.error.message}` });
    if (issues.length) byPath.set(path, [...(byPath.get(path) ?? []), ...issues]);
  };
  for (const outcome of scan.files) add(outcome, false);
  for (const outcome of scan.folders) add(outcome, true);
  return [...byPath].map(([path, issues]) => ({ path, issues })).sort((a, b) => a.path.localeCompare(b.path));
}

export function summarizeScan(scan: CollectedScan): ScanSummary {
  const validated = scan.files.filter((file) => file.status === "validated");
  const errorFiles = validated.filter((file) => file.issues.some((issue) => issue.severity === "error")).length;
  const cleanFiles = validated.filter((file) => file.issues.length === 0).length;
  return {
    coreErrorFiles: validated.filter((file) => file.issues.some((issue) => issue.severity === "error" && !issue.providerId && !issue.rule.startsWith("portent/"))).length,
    extensionErrorFiles: validated.filter((file) => file.issues.some((issue) => issue.severity === "error" && issue.providerId)).length,
    extensions: { ...scan.extensions },
    status: scan.status, checkCoverage: scan.checkCoverage, conformance: scan.conformance,
    counts: { files: { ...scan.counts.files }, folders: { ...scan.counts.folders } },
    cleanFiles, errorFiles, warningFiles: validated.length - errorFiles - cleanFiles,
    folderFindings: scan.folders.reduce((total, folder) => total + folder.issues.length, 0),
  };
}
