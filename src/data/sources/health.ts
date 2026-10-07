import { HttpError, isAbortError } from './http';
import type { SourceStatus } from './types';

/**
 * Live source health, learned passively from the app's own requests (every
 * provider call is timed in the registry) plus the Diagnostics screen. Replaces
 * the old hard-coded "online", which stayed green while a source was down.
 */

type Health = {
  lastOkAt: number;
  lastFailAt: number;
  consecutiveFails: number;
  /** Duration of the most recent successful call. */
  lastMs: number;
  /** Set by a full Diagnostics run; wins until newer live traffic arrives. */
  diagnosed?: { status: SourceStatus; at: number };
};

const SLOW_MS = 6000;
const health = new Map<string, Health>();
const listeners = new Set<() => void>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function entry(sourceId: string): Health {
  let h = health.get(sourceId);
  if (!h) {
    h = { lastOkAt: 0, lastFailAt: 0, consecutiveFails: 0, lastMs: 0 };
    health.set(sourceId, h);
  }
  return h;
}

/** Coalesce bursts of results into one UI refresh. */
function notify() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    listeners.forEach((l) => l());
  }, 1500);
}

/**
 * Record the outcome of one provider call. A definitive client answer (404 for a
 * removed title, 400/422 for a bad query) still proves the source is reachable;
 * a caller cancelling a request says nothing about the source at all.
 */
export function recordSourceCall(sourceId: string, error: unknown, ms: number) {
  if (error && isAbortError(error)) return;
  const reachable =
    !error || (error instanceof HttpError && [400, 404, 410, 422].includes(error.status));
  const h = entry(sourceId);
  const before = sourceStatus(sourceId);
  if (reachable) {
    h.lastOkAt = Date.now();
    h.lastMs = ms;
    h.consecutiveFails = 0;
  } else {
    h.lastFailAt = Date.now();
    h.consecutiveFails += 1;
  }
  if (sourceStatus(sourceId) !== before) notify();
}

export function recordDiagnosis(sourceId: string, status: SourceStatus) {
  entry(sourceId).diagnosed = { status, at: Date.now() };
  notify();
}

export function sourceStatus(sourceId: string): SourceStatus {
  const h = health.get(sourceId);
  if (!h) return 'unknown';
  const lastLive = Math.max(h.lastOkAt, h.lastFailAt);
  if (h.diagnosed && h.diagnosed.at >= lastLive) return h.diagnosed.status;
  // Two failures in a row (and nothing good since) = down; one can be a blip.
  if (h.consecutiveFails >= 2) return 'broken';
  if (h.lastOkAt === 0) return 'unknown';
  return h.lastMs > SLOW_MS ? 'slow' : 'online';
}

export function subscribeSourceHealth(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
