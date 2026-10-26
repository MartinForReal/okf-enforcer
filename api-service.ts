// Provider-owned lifecycle. Consumers receive only the small api.ts facade.
import type { OkfApiV1, ScanOptions } from "./api";
import { collectVault, toPublicVaultReport, type ScanHost } from "./scan";
import { OKF_VERSION, type OkfSettings } from "./validator";
import { apiError, snapshotSettings, validateProvidedContent } from "./validation";

export interface ApiHost extends ScanHost {
  settings(): OkfSettings;
  activity(): { busy: boolean; revision: number };
}

export class ApiController {
  private disposed = false;
  private scanning = false;
  private facade: OkfApiV1 | undefined;

  constructor(private host: ApiHost, private pluginVersion: string, private clock = () => new Date()) {}

  get api(): OkfApiV1 | undefined { return this.facade; }

  /** Called only once both host initialization barriers have succeeded. */
  publish(): void {
    if (this.disposed || this.facade) return;
    this.facade = Object.freeze({
      apiVersion: 1 as const,
      pluginVersion: this.pluginVersion,
      okfVersion: OKF_VERSION,
      validateContent: async (input) => {
        this.ensureAvailable();
        const settings = snapshotSettings(this.host.settings());
        const report = validateProvidedContent(input, settings, { pluginVersion: this.pluginVersion, now: new Date(this.clock().getTime()) });
        this.ensureAvailable();
        return report;
      },
      scanVault: (options?: ScanOptions) => this.scan(options),
    });
  }

  dispose(): void {
    this.disposed = true;
    this.facade = undefined;
  }

  private ensureAvailable(): void {
    if (this.disposed || !this.facade) throw apiError("unavailable", "OKF Enforcer is unavailable or not ready. Reacquire its API.");
  }

  private async scan(options?: ScanOptions) {
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
      const settings = snapshotSettings(this.host.settings());
      const scan = await collectVault(this.host, settings, {
        pluginVersion: this.pluginVersion, now: new Date(this.clock().getTime()),
        clock: this.clock, signal: options?.signal, guard,
      });
      guard();
      return toPublicVaultReport(scan);
    } finally {
      this.scanning = false;
    }
  }
}
