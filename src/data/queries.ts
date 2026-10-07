import {
  isCancelledError,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import { Alert } from 'react-native';

import {
  addToLibraryForGroup,
  cacheManga,
  clearLibrary,
  clearReadingProgress,
  getCachedManga,
  getContinueReading,
  getDownload,
  getDownloadedChapterIds,
  getDownloadedManga,
  getDownloadsTotalBytes,
  getLibrary,
  getLibraryStatus,
  getDeadChapterKeys,
  getMangaDownloadChapters,
  getMangaProgress,
  getReadChapterIds,
  getReadChapterNumbers,
  getWorkPref,
  markChaptersChecked,
  markChaptersRead,
  normChapterNumber,
  removeDownload,
  removeFromLibraryForGroup,
  setFavoriteForGroup,
  setLibraryStatusForGroup,
  type LibraryStatus,
} from './local/db';
import { subscribeSourceHealth } from './sources/health';
import { isAbortError } from './sources/http';
import { clusterSearchResults, findMatches, type WorkCluster } from './sources/match';
import { SourceManager, SourceRegistry, sourcesInfo } from './sources/registry';
import type { Chapter, ChapterPage, MangaDetails, MangaSearchResult } from './sources/types';
import {
  clearAllDownloads,
  deleteChapterDownload,
  deleteMangaDownloads,
  downloadChapterPages,
  localPages,
} from '@/lib/downloads';
import { genreForTagLanguage, tagLanguageOf } from '@/lib/genreMap';
import { mapLimit } from '@/lib/pool';
import { isSourceUsable } from '@/lib/sourceFilter';
import { downloadKey, useDownloadProgress } from '@/store/downloads.store';

const STALE = 5 * 60 * 1000;
// Recommendations barely move; refetching them on every visit to Home would
// just be a multi-source burst. Library edits invalidate them anyway.
const FOR_YOU_STALE = 30 * 60 * 1000;

/** The enabled content languages a given source can actually serve. */
const langsFor = (sourceId: string, enabledLanguages: string[]) =>
  (SourceRegistry.get(sourceId)?.languages ?? []).filter((l) => enabledLanguages.includes(l));

/**
 * Remember whether a (source, title, language) has readable chapters. An empty
 * list only counts as "dead" from sources whose empty answer is trustworthy —
 * an HTML scraper that parsed nothing may just be looking at a changed layout
 * or an error page, and must not get the title hidden for days.
 */
function recordChapterCheck(sourceId: string, externalId: string, lang: string, count: number) {
  if (count === 0 && !SourceRegistry.get(sourceId)?.trustEmptyChapters) return;
  markChaptersChecked(sourceId, externalId, lang, count > 0).catch(() => {});
}

// ---- Source queries (run on-device, directly against each site) ----

export function useSourcesQuery() {
  return useQuery({
    queryKey: ['sources'],
    queryFn: async () => sourcesInfo(),
    // Local + instant: recompute on mount so the list always reflects the
    // current provider registry (a persisted Infinity cache hid new sources).
    staleTime: 0,
  });
}

/** Mount once (root layout): refresh source badges when live health changes. */
export function useSourceHealthSync() {
  const qc = useQueryClient();
  useEffect(
    () => subscribeSourceHealth(() => qc.invalidateQueries({ queryKey: ['sources'] })),
    [qc],
  );
}

export function useTrending(
  sourceId: string,
  lang?: string,
  sort: 'popular' | 'latest' = 'popular',
  limit?: number,
) {
  return useQuery({
    queryKey: ['trending', sourceId, lang, sort, limit],
    queryFn: ({ signal }) => SourceManager.require(sourceId).trending({ lang, sort, limit, signal }),
    staleTime: STALE,
  });
}

export function useSearch(sourceId: string, query: string, lang?: string) {
  return useQuery({
    queryKey: ['search', sourceId, query, lang],
    queryFn: ({ signal }) => SourceManager.require(sourceId).search(query, { lang, signal }),
    enabled: query.trim().length > 0,
    staleTime: STALE,
  });
}

/** Whether a source can do real genre browse (drives "More like this" + tags). */
export function sourceSupportsGenres(sourceId: string): boolean {
  // Called while rendering — an unknown (e.g. removed) source must not throw.
  return typeof SourceRegistry.get(sourceId)?.browseByGenre === 'function';
}

/**
 * Genre browse across every enabled genre-capable source: the genre name is
 * translated into each provider's tag language (EN↔RU) before querying; a
 * provider with no translation is skipped rather than fed a name it would
 * ignore. Duplicates collapse into one card per work. Throws when every
 * source that was asked failed, so the screen says so instead of "nothing".
 */
async function browseGenreAcrossSources(
  genre: string,
  enabledLanguages: string[],
  hiddenSources: string[],
  limitPerSource = 24,
  signal?: AbortSignal,
): Promise<WorkCluster[]> {
  const providers = SourceRegistry.all().filter(
    (p) => p.browseByGenre && isSourceUsable(p, enabledLanguages, hiddenSources),
  );
  let asked = 0;
  let failed = 0;
  const perSource = await Promise.all(
    providers.map(async (p) => {
      const name = genreForTagLanguage(genre, tagLanguageOf(p.id));
      if (!name) return [];
      asked++;
      // Results must be readable in one of the user's languages.
      const langs = langsFor(p.id, enabledLanguages);
      try {
        return await p.browseByGenre!(name, { lang: langs[0], langs, limit: limitPerSource, signal });
      } catch (e) {
        if (isAbortError(e)) throw e;
        failed++;
        return [];
      }
    }),
  );
  if (asked > 0 && failed === asked) throw new Error('No source answered');
  return clusterSearchResults(perSource.flat());
}

/** The Browse screen's query (respects content languages + hidden sources). */
export function useBrowseGenreAll(
  genre: string,
  enabledLanguages: string[],
  hiddenSources: string[],
) {
  const langKey = [...enabledLanguages].sort().join(',');
  const hiddenKey = [...hiddenSources].sort().join(',');
  return useQuery({
    queryKey: ['browse-genre', genre, langKey, hiddenKey],
    enabled: genre.trim().length > 0,
    staleTime: STALE,
    queryFn: ({ signal }) =>
      browseGenreAcrossSources(genre, enabledLanguages, hiddenSources, 24, signal),
  });
}

export type ForYouRail = { genre: string; items: WorkCluster[] };

/**
 * Home "For you" rails: find the user's most-read genres from the library
 * (genre names are stored with each cached title and normalized EN↔RU so
 * "Боевик" and "Action" count as one), then pull a cross-source genre feed for
 * the top two. Titles already in the library are filtered out — recommendations
 * should be new. Empty while the library has no genre data yet.
 */
export function useForYou(enabledLanguages: string[], hiddenSources: string[], enabled = true) {
  const langKey = [...enabledLanguages].sort().join(',');
  const hiddenKey = [...hiddenSources].sort().join(',');
  return useQuery({
    queryKey: ['for-you', langKey, hiddenKey],
    enabled,
    staleTime: FOR_YOU_STALE,
    queryFn: async ({ signal }): Promise<ForYouRail[]> => {
      const lib = await getLibrary();
      if (lib.length === 0) return [];

      // Count genres across the library, normalized to a canonical key.
      const counts = new Map<string, { display: string; count: number }>();
      for (const row of lib) {
        if (!row.genres) continue;
        let names: string[] = [];
        try {
          names = JSON.parse(row.genres) as string[];
        } catch {
          continue;
        }
        for (const raw of names) {
          const en = genreForTagLanguage(raw, 'en');
          const key = (en ?? raw).toLowerCase();
          const existing = counts.get(key);
          if (existing) existing.count += 1;
          else counts.set(key, { display: en ?? raw, count: 1 });
        }
      }
      const top = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 2);
      if (top.length === 0) return [];

      const libTitles = new Set(lib.map((r) => r.title.trim().toLowerCase()));
      const seenWorks = new Set<string>();
      const rails: ForYouRail[] = [];
      for (const g of top) {
        let clusters: WorkCluster[];
        try {
          clusters = await browseGenreAcrossSources(
            g.display,
            enabledLanguages,
            hiddenSources,
            20,
            signal,
          );
        } catch (e) {
          if (isAbortError(e)) throw e;
          continue; // this genre's sources are down — the other rail still shows
        }
        const items = clusters
          .filter((c) => {
            // Skip what the user already has, and what an earlier rail shows.
            if (c.variants.some((v) => libTitles.has(v.title.trim().toLowerCase()))) return false;
            if (seenWorks.has(c.key)) return false;
            seenWorks.add(c.key);
            return true;
          })
          .slice(0, 12);
        if (items.length > 0) rails.push({ genre: g.display, items });
      }
      return rails;
    },
  });
}

/**
 * "More like this": titles sharing a genre with the current one, from the SAME
 * source (so genre names match). Walks the manga's own genres until it has
 * enough unique results; empty when the source has no genre index.
 */
export function useSimilar(
  sourceId: string,
  genres: string[] | undefined,
  excludeId: string,
  lang?: string,
) {
  const list = (genres ?? []).slice(0, 3);
  return useQuery({
    queryKey: ['similar', sourceId, excludeId, list.join('|'), lang],
    enabled: list.length > 0,
    staleTime: STALE,
    queryFn: async ({ signal }): Promise<MangaSearchResult[]> => {
      const provider = SourceManager.require(sourceId);
      if (!provider.browseByGenre) return [];
      const seen = new Set<string>([excludeId]);
      const out: MangaSearchResult[] = [];
      for (const g of list) {
        if (out.length >= 12) break;
        try {
          const res = await provider.browseByGenre(g, { lang, limit: 20, signal });
          for (const m of res) {
            if (seen.has(m.externalId)) continue;
            seen.add(m.externalId);
            out.push(m);
            if (out.length >= 12) break;
          }
        } catch (e) {
          if (isAbortError(e)) throw e;
          // Skip a genre that fails; the others still contribute.
        }
      }
      return out;
    },
  });
}

export type UnifiedSearchResult = {
  clusters: WorkCluster[];
  /** Sources that errored — the screen names them instead of hiding it. */
  failedSources: string[];
};

/**
 * Search every enabled, searchable source in parallel and collapse duplicates
 * into one card per work (cross-source search). A failing source doesn't sink
 * the others; if ALL fail, the query errors so the screen shows a retry.
 */
export function useUnifiedSearch(
  query: string,
  enabledLanguages: string[],
  hiddenSources: string[],
  limit = 20,
) {
  const langKey = [...enabledLanguages].sort().join(',');
  const hiddenKey = [...hiddenSources].sort().join(',');
  return useQuery({
    queryKey: ['unified-search', query, langKey, hiddenKey],
    enabled: query.trim().length > 0,
    staleTime: STALE,
    queryFn: async ({ signal }): Promise<UnifiedSearchResult> => {
      const providers = SourceRegistry.all().filter(
        (p) => p.supportsSearch && isSourceUsable(p, enabledLanguages, hiddenSources),
      );
      const failedSources: string[] = [];
      const perSource = await Promise.all(
        providers.map(async (p) => {
          try {
            // Multi-language sources only return titles readable in the
            // user's languages (was: any language at all).
            return await p.search(query, { limit, langs: langsFor(p.id, enabledLanguages), signal });
          } catch (e) {
            if (isAbortError(e)) throw e;
            failedSources.push(p.id);
            return [];
          }
        }),
      );
      if (providers.length > 0 && failedSources.length === providers.length) {
        throw new Error('No source answered');
      }
      return { clusters: clusterSearchResults(perSource.flat()), failedSources };
    },
  });
}

export function useMatches(
  manga: MangaDetails | undefined,
  excludeSourceId: string,
  enabledLanguages: string[],
  hiddenSources: string[],
) {
  const langKey = [...enabledLanguages].sort().join(',');
  const hiddenKey = [...hiddenSources].sort().join(',');
  return useQuery({
    queryKey: ['match', excludeSourceId, manga?.externalId, langKey, hiddenKey],
    queryFn: ({ signal }) =>
      findMatches(manga!, excludeSourceId, enabledLanguages, hiddenSources, signal),
    enabled: !!manga && manga.title.length > 1,
    staleTime: STALE,
  });
}

/**
 * Cross-source progress: if you've read this title on ANOTHER source (found via
 * matches), return the furthest chapter number you reached there — so we can
 * offer to resume at roughly that chapter on the current source.
 */
export function useCrossSourceProgress(matches: MangaSearchResult[] | undefined) {
  const key = (matches ?? []).map((m) => `${m.sourceId}:${m.externalId}`).join(',');
  return useQuery({
    queryKey: ['cross-progress', key],
    enabled: !!matches && matches.length > 0,
    queryFn: async () => {
      const rows = await Promise.all(
        (matches ?? []).map(async (m) => {
          const p = await getMangaProgress(m.sourceId, m.externalId);
          const num = p?.chapter_number ? Number(p.chapter_number) : NaN;
          return p && !isNaN(num)
            ? { sourceId: m.sourceId, chapterNumber: p.chapter_number, num }
            : null;
        }),
      );
      const valid = rows.filter((x): x is NonNullable<typeof x> => x !== null);
      return valid.sort((a, b) => b.num - a.num)[0] ?? null;
    },
    staleTime: 0,
  });
}

/**
 * When the active source has no readable chapters (often a licensed title), find
 * the first OTHER source for this work that does — so the UI can offer a working
 * source in one tap instead of leaving a dead end. Only runs when `enabled`
 * (i.e. the current source really is empty), and stops at the first hit.
 */
export function useReadableFallback(
  variants: { sourceId: string; externalId: string }[],
  activeSourceId: string,
  activeId: string,
  enabled: boolean,
) {
  const others = variants.filter(
    (v) => !(v.sourceId === activeSourceId && v.externalId === activeId),
  );
  const key = others.map((v) => `${v.sourceId}:${v.externalId}`).join(',');
  return useQuery({
    queryKey: ['readable-fallback', activeSourceId, activeId, key],
    enabled: enabled && others.length > 0,
    staleTime: STALE,
    queryFn: async ({ signal }) => {
      for (const v of others) {
        try {
          const provider = SourceManager.require(v.sourceId);
          if (!provider.supportsReading) continue;
          const lang = provider.languages[0] ?? 'en';
          const chapters = await provider.getChapters(v.externalId, lang, { signal });
          // Teach the dead-chapters cache from these probes too (success path only).
          recordChapterCheck(v.sourceId, v.externalId, lang, chapters.length);
          if (chapters.length > 0) {
            return { sourceId: v.sourceId, externalId: v.externalId, count: chapters.length, lang };
          }
        } catch (e) {
          // The page closed: stop probing. A down source shouldn't block
          // finding a readable one.
          if (isAbortError(e)) throw e;
        }
      }
      return null;
    },
  });
}

export function useMangaDetails(sourceId: string, externalId: string) {
  return useQuery({
    queryKey: ['manga', sourceId, externalId],
    queryFn: async ({ signal }) => {
      const details = await SourceManager.require(sourceId).getMangaDetails(externalId, {
        signal,
      });
      await cacheManga({
        source_id: details.sourceId,
        external_id: details.externalId,
        title: details.title,
        cover_url: details.coverUrl ?? null,
        description: details.description ?? null,
        genres: details.genres ?? null,
      });
      return details;
    },
    staleTime: STALE,
  });
}

/**
 * The locally cached title (SQLite) as MangaDetails — what the title page shows
 * when the network is down and nothing is in the query cache, so downloaded
 * chapters stay reachable offline.
 */
export function useCachedMangaDetails(sourceId: string, externalId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['cached-manga', sourceId, externalId],
    enabled,
    staleTime: 0,
    queryFn: async (): Promise<MangaDetails | null> => {
      const row = await getCachedManga(sourceId, externalId);
      if (!row) return null;
      let genres: string[] | undefined;
      try {
        genres = row.genres ? (JSON.parse(row.genres) as string[]) : undefined;
      } catch {
        genres = undefined;
      }
      return {
        sourceId: row.source_id,
        externalId: row.external_id,
        title: row.title,
        coverUrl: row.cover_url ?? undefined,
        description: row.description ?? undefined,
        genres,
        languages: SourceRegistry.get(sourceId)?.languages ?? [],
      };
    },
  });
}

export function useChapters(sourceId: string, externalId: string, lang: string) {
  return useQuery({
    queryKey: ['chapters', sourceId, externalId, lang],
    queryFn: async ({ signal }) => {
      const chapters = await SourceManager.require(sourceId).getChapters(externalId, lang, {
        signal,
      });
      // Only reached on success, so a timeout never marks anything.
      recordChapterCheck(sourceId, externalId, lang, chapters.length);
      return chapters;
    },
    staleTime: STALE,
  });
}

/** A title's DOWNLOADED chapters as a chapter list — the offline fallback. */
export function useOfflineChapters(sourceId: string, externalId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['offline-chapters', sourceId, externalId],
    enabled,
    staleTime: 0,
    queryFn: async (): Promise<Chapter[]> => {
      const rows = await getMangaDownloadChapters(sourceId, externalId);
      return rows.map((r) => ({
        sourceId,
        externalId: r.chapter_id,
        mangaExternalId: externalId,
        chapterNumber: r.chapter_number ?? undefined,
        language: r.language,
      }));
    },
  });
}

/** Set of `source:external:lang` keys known to have zero readable chapters. */
export function useDeadChapters() {
  return useQuery({
    queryKey: ['dead-chapters'],
    queryFn: () => getDeadChapterKeys(),
    staleTime: 0,
  });
}

/**
 * A chapter's pages: downloaded files when present and complete (instant,
 * offline), otherwise the source. Shared by the reader and its next-chapter
 * prefetch, so a prefetch can't plant network URLs over a local download.
 */
export async function fetchChapterPages(
  sourceId: string,
  chapterId: string,
  signal?: AbortSignal,
): Promise<ChapterPage[]> {
  const local = await getDownload(sourceId, chapterId);
  if (local) {
    try {
      const pages = localPages(local);
      if (pages) return pages;
      // Files are gone (cleared by the OS or by hand): drop the stale record so
      // the chapter stops showing as downloaded, and read it online instead.
      removeDownload(sourceId, chapterId).catch(() => {});
    } catch {
      // Corrupt row — fall through to the network.
    }
  }
  return SourceManager.require(sourceId).getChapterPages(chapterId, { signal });
}

export function useChapterPages(sourceId: string, chapterId: string) {
  return useQuery({
    queryKey: ['pages', sourceId, chapterId],
    queryFn: ({ signal }) => fetchChapterPages(sourceId, chapterId, signal),
    staleTime: 8 * 60 * 1000,
    gcTime: 8 * 60 * 1000,
  });
}

// ---- Local-only queries (SQLite) ----

export function useContinueReading() {
  return useQuery({
    queryKey: ['continue-reading'],
    queryFn: () => getContinueReading(),
    staleTime: 0,
  });
}

export function useLibrary() {
  return useQuery({
    queryKey: ['library'],
    queryFn: () => getLibrary(),
    staleTime: 0,
  });
}

export type UpdateItem = {
  sourceId: string;
  externalId: string;
  title: string;
  coverUrl: string | null;
  language: string;
  unread: number;
  latestNumber?: string;
  next: { id: string; number?: string } | null;
  lastReadAt: number | null;
};

export type UpdatesResult = {
  items: UpdateItem[];
  /** Titles whose source couldn't be checked this time. */
  failed: { sourceId: string; title: string }[];
};

// Set by an explicit refresh so the next Updates run re-downloads every chapter
// list instead of reusing ones cached up to 5 minutes ago.
let forceNextUpdates = false;

/** Pull-to-refresh / refresh button on Updates: check the sources for real. */
export function refreshUpdates(qc: QueryClient) {
  forceNextUpdates = true;
  return qc.refetchQueries({ queryKey: ['updates'], exact: true });
}

/**
 * A title's chapter list through the shared query cache. When the fetch was
 * started by a title page that closes mid-request, closing cancels it — start
 * again instead of reporting the title as unreachable.
 */
async function fetchChaptersShared(
  qc: QueryClient,
  sourceId: string,
  externalId: string,
  lang: string,
  staleTime: number,
): Promise<Chapter[]> {
  const run = () =>
    qc.fetchQuery({
      queryKey: ['chapters', sourceId, externalId, lang],
      queryFn: ({ signal }) =>
        SourceManager.require(sourceId).getChapters(externalId, lang, { signal }),
      staleTime,
    });
  try {
    return await run();
  } catch (e) {
    if (!isCancelledError(e)) throw e;
    return run();
  }
}

/**
 * New-chapters feed: for every library title you've STARTED, fetch its chapters
 * and count how many are newer than your last-read one. Shares the per-manga
 * chapters cache so revisiting the tab is cheap; `refreshUpdates` bypasses it.
 */
export function useUpdates() {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['updates'],
    queryFn: async (): Promise<UpdatesResult> => {
      const force = forceNextUpdates;
      forceNextUpdates = false;
      const lib = await getLibrary();
      const started = lib.filter((m) => m.chapter_number != null);
      const failed: UpdatesResult['failed'] = [];
      // Small pool, not the whole library at once (rate limits + JS thread).
      const items = await mapLimit(started, 4, async (m) => {
        const lang = m.language || SourceRegistry.get(m.source_id)?.languages[0] || 'en';
        try {
          const chapters = await fetchChaptersShared(
            qc,
            m.source_id,
            m.external_id,
            lang,
            force ? 0 : STALE,
          );
          if (!chapters.length) return null;
          // A chapter counts as read if explicitly marked/finished, or if it's
          // at/below the latest position you've reached. Combining both makes
          // the count accurate for mark-as-read AND out-of-order reading,
          // without flagging a just-started title's whole backlog as unread.
          const readNums = new Set(await getReadChapterNumbers(m.source_id, m.external_id));
          const currentNum = Number(m.chapter_number);
          const isRead = (c: { externalId: string; chapterNumber?: string }) => {
            const norm = normChapterNumber(c.chapterNumber);
            if (norm && readNums.has(norm)) return true;
            const n = Number(c.chapterNumber);
            return !isNaN(n) && !isNaN(currentNum) && n <= currentNum;
          };
          // Count each chapter NUMBER once: MangaDex lists the same chapter from
          // several scanlation groups, which used to inflate "N unread".
          const unreadKeys = new Set<string>();
          const unread: Chapter[] = [];
          for (const c of chapters) {
            if (isRead(c)) continue;
            const key = normChapterNumber(c.chapterNumber) ?? `id:${c.externalId}`;
            if (unreadKeys.has(key)) continue;
            unreadKeys.add(key);
            unread.push(c);
          }
          if (unread.length === 0) return null;
          const next = unread[0];
          return {
            sourceId: m.source_id,
            externalId: m.external_id,
            title: m.title,
            coverUrl: m.cover_url,
            language: lang,
            unread: unread.length,
            latestNumber: chapters[chapters.length - 1].chapterNumber,
            next: { id: next.externalId, number: next.chapterNumber },
            lastReadAt: m.last_read_at,
          } as UpdateItem;
        } catch {
          failed.push({ sourceId: m.source_id, title: m.title });
          return null;
        }
      });
      if (started.length > 0 && failed.length === started.length) {
        throw new Error('Couldn’t reach any source');
      }
      return {
        items: items
          .filter((x): x is UpdateItem => x !== null)
          .sort((a, b) => b.unread - a.unread || (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0)),
        failed,
      };
    },
    staleTime: STALE,
    // Failures are already handled per title; retrying would re-walk the
    // whole library just to fail the same way (e.g. offline).
    retry: false,
  });
}

/** Set of chapter ids the user has finished/marked read for a title. */
export function useReadChapters(sourceId: string, externalId: string) {
  return useQuery({
    queryKey: ['read-chapters', sourceId, externalId],
    queryFn: () => getReadChapterIds(sourceId, externalId),
    staleTime: 0,
  });
}

// ---- Offline downloads ----

/** Chapter ids of this title already saved to the device. */
export function useDownloadedChapters(sourceId: string, externalId: string) {
  return useQuery({
    queryKey: ['downloaded-chapters', sourceId, externalId],
    queryFn: () => getDownloadedChapterIds(sourceId, externalId),
    staleTime: 0,
  });
}

/** Downloads grouped per title, for the Library "Downloads" view. */
export function useDownloadedManga() {
  return useQuery({
    queryKey: ['downloads'],
    queryFn: () => getDownloadedManga(),
    staleTime: 0,
  });
}

/** Total bytes on disk, for the Settings storage row. */
export function useDownloadsSize() {
  return useQuery({
    queryKey: ['downloads-bytes'],
    queryFn: () => getDownloadsTotalBytes(),
    staleTime: 0,
  });
}

/** After a download is added/removed, every view of it must re-read the disk. */
function invalidateDownloadViews(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['downloaded-chapters'] });
  qc.invalidateQueries({ queryKey: ['downloads'] });
  qc.invalidateQueries({ queryKey: ['downloads-bytes'] });
  qc.invalidateQueries({ queryKey: ['offline-chapters'] });
}

/**
 * Download one chapter: fetch a FRESH page list straight from the source (URLs
 * expire), then save every page to disk. Progress streams into the downloads
 * store for the UI. Afterwards the cached page list is dropped so the reader
 * switches to the local files.
 */
export function useDownloadChapter(sourceId: string, mangaExternalId: string, language: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { chapterId: string; chapterNumber?: string | null }) => {
      const key = downloadKey(sourceId, v.chapterId);
      useDownloadProgress.getState().start(key, 0);
      try {
        const pages = await SourceManager.require(sourceId).getChapterPages(v.chapterId);
        await downloadChapterPages({
          sourceId,
          mangaExternalId,
          chapterId: v.chapterId,
          chapterNumber: v.chapterNumber,
          language,
          pages,
          onProgress: (done, total) => useDownloadProgress.getState().tick(key, done, total),
        });
      } finally {
        useDownloadProgress.getState().clear(key);
      }
    },
    onSuccess: (_data, v) => {
      const key = ['pages', sourceId, v.chapterId];
      if (qc.getQueryCache().find({ queryKey: key, exact: true })?.getObserversCount()) {
        // Open in the reader right now: don't swap its pages mid-chapter. Marked
        // invalidated, a failed page's retry moves it to the saved files.
        qc.invalidateQueries({ queryKey: key, exact: true, refetchType: 'none' });
      } else {
        // The next open reads the saved files, not cached network URLs.
        qc.removeQueries({ queryKey: key, exact: true });
      }
      invalidateDownloadViews(qc);
    },
    // Said for every failed chapter (several can be queued), not silently dropped.
    onError: (_e, v) => {
      Alert.alert(
        'Download failed',
        `${v.chapterNumber ? `Chapter ${v.chapterNumber}` : 'A chapter'} couldn’t be saved — some pages didn’t download. Tap ⬇ to try again.`,
      );
    },
  });
}

/** Remove one chapter's files, or a whole title's, or everything. */
export function useDeleteDownload() {
  const qc = useQueryClient();
  const chapter = useMutation({
    mutationFn: (v: { sourceId: string; chapterId: string }) =>
      deleteChapterDownload(v.sourceId, v.chapterId),
    onSuccess: (_d, v) => {
      // A cached page list may point at the deleted files.
      qc.removeQueries({ queryKey: ['pages', v.sourceId, v.chapterId], exact: true });
      invalidateDownloadViews(qc);
    },
  });
  const manga = useMutation({
    mutationFn: async (v: { sourceId: string; mangaExternalId: string }) => {
      const ids = await getDownloadedChapterIds(v.sourceId, v.mangaExternalId);
      await deleteMangaDownloads(v.sourceId, v.mangaExternalId);
      return ids;
    },
    onSuccess: (ids, v) => {
      for (const id of ids) qc.removeQueries({ queryKey: ['pages', v.sourceId, id], exact: true });
      invalidateDownloadViews(qc);
    },
  });
  const all = useMutation({
    mutationFn: () => clearAllDownloads(),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['pages'] });
      invalidateDownloadViews(qc);
    },
  });
  return { chapter, manga, all };
}

/** A work's preferred source+language (what to open by default). */
export function useWorkPref(sourceId: string, externalId: string) {
  return useQuery({
    queryKey: ['work-pref', sourceId, externalId],
    queryFn: () => getWorkPref(sourceId, externalId),
    staleTime: 0,
  });
}

/** Read chapter numbers across the whole group (cross-source read state). */
export function useReadChapterNumbers(sourceId: string, externalId: string) {
  return useQuery({
    queryKey: ['read-numbers', sourceId, externalId],
    queryFn: () => getReadChapterNumbers(sourceId, externalId),
    staleTime: 0,
  });
}

/** Mark one or many chapters read/unread (the Mark-as-read controls). */
export function useMarkChaptersRead(sourceId: string, externalId: string, language?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { items: { chapterId: string; chapterNumber?: string }[]; read: boolean }) =>
      markChaptersRead(sourceId, externalId, v.items, v.read, language),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['read-chapters'] });
      qc.invalidateQueries({ queryKey: ['read-numbers'] });
      // Marks can set the position of a title that was never opened.
      qc.invalidateQueries({ queryKey: ['progress', sourceId, externalId] });
      qc.invalidateQueries({ queryKey: ['library'] });
      // Read state changes how many chapters count as "unread" in Updates.
      qc.invalidateQueries({ queryKey: ['updates'] });
    },
  });
}

export function useMangaProgress(sourceId: string, externalId: string) {
  return useQuery({
    queryKey: ['progress', sourceId, externalId],
    queryFn: () => getMangaProgress(sourceId, externalId),
    staleTime: 0,
  });
}

export function useLibraryStatus(sourceId: string, externalId: string) {
  return useQuery({
    queryKey: ['library-status', sourceId, externalId],
    queryFn: () => getLibraryStatus(sourceId, externalId),
    staleTime: 0,
  });
}

export function useSetLibraryStatus(sourceId: string, externalId: string, manga: MangaSearchResult) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (status: LibraryStatus) => {
      await cacheManga({
        source_id: manga.sourceId,
        external_id: manga.externalId,
        title: manga.title,
        cover_url: manga.coverUrl ?? null,
        description: manga.description ?? null,
      });
      await setLibraryStatusForGroup(sourceId, externalId, status);
    },
    onSuccess: () => {
      // Group writes touch sibling sources, so refresh status broadly.
      qc.invalidateQueries({ queryKey: ['library-status'] });
      qc.invalidateQueries({ queryKey: ['library'] });
      qc.invalidateQueries({ queryKey: ['for-you'] });
    },
  });
}

export function useToggleFavorite(manga: MangaSearchResult) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (favorite: boolean) => {
      await cacheManga({
        source_id: manga.sourceId,
        external_id: manga.externalId,
        title: manga.title,
        cover_url: manga.coverUrl ?? null,
        description: manga.description ?? null,
      });
      await setFavoriteForGroup(manga.sourceId, manga.externalId, favorite);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-status'] });
      qc.invalidateQueries({ queryKey: ['library'] });
      qc.invalidateQueries({ queryKey: ['for-you'] });
    },
  });
}

export function useToggleLibrary(manga: MangaSearchResult) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inLibrary: boolean) => {
      if (inLibrary) {
        await removeFromLibraryForGroup(manga.sourceId, manga.externalId);
      } else {
        await cacheManga({
          source_id: manga.sourceId,
          external_id: manga.externalId,
          title: manga.title,
          cover_url: manga.coverUrl ?? null,
          description: manga.description ?? null,
        });
        await addToLibraryForGroup(manga.sourceId, manga.externalId);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-status'] });
      qc.invalidateQueries({ queryKey: ['library'] });
      qc.invalidateQueries({ queryKey: ['for-you'] });
    },
  });
}

// ---- Settings → Data ----

/** Wipe reading progress and refresh EVERYTHING derived from it. */
export function useClearReadingProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => clearReadingProgress(),
    onSuccess: () => {
      for (const key of [
        'continue-reading',
        'library',
        'progress',
        'read-chapters',
        'read-numbers',
        'cross-progress',
        'updates',
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

/** Empty the library and refresh everything derived from membership. */
export function useClearLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => clearLibrary(),
    onSuccess: () => {
      for (const key of ['library', 'library-status', 'for-you', 'updates']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
