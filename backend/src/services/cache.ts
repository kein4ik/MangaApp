/**
 * In-memory TTL cache. Same shape a Redis-backed cache would expose, so
 * swapping to Redis later (per the plan) means reimplementing `get`/`set`
 * without touching callers. Never used for temporary image URLs — those expire
 * on the source side and must stay fresh.
 */

type Entry = { value: unknown; expiresAt: number };

class TtlCache {
  private store = new Map<string, Entry>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /** Return cached value or run `fn`, cache it, and return it. */
  async wrap<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await fn();
    this.set(key, value, ttlMs);
    return value;
  }
}

export const cache = new TtlCache();

export const TTL = {
  trending: 10 * 60 * 1000,
  search: 5 * 60 * 1000,
  details: 30 * 60 * 1000,
  chapters: 10 * 60 * 1000,
  // Pages hold temporary image URLs — keep just long enough to absorb retries.
  pages: 60 * 1000,
};
