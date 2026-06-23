import type { SourceProvider } from '../sources/SourceProvider.js';
import type { SourceStatus } from '../types.js';

/**
 * SourceHealthService — periodically pings each source with a cheap call and
 * tracks online / slow / broken. The app shows this so a dead source surfaces
 * as a badge instead of a mysterious failure.
 */

const SLOW_MS = 2500;
const CHECK_INTERVAL = 5 * 60 * 1000;

type HealthRecord = {
  status: SourceStatus;
  latencyMs: number | null;
  lastCheckedAt: number | null;
  errorCode?: string;
};

class SourceHealthService {
  private records = new Map<string, HealthRecord>();
  // Sources an operator has turned off via feature flag (env DISABLED_SOURCES).
  private disabled: Set<string>;

  constructor() {
    this.disabled = new Set(
      (process.env.DISABLED_SOURCES ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  status(id: string): SourceStatus {
    if (this.disabled.has(id)) return 'disabled';
    return this.records.get(id)?.status ?? 'online';
  }

  snapshot(id: string): HealthRecord {
    if (this.disabled.has(id)) {
      return { status: 'disabled', latencyMs: null, lastCheckedAt: null };
    }
    return this.records.get(id) ?? { status: 'online', latencyMs: null, lastCheckedAt: null };
  }

  async check(provider: SourceProvider): Promise<void> {
    if (this.disabled.has(provider.id)) return;
    const started = Date.now();
    try {
      // A trending pull is the cheapest "is this source alive" probe.
      await provider.trending({ limit: 1 });
      const latencyMs = Date.now() - started;
      this.records.set(provider.id, {
        status: latencyMs > SLOW_MS ? 'slow' : 'online',
        latencyMs,
        lastCheckedAt: Date.now(),
      });
    } catch (err) {
      this.records.set(provider.id, {
        status: 'broken',
        latencyMs: null,
        lastCheckedAt: Date.now(),
        errorCode: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  /** Kick off an immediate check and then on an interval. */
  start(providers: SourceProvider[]): void {
    const run = () => providers.forEach((p) => void this.check(p));
    run();
    setInterval(run, CHECK_INTERVAL).unref?.();
  }
}

export const health = new SourceHealthService();
