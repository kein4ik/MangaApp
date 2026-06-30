import { isSourceUsable } from '@/lib/sourceFilter';

import { SourceRegistry } from './registry';
import type { MangaDetails, MangaSearchResult } from './types';

export type CrossSourceMatch = MangaSearchResult & {
  /** 0..1 confidence that this is the same work, not merely a similar title. */
  matchConfidence: number;
  matchKind: 'exact' | 'probable';
};

const CYRILLIC = /[\u0400-\u04ff]/;
const LATIN = /[a-z]/i;

function norm(s: string): string {
  return (s.match(/[\p{L}\p{N}]+/gu) ?? [])
    .join(' ')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function uniqueTitles(titles: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const title of titles) {
    const key = norm(title ?? '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(title!.trim());
  }
  return result;
}

const tokens = (s: string): string[] => norm(s).split(' ').filter(Boolean);

/**
 * Editions and derivative works which often contain the original title but
 * are not interchangeable with it. A marker is allowed only when BOTH works
 * have it (for example, matching a colored edition to another colored edition).
 */
const VARIANT_MARKERS: { key: string; pattern: RegExp }[] = [
  { key: 'novel', pattern: /\b(light\s*novel|web\s*novel|novel|ranobe)\b|раноб[эе]|новелл/i },
  { key: 'doujin', pattern: /\b(doujin(?:shi)?|dj|fan\s*book)\b|додзин/i },
  { key: 'parody', pattern: /\bparody\b|пароди/i },
  { key: 'artbook', pattern: /\b(art\s*book|databook|guide\s*book)\b|артбук/i },
  { key: 'anthology', pattern: /\banthology\b|антологи/i },
  { key: 'spin-off', pattern: /\bspin[\s-]*off\b|спин[\s-]*офф/i },
  { key: 'side-story', pattern: /\b(side\s*story|gaiden|omake)\b|побочн|гайден/i },
  { key: 'remake', pattern: /\b(remake|reboot)\b|ремейк|перезапуск/i },
  { key: 'sequel', pattern: /\b(sequel|next\s*generation|after\s*story)\b|продолжени/i },
  { key: 'colored', pattern: /\b(colou?red|digital\s*color)\b|цветн/i },
  { key: 'memorial', pattern: /\bmemorial\b|памятник/i },
  { key: 'ragnarok', pattern: /\bragnar[oö]k\b|рагнар[её]к/i },
  { key: 'crossover', pattern: /\bcrossover\b|кроссовер/i },
];

function markers(titles: string[]): Set<string> {
  const found = new Set<string>();
  for (const { key, pattern } of VARIANT_MARKERS) {
    if (titles.some((title) => pattern.test(title))) found.add(key);
  }
  return found;
}

function sameMarkers(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  return [...a].every((marker) => b.has(marker));
}

function titleScore(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const at = tokens(a);
  const bt = tokens(b);
  const as = new Set(at);
  const bs = new Set(bt);
  const intersection = [...as].filter((token) => bs.has(token)).length;
  if (intersection === 0) return 0;

  // A one-word title must be exact. This is what prevents "Berserk" from
  // matching "Berserk Memorial", "Berserk Boost", etc.
  if (as.size === 1 || bs.size === 1) return 0;

  const union = new Set([...as, ...bs]).size;
  const jaccard = intersection / union;
  const coverage = intersection / Math.max(as.size, bs.size);

  // Extra words are meaningful in manga names, so reward overlap but never
  // give containment a free passing score.
  return jaccard * 0.65 + coverage * 0.35;
}

function candidateTitleScore(sourceTitles: string[], candidateTitles: string[]): number {
  const sourceMarkers = markers(sourceTitles);
  const candidateMarkers = markers(candidateTitles);
  if (!sameMarkers(sourceMarkers, candidateMarkers)) return 0;

  let best = 0;
  for (const sourceTitle of sourceTitles) {
    for (const candidateTitle of candidateTitles) {
      best = Math.max(best, titleScore(sourceTitle, candidateTitle));
    }
  }
  return best;
}

function wordSet(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).flatMap(tokens).filter((token) => token.length > 2));
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  return [...a].filter((token) => b.has(token)).length / Math.min(a.size, b.size);
}

function metadataScore(source: MangaDetails, candidate: MangaDetails, base: number): number {
  let score = base;
  // Exact title/alt-title equality is stronger than optional metadata. Author
  // names are often transliterated differently across languages, so metadata
  // may lower confidence but must not erase an otherwise exact match.
  const floor = base >= 0.97 ? 0.92 : 0;

  if (source.year && candidate.year) {
    const difference = Math.abs(source.year - candidate.year);
    if (difference > 2) score -= 0.18;
    else if (difference === 0) score += 0.03;
  }

  const sourceAuthors = wordSet(source.authors);
  const candidateAuthors = wordSet(candidate.authors);
  if (sourceAuthors.size && candidateAuthors.size) {
    const authorOverlap = overlap(sourceAuthors, candidateAuthors);
    if (authorOverlap === 0) score -= 0.25;
    else score += 0.05 * authorOverlap;
  }

  const sourceGenres = wordSet(source.genres);
  const candidateGenres = wordSet(candidate.genres);
  if (sourceGenres.size && candidateGenres.size) {
    score += Math.min(overlap(sourceGenres, candidateGenres) * 0.04, 0.04);
  }

  return Math.max(floor, Math.min(score, 1));
}

function preferredSearchTitles(manga: MangaDetails, languages: string[]): string[] {
  const all = uniqueTitles([manga.title, ...(manga.altTitles ?? [])]);
  const wantsCyrillic = languages.some((lang) => lang === 'ru' || lang === 'uk');
  const wantsLatin = languages.some((lang) => !['ru', 'uk', 'ja', 'ko', 'zh', 'zh-hk'].includes(lang));

  return [...all]
    .sort((a, b) => {
      const rank = (title: string) =>
        (wantsCyrillic && CYRILLIC.test(title) ? 3 : 0) +
        (wantsLatin && LATIN.test(title) ? 2 : 0) +
        (title === manga.title ? 1 : 0);
      return rank(b) - rank(a);
    })
    .slice(0, 3);
}

async function matchOnProvider(
  manga: MangaDetails,
  provider: ReturnType<typeof SourceRegistry.all>[number],
): Promise<CrossSourceMatch | null> {
  const sourceTitles = uniqueTitles([manga.title, ...(manga.altTitles ?? [])]);
  const queries = preferredSearchTitles(manga, provider.languages);
  const candidates = new Map<string, MangaSearchResult>();

  // Search the best language-appropriate aliases. Stop early when an exact
  // title/alt-title match is already present to avoid unnecessary requests.
  for (const query of queries) {
    const results = await provider.search(query, { limit: 12 });
    for (const result of results) candidates.set(result.externalId, result);
    const hasExact = results.some(
      (result) =>
        candidateTitleScore(
          sourceTitles,
          uniqueTitles([result.title, ...(result.altTitles ?? [])]),
        ) === 1,
    );
    if (hasExact) break;
  }

  const ranked = [...candidates.values()]
    .map((candidate) => ({
      candidate,
      score: candidateTitleScore(
        sourceTitles,
        uniqueTitles([candidate.title, ...(candidate.altTitles ?? [])]),
      ),
    }))
    .filter(({ score }) => score >= 0.72)
    .sort((a, b) => b.score - a.score);

  for (const rankedCandidate of ranked.slice(0, 3)) {
    let candidate: MangaDetails = rankedCandidate.candidate;
    let confidence = rankedCandidate.score;
    try {
      candidate = await provider.getMangaDetails(rankedCandidate.candidate.externalId);
      const detailedTitleScore = candidateTitleScore(
        sourceTitles,
        uniqueTitles([candidate.title, ...(candidate.altTitles ?? [])]),
      );
      if (detailedTitleScore === 0) continue;
      confidence = metadataScore(
        manga,
        candidate,
        Math.max(rankedCandidate.score, detailedTitleScore),
      );
    } catch {
      // A strict search hit is still useful when a details endpoint is
      // temporarily unavailable. If its score is weak, try the next hit.
      if (confidence < 0.78) continue;
    }

    if (confidence < 0.78) continue;
    return {
      ...candidate,
      matchConfidence: confidence,
      matchKind: confidence >= 0.97 ? 'exact' : 'probable',
    };
  }
  return null;
}

// ---- Cross-source clustering of search results ----

/** One work, gathered from however many sources returned it for a query. */
export type WorkCluster = {
  /** Stable key built from every member's source+id. */
  key: string;
  /** The entry we open by default (a reading source first). */
  primary: MangaSearchResult;
  /** All source entries believed to be the same work (one per source). */
  variants: MangaSearchResult[];
};

/** Grouping is title-only (no per-result detail fetch), so keep it strict. */
const CLUSTER_THRESHOLD = 0.82;

function providerRank(sourceId: string): number {
  const all = SourceRegistry.all();
  const index = all.findIndex((p) => p.id === sourceId);
  const provider = index >= 0 ? all[index] : undefined;
  // Reading sources first, then registry order — so we open something readable.
  return (provider?.supportsReading ? 0 : 100) + (index < 0 ? 50 : index);
}

function dedupeBySource(variants: MangaSearchResult[]): MangaSearchResult[] {
  const seen = new Set<string>();
  const out: MangaSearchResult[] = [];
  for (const v of variants) {
    if (seen.has(v.sourceId)) continue;
    seen.add(v.sourceId);
    out.push(v);
  }
  return out;
}

/**
 * Collapse search hits from many sources into one card per work. Pure and
 * title-based: it never hits the network, so it's safe to run on every search.
 */
export function clusterSearchResults(results: MangaSearchResult[]): WorkCluster[] {
  const clusters: { titles: string[]; variants: MangaSearchResult[] }[] = [];

  for (const result of results) {
    const resultTitles = uniqueTitles([result.title, ...(result.altTitles ?? [])]);
    let placed = false;
    for (const cluster of clusters) {
      // Don't merge two hits from the same source — a site listing two similar
      // titles almost always means two different works.
      if (cluster.variants.some((v) => v.sourceId === result.sourceId)) continue;
      if (candidateTitleScore(cluster.titles, resultTitles) >= CLUSTER_THRESHOLD) {
        cluster.variants.push(result);
        cluster.titles = uniqueTitles([...cluster.titles, ...resultTitles]);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ titles: resultTitles, variants: [result] });
  }

  return clusters.map((cluster) => {
    const variants = dedupeBySource(
      [...cluster.variants].sort((a, b) => providerRank(a.sourceId) - providerRank(b.sourceId)),
    );
    return {
      key: variants.map((v) => `${v.sourceId}:${v.externalId}`).join('|'),
      primary: variants[0],
      variants,
    };
  });
}

/** Find the same work on other readable sources, conservatively. Only looks at
 * sources for the user's enabled content languages (and not hidden), so the
 * "Also available on" list never surfaces languages the user doesn't read. */
export async function findMatches(
  manga: MangaDetails,
  excludeSourceId: string,
  enabledLanguages: string[],
  hiddenSources: string[],
): Promise<CrossSourceMatch[]> {
  const targets = SourceRegistry.all().filter(
    (provider) =>
      provider.supportsReading &&
      provider.supportsSearch &&
      provider.id !== excludeSourceId &&
      isSourceUsable(provider, enabledLanguages, hiddenSources),
  );
  const found = await Promise.all(
    targets.map(async (provider) => {
      try {
        return await matchOnProvider(manga, provider);
      } catch {
        return null;
      }
    }),
  );
  return found.filter((match): match is CrossSourceMatch => match !== null);
}
