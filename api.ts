// Small, host-independent validation-extension contract. No provider implementation imports.
export type ApiErrorCode = "invalid-request" | "invalid-provider" | "duplicate-provider" | "unavailable" | "busy";
export interface ValidationDiagnostic {
  readonly rule: string;
  readonly message: string;
  readonly severity: "error" | "warning";
}
export interface ValidationContext {
  readonly path: string;
  readonly kind: "concept" | "index" | "log";
  readonly content: string;
  readonly body: string;
  readonly frontmatter: Readonly<Record<string, unknown>> | null;
  readonly frontmatterState: "valid" | "missing" | "invalid";
  readonly evaluatedAt: string;
  readonly coreDiagnostics: readonly ValidationDiagnostic[];
  readonly signal: AbortSignal;
}
export interface ValidationProvider {
  readonly id: string;
  readonly name: string;
  readonly validate: (context: ValidationContext) => readonly ValidationDiagnostic[] | Promise<readonly ValidationDiagnostic[]>;
}
export interface OkfApiV1 {
  readonly apiVersion: 1;
  readonly pluginVersion: string;
  readonly okfVersion: string;
  registerValidator(provider: ValidationProvider): () => void;
}
export const VALIDATORS_READY = "okf-enforcer:validators-ready";
export const VALIDATORS_STOPPING = "okf-enforcer:validators-stopping";

/** Conventional discovery uses PRIVATE app.plugins internals; reacquire after reload. */
export function getOkfApi(app: unknown): OkfApiV1 | undefined {
  try {
    const api = (app as { plugins?: { plugins?: Record<string, { apiV1?: unknown }> } })
      ?.plugins?.plugins?.["okf-enforcer"]?.apiV1 as Partial<OkfApiV1> | undefined;
    if (api?.apiVersion === 1 && typeof api.pluginVersion === "string" &&
        typeof api.okfVersion === "string" && typeof api.registerValidator === "function") return api as OkfApiV1;
  } catch { /* Host internals may be unsupported. */ }
  return undefined;
}

interface CleanupOwner { register(cleanup: () => void): void }
interface WorkspaceEvents { on(name: string, callback: () => void): unknown; offref(ref: unknown): void }

/** Attach synchronously during companion onload; owner cleanup also removes listeners. */
export function attachValidator(app: unknown, owner: CleanupOwner, provider: ValidationProvider): () => void {
  const workspace = (app as { workspace?: WorkspaceEvents })?.workspace;
  if (!workspace?.on || !workspace.offref) throw new Error("Obsidian workspace events are unavailable");
  let disposed = false, connected: OkfApiV1 | undefined, remove: (() => void) | undefined;
  const refs: unknown[] = [];
  const disconnect = () => { remove?.(); remove = undefined; connected = undefined; };
  const cleanup = () => {
    if (disposed) return; disposed = true;
    refs.forEach((ref) => workspace.offref(ref)); refs.length = 0; disconnect();
  };
  const connect = () => {
    if (disposed) return;
    const current = getOkfApi(app);
    if (current === connected) return;
    disconnect();
    if (current) { remove = current.registerValidator(provider); connected = current; }
  };
  owner.register(cleanup);
  if (disposed) return cleanup;
  refs.push(workspace.on(VALIDATORS_READY, () => {
    try { connect(); } catch (error) { console.error(`OKF validator attachment failed (${provider.id})`, error); }
  }));
  refs.push(workspace.on(VALIDATORS_STOPPING, disconnect));
  try { connect(); } catch (error) { cleanup(); throw error; }
  return cleanup;
}
