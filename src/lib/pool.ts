/**
 * Map over items with at most `limit` promises in flight. Order of results
 * matches the input. Used everywhere we walk the whole library (updates feed,
 * background chapter check) or all sources (diagnostics): a full-parallel burst
 * blocks the JS thread with response parsing and trips rate limits (MangaLib
 * and MangaDex answer 429) — a small pool keeps the app responsive and the
 * sources friendly.
 *
 * On the first failure no NEW items are started, and the returned promise
 * rejects only after the tasks already in flight have settled — so nothing
 * keeps running (downloading, reporting progress) after the caller has been
 * told the whole operation failed.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  let firstError: unknown;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        if (!failed) {
          failed = true;
          firstError = e;
        }
      }
    }
  });
  await Promise.all(workers);
  if (failed) throw firstError;
  return results;
}

/**
 * A FIFO gate that lets at most `limit` tasks run at once — for work queued from
 * many places over time (e.g. chapter downloads tapped one after another).
 */
export function createLimiter(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<R>(task: () => Promise<R>): Promise<R> {
    // A finishing task hands its slot straight to the next waiter, so a newcomer
    // can never slip in between and push us over the limit.
    if (active < limit) active++;
    else await new Promise<void>((resolve) => queue.push(resolve));
    try {
      return await task();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };
}
