/**
 * The network layer every provider goes through.
 *
 * - The timeout covers the WHOLE request, body included. SDK 56 installs the
 *   streaming `expo/fetch` as the global fetch: it resolves as soon as headers
 *   arrive, so a timer cleared right after `fetch()` would leave a stalled body
 *   hanging forever.
 * - A per-host gate caps concurrent requests (plus optional pacing), so nested
 *   parallel work — e.g. 4 library titles × several MangaDex feed pages — can't
 *   burst a source into 429s or bans. It also keeps response parsing on the JS
 *   thread spread out instead of landing all at once.
 * - An outer AbortSignal (TanStack Query hands one to every queryFn) is chained
 *   in, so a screen that closes stops its requests — including ones still
 *   waiting for a slot, which would otherwise hold up the next screen's.
 */

const DEFAULT_TIMEOUT = 20_000;

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, label: string) {
    super(`${label} ${status}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${Math.round(ms / 1000)}s`);
    this.name = 'TimeoutError';
  }
}

/**
 * The site answered 200 but not with the page we asked for: an error or
 * maintenance page, a bot check, an empty body from a soft rate limit, or a
 * redesign the parser no longer understands. Scrapers throw this instead of
 * returning "nothing found", so the app reports the source as unavailable
 * (and its health badge sees a failure) rather than "no chapters".
 */
export class UnexpectedPageError extends Error {
  constructor(label: string) {
    super(`${label} sent an unexpected page`);
    this.name = 'UnexpectedPageError';
  }
}

/** True when a request was cancelled by its caller (not a timeout, not a failure). */
export function isAbortError(e: unknown): boolean {
  return (
    e instanceof Error &&
    !(e instanceof TimeoutError) &&
    (e.name === 'AbortError' || /\babort/i.test(e.message))
  );
}

function abortError(): Error {
  const e = new Error('Request aborted');
  e.name = 'AbortError';
  return e;
}

/** setTimeout as a promise that rejects with an AbortError when `signal` fires. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort);
  });
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const hostOf = (url: string) => url.match(/^https?:\/\/([^/?#]+)/i)?.[1]?.toLowerCase() ?? '';

// ---- Per-host gate ----

type Rule = { concurrency: number; minIntervalMs: number };
const DEFAULT_RULE: Rule = { concurrency: 4, minIntervalMs: 0 };
const RULES: Record<string, Rule> = {
  // MangaDex allows ~5 requests/second per IP across its whole API.
  'api.mangadex.org': { concurrency: 3, minIntervalMs: 220 },
  // MangaKatana answers a quick burst with empty 200 pages for a few seconds.
  'mangakatana.com': { concurrency: 2, minIntervalMs: 300 },
};

class Gate {
  private active = 0;
  private queue: (() => void)[] = [];
  private nextStartAt = 0;
  private readonly rule: Rule;
  constructor(rule: Rule) {
    this.rule = rule;
  }

  /**
   * Wait for a slot (and the pacing delay). Cancelling while queued leaves the
   * queue at once; cancelling during the delay hands the slot to the next one.
   */
  acquire(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      let holding = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () => {
        signal?.removeEventListener('abort', onAbort);
        if (holding) {
          clearTimeout(timer);
          this.release();
        } else {
          const i = this.queue.indexOf(start);
          if (i >= 0) this.queue.splice(i, 1);
        }
        reject(abortError());
      };
      const go = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const start = () => {
        holding = true;
        const now = Date.now();
        const at = Math.max(now, this.nextStartAt);
        this.nextStartAt = at + this.rule.minIntervalMs;
        if (at > now) timer = setTimeout(go, at - now);
        else go();
      };
      signal?.addEventListener('abort', onAbort);
      if (this.active < this.rule.concurrency) {
        this.active++;
        start();
      } else {
        // The slot is handed over by release(), so `active` stays accurate.
        this.queue.push(start);
      }
    });
  }

  release() {
    const next = this.queue.shift();
    if (next) next();
    else this.active--;
  }
}

const gates = new Map<string, Gate>();
function gateFor(url: string): Gate {
  const host = hostOf(url);
  let gate = gates.get(host);
  if (!gate) {
    gate = new Gate(RULES[host] ?? DEFAULT_RULE);
    gates.set(host, gate);
  }
  return gate;
}

// ---- Requests ----

export type RequestOptions = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Budget for the whole request, body included. */
  timeoutMs?: number;
  /** Prefix for error messages, e.g. "MangaDex". Defaults to the host. */
  label?: string;
  /** Extra attempts after an HTTP 429, waiting for the server's Retry-After. */
  retries429?: number;
};

/** How long a 429 asks us to wait (MangaDex sends an epoch-seconds header). */
function retryAfterMs(res: Response): number {
  const until = Number(res.headers.get('x-ratelimit-retry-after'));
  if (until > 0) return clamp(until * 1000 - Date.now(), 500, 5000);
  const seconds = Number(res.headers.get('retry-after'));
  if (seconds > 0) return clamp(seconds * 1000, 500, 5000);
  return 1500;
}

async function request<T>(
  url: string,
  opts: RequestOptions,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  const { signal: outer, timeoutMs = DEFAULT_TIMEOUT, label = hostOf(url), retries429 = 0, headers } = opts;
  const gate = gateFor(url);

  for (let attempt = 0; ; attempt++) {
    // Rejects right away when the caller cancels while waiting for a slot.
    await gate.acquire(outer);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onOuterAbort = () => controller.abort();
    outer?.addEventListener('abort', onOuterAbort);

    let waitMs = 0;
    try {
      // Cancelled between getting the slot and starting: don't send it.
      if (outer?.aborted) throw abortError();
      const res = await fetch(url, { headers, signal: controller.signal });
      if (res.ok) return await read(res);
      if (res.status === 429 && attempt < retries429) {
        waitMs = retryAfterMs(res);
        await res.text().catch(() => '');
      } else {
        // Don't keep streaming an error page nobody will read.
        controller.abort();
        throw new HttpError(res.status, label);
      }
    } catch (e) {
      if (timedOut) throw new TimeoutError(label, timeoutMs);
      if (outer?.aborted) throw abortError();
      throw e;
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuterAbort);
      gate.release();
    }
    await delay(waitMs, outer);
  }
}

export function fetchText(url: string, opts: RequestOptions = {}): Promise<string> {
  return request(url, opts, (res) => res.text());
}

export function fetchJSON<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  return request(url, opts, async (res) => (await res.json()) as T);
}
