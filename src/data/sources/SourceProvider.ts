import type {
  CallOptions,
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
  /**
   * True when an EMPTY getChapters() result can be trusted as "this title has no
   * readable chapters here" (a JSON API answering with an empty list). HTML
   * scrapers leave it unset: zero parsed chapters is just as likely a changed
   * page layout or an error page served with HTTP 200, and must never get the
   * title hidden as dead.
   */
  trustEmptyChapters?: boolean;

  // A layout the parser doesn't recognise, or an error page served with 200,
  // must throw (UnexpectedPageError), never come back as an empty result.
  trending(options?: SearchOptions): Promise<MangaSearchResult[]>;
  search(query: string, options?: SearchOptions): Promise<MangaSearchResult[]>;
  getMangaDetails(externalId: string, options?: CallOptions): Promise<MangaDetails>;
  getChapters(externalId: string, lang?: string, options?: CallOptions): Promise<Chapter[]>;
  getChapterPages(chapterId: string, options?: CallOptions): Promise<ChapterPage[]>;

  /**
   * Optional: real genre/tag browse (not a title search). The `genre` string is
   * matched against the source's own tag names — so it's meant to be fed a genre
   * that came from THIS source's details, where the naming already matches
   * (MangaDex = English tags, MangaLib = Russian). Powers "More like this" and
   * the genre Browse screen. Sources without a genre index simply omit it.
   */
  browseByGenre?(genre: string, options?: SearchOptions): Promise<MangaSearchResult[]>;
}
