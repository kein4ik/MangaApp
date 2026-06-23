import type {
  Chapter,
  ChapterPage,
  MangaDetails,
  MangaSearchResult,
  SearchOptions,
} from './types';

/**
 * The single interface every source implements. These run ON-DEVICE (the app
 * fetches sources directly), so RU sites see the phone's residential IP instead
 * of a datacenter IP — no backend, works anywhere.
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
