import type {
  Chapter,
  ChapterPage,
  MangaDetails,
  MangaSearchResult,
  SearchOptions,
} from '../types.js';

/**
 * Every source implements this. The SourceManager and routes talk only through
 * it, so adding a new site = one new file + a registry entry. No route changes.
 */
export interface SourceProvider {
  id: string;
  name: string;
  languages: string[];
  type: 'official_api' | 'scraper' | 'user_files' | 'external_link';
  supportsSearch: boolean;
  supportsReading: boolean;

  trending(options?: SearchOptions): Promise<MangaSearchResult[]>;
  search(query: string, options?: SearchOptions): Promise<MangaSearchResult[]>;
  getMangaDetails(externalId: string): Promise<MangaDetails>;
  getChapters(externalId: string, lang?: string): Promise<Chapter[]>;
  getChapterPages(chapterId: string): Promise<ChapterPage[]>;
}
