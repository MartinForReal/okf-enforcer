// Provider-owned lifecycle. Consumers receive only the small api.ts facade.
import type { OkfApiV1, ValidationProvider } from "./api";
import type { ContentRequest, ScanOptions } from "./validation-types";
import { ExtensionRegistry, type ExtensionEvaluation } from "./extensions";
import { collectVault, toPublicVaultReport, type ScanHost } from "./scan";
import { OKF_VERSION, validateContent, type OkfSettings, type OkfIssue } from "./validator";
import type { ReportMetadata, Conformance } from "./validation-types";
import { apiError, snapshotSettings, validateProvidedContent, conformanceFor, reportMetadata } from "./validation";

export interface NoteEvaluation extends ReportMetadata {
  issues: OkfIssue[];
  conformance: Conformance;
  extensions: ExtensionEvaluation;
}
export interface ValidationPass {
  settings: OkfSettings;
  now: Date;
  isCurrent(): boolean;
  evaluate(path: string, content: string): Promise<NoteEvaluation>;
}

export interface ApiHost extends ScanHost {
  settings(): OkfSettings;
  activity(): { busy: boolean; revision: number };
  validatorsChanged?(): void;
}

export class ApiController {
  private disposed = false;
  private scanning = false;
  private facade: OkfApiV1 | undefined;
  readonly validators: ExtensionRegistry;

  constructor(private host: ApiHost, private pluginVersion: string, private clock = () => new Date()) {
    this.validators = new ExtensionRegistry(() => { if (!this.disposed) this.host.validatorsChanged?.(); });
  }

  get api(): OkfApiV1 | undefined { return this.facade; }

  /** Called only once both host initialization barriers have succeeded. */
  publish(): void {
    if (this.disposed || this.facade) return;
    this.facade = Object.freeze({
      apiVersion: 1 as const,
      pluginVersion: this.pluginVersion,
      okfVersion: OKF_VERSION,
      registerValidator: (provider: ValidationProvider) => {
        this.ensureAvailable();
        return this.validators.register(provider);
      },
    });
  }

  dispose(): void {
    this.disposed = true;
    this.facade = undefined;
    this.validators.dispose();
  }

  /** One pass captures configuration, time and registrations for active/scan/fix. */
  createPass(signal?: AbortSignal): ValidationPass {
    this.ensureAvailable();
    const settings = snapshotSettings(this.host.settings());
    const now = new Date(this.clock().getTime()), snapshot = this.validators.snapshot();
    const metadata = reportMetadata(settings, { pluginVersion: this.pluginVersion, now });
    return {
      settings, now,
      isCurrent: () => !this.disposed && !!this.facade && snapshot.revision === this.validators.revision,
      evaluate: async (path, content) => {
        this.ensureAvailable();
        const core = validateContent(path, content, !path.includes("/"), settings, now);
        const extensions = await this.validators.validate(path, content, core, now, snapshot, signal);
        this.ensureAvailable();
        return { ...metadata, issues: [...core, ...extensions.issues],
          conformance: conformanceFor(core, metadata.checkCoverage), extensions };
      },
    };
  }

  /** Internal engine operation, deliberately not on the public registration facade. */
  async validateContent(input: ContentRequest) {
    this.ensureAvailable();
    const settings = snapshotSettings(this.host.settings());
    const report = validateProvidedContent(input, settings, { pluginVersion: this.pluginVersion, now: new Date(this.clock().getTime()) });
    this.ensureAvailable(); return report;
  }

  private ensureAvailable(): void {
    if (this.disposed || !this.facade) throw apiError("unavailable", "OKF Enforcer is unavailable or not ready. Reacquire its API.");
  }

  /** Internal collector operation used by Enforcer, not a consumer query SDK. */
  async scanVault(options?: ScanOptions) {
    this.ensureAvailable();
    if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options) ||
        (options.signal !== undefined && (!options.signal || typeof options.signal.aborted !== "boolean")))) {
      throw apiError("invalid-request", "Expected scan options with an optional AbortSignal.");
    }
    if (this.scanning || this.host.activity().busy) throw apiError("busy", "An OKF scan/fix/index operation is already running.");
    const revision = this.host.activity().revision;
    const guard = () => {
      this.ensureAvailable();
      const activity = this.host.activity();
      if (activity.busy || activity.revision !== revision) throw apiError("busy", "An OKF operation overlapped this read-only scan; retry when it finishes.");
    };
    this.scanning = true;
    try {
      const pass = this.createPass(options?.signal);
      const scan = await collectVault(this.host, pass.settings, {
        pluginVersion: this.pluginVersion, now: pass.now, evaluateNote: pass.evaluate,
        clock: this.clock, signal: options?.signal, guard: () => {
          guard();
          if (!pass.isCurrent()) throw apiError("busy", "Validators changed during the scan; retry with the current registrations.");
        },
      });
      guard();
      return toPublicVaultReport(scan);
    } finally {
      this.scanning = false;
    }
  }
}
