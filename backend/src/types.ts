/**
 * Normalized DTOs — the single contract between the app and every source.
 * Mirrors the app's src/data/sources/types.ts exactly.
 */

export type MangaStatus = 'ongoing' | 'completed' | 'hiatus' | 'unknown';

export type MangaSearchResult = {
  sourceId: string;
  externalId: string;
  globalMangaId?: string;
  title: string;
  altTitles?: string[];
  coverUrl?: string;
  description?: string;
  status?: MangaStatus;
  languages: string[];
};

export type MangaDetails = MangaSearchResult & {
  authors?: string[];
  genres?: string[];
  year?: number;
  contentRating?: string;
};

export type Chapter = {
  sourceId: string;
  externalId: string;
  mangaExternalId: string;
  title?: string;
  chapterNumber?: string;
  volume?: string;
  language: string;
  publishedAt?: string;
  scanlationGroup?: string;
};

export type ChapterPage = {
  index: number;
  imageUrl: string;
  width?: number;
  height?: number;
  headers?: Record<string, string>;
  expiresAt?: string;
};

export type SearchOptions = {
  lang?: string;
  limit?: number;
  offset?: number;
  /** Discovery ordering for trending: most-followed vs recently updated. */
  sort?: 'popular' | 'latest';
};

/** Capabilities + state exposed to the app via GET /sources. */
export type SourceInfo = {
  id: string;
  name: string;
  languages: string[];
  type: 'official_api' | 'scraper' | 'user_files' | 'external_link';
  supportsSearch: boolean;
  supportsReading: boolean;
  status: SourceStatus;
};

export type SourceStatus = 'online' | 'slow' | 'broken' | 'disabled';
