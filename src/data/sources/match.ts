import { SourceRegistry } from './registry';
import type { MangaSearchResult } from './types';

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9а-яё]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
const tokens = (s: string) => new Set(norm(s).split(' ').filter(Boolean));

function score(query: string, candidate: string): number {
  const a = norm(query);
  const b = norm(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const qa = tokens(query);
  const qb = tokens(candidate);
  const inter = [...qa].filter((x) => qb.has(x)).length;
  const union = new Set([...qa, ...qb]).size;
  const jaccard = union ? inter / union : 0;
  const subset = [...qa].every((x) => qb.has(x)) || [...qb].every((x) => qa.has(x));
  return subset ? Math.max(jaccard, 0.6) : jaccard;
}

function bestMatch(query: string, results: MangaSearchResult[]): MangaSearchResult | undefined {
  if (norm(query).length < 2) return undefined;
  let best: MangaSearchResult | undefined;
  let bestScore = 0;
  for (const r of results) {
    const candidates = [r.title, ...(r.altTitles ?? [])];
    const s = candidates.reduce((max, c) => Math.max(max, score(query, c)), 0);
    if (s > bestScore) {
      bestScore = s;
      best = r;
    }
  }
  return bestScore >= 0.5 ? best : undefined;
}

/** Find the same title on other readable sources (cross-source "available on"). */
export async function findMatches(
  query: string,
  excludeSourceId: string,
): Promise<MangaSearchResult[]> {
  const targets = SourceRegistry.all().filter(
    (p) => p.supportsReading && p.supportsSearch && p.id !== excludeSourceId,
  );
  const found = await Promise.all(
    targets.map(async (provider) => {
      try {
        const results = await provider.search(query, { limit: 6 });
        return bestMatch(query, results) ?? null;
      } catch {
        return null;
      }
    }),
  );
  return found.filter((m): m is MangaSearchResult => m !== null);
}
