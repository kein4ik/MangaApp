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

export type SearchOptions = {
  lang?: string;
  limit?: number;
  offset?: number;
};

export type SourceStatus = 'online' | 'slow' | 'broken' | 'disabled';

/** Source capabilities + live health, as returned by the backend GET /sources. */
export type SourceInfo = {
  id: string;
  name: string;
  languages: string[];
  type: 'official_api' | 'scraper' | 'user_files' | 'external_link';
  supportsSearch: boolean;
  supportsReading: boolean;
  status: SourceStatus;
};
