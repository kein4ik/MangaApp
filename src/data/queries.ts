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
