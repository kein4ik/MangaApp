import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addToLibrary,
  cacheManga,
  getContinueReading,
  getLibrary,
  getLibraryStatus,
  getMangaProgress,
  removeFromLibrary,
  setFavorite,
  setLibraryStatus,
  type LibraryStatus,
} from './local/db';
import { findMatches } from './sources/match';
import { SourceManager, sourcesInfo } from './sources/registry';
import type { MangaSearchResult } from './sources/types';

const STALE = 5 * 60 * 1000;

// ---- Source queries (run on-device, directly against each site) ----

export function useSourcesQuery() {
  return useQuery({
    queryKey: ['sources'],
    queryFn: async () => sourcesInfo(),
    staleTime: Infinity,
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

export function useMatches(title: string | undefined, excludeSourceId: string) {
  return useQuery({
    queryKey: ['match', title, excludeSourceId],
    queryFn: () => findMatches(title!, excludeSourceId),
    enabled: !!title && title.length > 1,
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
    queryFn: () => SourceManager.require(sourceId).getChapters(externalId, lang),
    staleTime: STALE,
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
            const lastRead = Number(m.chapter_number);
            const unread = chapters.filter((c) => Number(c.chapterNumber) > lastRead);
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
      await setLibraryStatus(sourceId, externalId, status);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-status', sourceId, externalId] });
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
      await setFavorite(manga.sourceId, manga.externalId, favorite);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-status', manga.sourceId, manga.externalId] });
      qc.invalidateQueries({ queryKey: ['library'] });
    },
  });
}

export function useToggleLibrary(manga: MangaSearchResult) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inLibrary: boolean) => {
      if (inLibrary) {
        await removeFromLibrary(manga.sourceId, manga.externalId);
      } else {
        await cacheManga({
          source_id: manga.sourceId,
          external_id: manga.externalId,
          title: manga.title,
          cover_url: manga.coverUrl ?? null,
          description: manga.description ?? null,
        });
        await addToLibrary(manga.sourceId, manga.externalId);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-status', manga.sourceId, manga.externalId] });
      qc.invalidateQueries({ queryKey: ['library'] });
    },
  });
}
