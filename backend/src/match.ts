import type { MangaSearchResult } from './types.js';

/** Normalize a title for loose cross-source comparison. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9а-яё]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokens(s: string): Set<string> {
  return new Set(norm(s).split(' ').filter(Boolean));
}

/** 0..1 similarity between a query and one candidate title. */
function score(query: string, candidate: string): number {
  const a = norm(query);
  const b = norm(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1; // exact normalized match wins

  const qa = tokens(query);
  const qb = tokens(candidate);
  const inter = [...qa].filter((x) => qb.has(x)).length;
  const union = new Set([...qa, ...qb]).size;
  const jaccard = union ? inter / union : 0;

  // Whole-query is contained in the candidate (e.g. "berserk" ⊂ "berserk deluxe")
  // — give a floor but still discount lots of extra words via jaccard. This
  // keeps token-distinct titles ("berserk" vs "berserker") from matching.
  const subset = [...qa].every((x) => qb.has(x)) || [...qb].every((x) => qa.has(x));
  return subset ? Math.max(jaccard, 0.6) : jaccard;
}

/**
 * Pick the best-matching search result for a query, comparing against each
 * result's title AND alt titles (so an English query can match a RU source that
 * lists the English name). Returns undefined if nothing is similar enough.
 * The app shows the cover+title so the user visually confirms before switching.
 */
export function bestMatch(
  query: string,
  results: MangaSearchResult[],
): MangaSearchResult | undefined {
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
