/**
 * Normalized DTOs returned by every source provider.
 * The UI (MangaCard, MangaDetails, Reader) depends only on these shapes,
 * never on a specific site's response format.
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
  /** Some providers require specific headers (referer, etc.) to load the image. */
  headers?: Record<string, string>;
  /** Some providers hand out temporary URLs — never assume they are permanent. */
  expiresAt?: string;
};

/** What every provider call accepts. */
export type CallOptions = {
  /** Cancels the request when the caller no longer needs it. */
  signal?: AbortSignal;
};

export type SearchOptions = CallOptions & {
  lang?: string;
  /**
   * Content languages the results must be readable in. Multi-language sources
   * (MangaDex) filter by them; single-language sources ignore it.
   */
  langs?: string[];
  limit?: number;
  offset?: number;
  sort?: 'popular' | 'latest';
};

/** `unknown` = no traffic to this source yet in this session. */
export type SourceStatus = 'online' | 'slow' | 'broken' | 'disabled' | 'unknown';

/** Source capabilities + live health (learned from the app's own requests). */
export type SourceInfo = {
  id: string;
  name: string;
  languages: string[];
  type: 'official_api' | 'scraper' | 'user_files' | 'external_link';
  supportsSearch: boolean;
  supportsReading: boolean;
  status: SourceStatus;
};
