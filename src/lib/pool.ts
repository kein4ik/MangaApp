/**
 * Map over items with at most `limit` promises in flight. Order of results
 * matches the input. Used everywhere we walk the whole library (updates feed,
 * background chapter check) or all sources (diagnostics): a full-parallel burst
 * blocks the JS thread with response parsing and trips rate limits (MangaLib
 * 429s, Mangabuff bans) — a small pool keeps the app responsive and the
 * sources friendly.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
