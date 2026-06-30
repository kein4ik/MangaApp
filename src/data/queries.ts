import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addToLibraryForGroup,
  cacheManga,
  getContinueReading,
  getLibrary,
  getLibraryStatus,
  getDeadChapterKeys,
  getMangaProgress,
  getReadChapterIds,
  getReadChapterNumbers,
  getWorkPref,
  markChaptersChecked,
  markChaptersRead,
  normChapterNumber,
  removeFromLibraryForGroup,
  setFavoriteForGroup,
  setLibraryStatusForGroup,
  type LibraryStatus,
} from './local/db';
import { clusterSearchResults, findMatches, type WorkCluster } from './sources/match';
import { SourceManager, SourceRegistry, sourcesInfo } from './sources/registry';
import type { MangaDetails, MangaSearchResult } from './sources/types';
import { isSourceUsable } from '@/lib/sourceFilter';

const STALE = 5 * 60 * 1000;

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

export function useTrending(
  sourceId: string,
  lang?: string,
  sort: 'popular' | 'latest' = 'popular',
  limit?: number,
) {
  return useQuery({
    queryKey: ['trending', sourceId, lang, sort, limit],
    queryFn: () => SourceManager.require(sourceId).trending({ lang, sort, limit }),
    staleTime: STALE,
  });
}

export function useSearch(sourceId: string, query: string, lang?: string) {
  return useQuery({
    queryKey: ['search', sourceId, query, lang],
    queryFn: () => SourceManager.require(sourceId).search(query, { lang }),
    enabled: query.trim().length > 0,
    staleTime: STALE,
  });
}

/**
 * Search every enabled, searchable source in parallel and collapse duplicates
 * into one card per work (cross-source search). A source that errors or is
 * hidden is simply skipped — the rest still return.
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
    queryFn: async (): Promise<WorkCluster[]> => {
      const providers = SourceRegistry.all().filter(
        (p) => p.supportsSearch && isSourceUsable(p, enabledLanguages, hiddenSources),
      );
      const perSource = await Promise.all(
        providers.map(async (p) => {
          try {
            return await p.search(query, { limit });
          } catch {
            return [];
          }
        }),
      );
      return clusterSearchResults(perSource.flat());
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
    queryFn: () => findMatches(manga!, excludeSourceId, enabledLanguages, hiddenSources),
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
    queryFn: async () => {
      for (const v of others) {
        try {
          const provider = SourceManager.require(v.sourceId);
          if (!provider.supportsReading) continue;
          const lang = provider.languages[0] ?? 'en';
          const chapters = await provider.getChapters(v.externalId, lang);
          // Teach the dead-chapters cache from these probes too (success path only).
          markChaptersChecked(v.sourceId, v.externalId, lang, chapters.length > 0).catch(() => {});
          if (chapters.length > 0) {
            return { sourceId: v.sourceId, externalId: v.externalId, count: chapters.length, lang };
          }
        } catch {
          // A down source shouldn't block finding a readable one.
        }
      }
      return null;
    },
  });
}

export function useMangaDetails(sourceId: string, externalId: string) {
  return useQuery({
    queryKey: ['manga', sourceId, externalId],
    queryFn: async () => {
      const details = await SourceManager.require(sourceId).getMangaDetails(externalId);
      await cacheManga({
        source_id: details.sourceId,
        external_id: details.externalId,
        title: details.title,
        cover_url: details.coverUrl ?? null,
        description: details.description ?? null,
      });
      return details;
    },
    staleTime: STALE,
  });
}

export function useChapters(sourceId: string, externalId: string, lang: string) {
  return useQuery({
    queryKey: ['chapters', sourceId, externalId, lang],
    queryFn: async () => {
      const chapters = await SourceManager.require(sourceId).getChapters(externalId, lang);
      // Only reached on success, so an empty result here is genuinely empty
      // (not a timeout) — safe to remember as a dead source+title+language.
      markChaptersChecked(sourceId, externalId, lang, chapters.length > 0).catch(() => {});
      return chapters;
    },
    staleTime: STALE,
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

export function useChapterPages(sourceId: string, chapterId: string) {
  return useQuery({
    queryKey: ['pages', sourceId, chapterId],
    queryFn: () => SourceManager.require(sourceId).getChapterPages(chapterId),
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

/**
 * New-chapters feed: for every library title you've STARTED, fetch its chapters
 * and count how many are newer than your last-read one. Shares the per-manga
 * chapters cache so it's cheap after browsing.
 */
export function useUpdates() {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['updates'],
    queryFn: async (): Promise<UpdateItem[]> => {
      const lib = await getLibrary();
      const started = lib.filter((m) => m.chapter_number != null);
      const items = await Promise.all(
        started.map(async (m) => {
          const lang = m.language || 'en';
          try {
            const chapters = await qc.fetchQuery({
              queryKey: ['chapters', m.source_id, m.external_id, lang],
              queryFn: () => SourceManager.require(m.source_id).getChapters(m.external_id, lang),
              staleTime: STALE,
            });
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
            const unread = chapters.filter((c) => !isRead(c));
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
            return null;
          }
        }),
      );
      return items
        .filter((x): x is UpdateItem => x !== null)
        .sort((a, b) => b.unread - a.unread || (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0));
    },
    staleTime: STALE,
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
export function useMarkChaptersRead(sourceId: string, externalId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { items: { chapterId: string; chapterNumber?: string }[]; read: boolean }) =>
      markChaptersRead(sourceId, externalId, v.items, v.read),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['read-chapters', sourceId, externalId] });
      qc.invalidateQueries({ queryKey: ['read-numbers'] });
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
    },
  });
}
