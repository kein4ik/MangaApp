import { fetchText, UnexpectedPageError } from '../http';
import type { SourceProvider } from '../SourceProvider';
import type {
  CallOptions,
  Chapter,
  ChapterPage,
  MangaDetails,
  MangaSearchResult,
  SearchOptions,
} from '../types';

const BASE = 'https://mangapill.com';
const REFERER = `${BASE}/`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const getHTML = (path: string, signal?: AbortSignal) =>
  fetchText(`${BASE}${path}`, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    signal,
    label: 'Mangapill',
  });

/** Numeric attribute of an HTML tag (e.g. the page images' width/height). */
const attrNum = (tag: string, name: string) => {
  const n = Number(tag.match(new RegExp(`\\s${name}="([\\d.]+)"`))?.[1]);
  return n > 0 ? n : undefined;
};

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').trim();

/** Every real Mangapill page names the site in og:title; error pages don't. */
const isMangapillPage = (html: string) => /property="og:title"\s+content="[^"]*Mangapill/.test(html);

/** An empty parse is only "nothing found" when it came from a real page. */
function checked<T>(items: T[], html: string): T[] {
  if (!items.length && !isMangapillPage(html)) throw new UnexpectedPageError('Mangapill');
  return items;
}

/** Titles from /manga/{id} anchors; covers matched by id in the filename /i/{id}. */
function parseList(html: string): MangaSearchResult[] {
  const titles = new Map<string, string>();
  for (const m of html.matchAll(/<a[^>]+href="\/manga\/(\d+)\/[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
    const id = m[1];
    const text = stripTags(m[2]);
    if (text && !titles.has(id)) titles.set(id, text);
  }
  const covers = new Map<string, string>();
  for (const m of html.matchAll(/(?:data-src|src)="(https?:\/\/[^"]+\/i\/(\d+)\.[^"]+)"/g)) {
    if (!covers.has(m[2])) covers.set(m[2], m[1]);
  }
  return [...titles.entries()].map(([id, title]) => ({
    sourceId: 'mangapill',
    externalId: id,
    title,
    coverUrl: covers.get(id),
    languages: ['en'],
  }));
}

export class MangapillProvider implements SourceProvider {
  id = 'mangapill';
  name = 'Mangapill';
  languages = ['en'];
  type = 'scraper' as const;
  supportsSearch = true;
  supportsReading = true;

  async trending(options?: SearchOptions): Promise<MangaSearchResult[]> {
    const list = parseList(await getHTML('/', options?.signal));
    if (!list.length) throw new UnexpectedPageError('Mangapill');
    return list.slice(0, options?.limit ?? 30);
  }

  async search(query: string, options?: SearchOptions): Promise<MangaSearchResult[]> {
    const html = await getHTML(`/search?q=${encodeURIComponent(query)}`, options?.signal);
    return checked(parseList(html), html).slice(0, options?.limit ?? 30);
  }

  /** Real genre filter — the site's own genre links are `/search?genre=Name`. */
  async browseByGenre(genre: string, options?: SearchOptions): Promise<MangaSearchResult[]> {
    const html = await getHTML(
      `/search?genre=${encodeURIComponent(genre.trim())}&page=1`,
      options?.signal,
    );
    return checked(parseList(html), html).slice(0, options?.limit ?? 30);
  }

  async getMangaDetails(externalId: string, options?: CallOptions): Promise<MangaDetails> {
    const html = await getHTML(`/manga/${externalId}/_`, options?.signal);
    const title = html.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1]?.trim();
    if (!title || !isMangapillPage(html)) throw new UnexpectedPageError('Mangapill');
    const cover =
      html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ||
      html.match(/<img[^>]+data-src="([^"]+)"/)?.[1];
    const description =
      html.match(/<meta name="description" content="([^"]+)"/)?.[1] ||
      html.match(/<meta property="og:description" content="([^"]+)"/)?.[1];
    const genres: string[] = [];
    for (const m of html.matchAll(/<a[^>]+href="[^"]*genre[^"]*"[^>]*>([^<]+)<\/a>/g)) {
      const t = m[1].trim();
      if (t) genres.push(t);
    }
    return {
      sourceId: 'mangapill',
      externalId,
      title: title || externalId,
      coverUrl: cover,
      description: description?.trim(),
      genres: genres.length ? genres : undefined,
      languages: ['en'],
    };
  }

  async getChapters(externalId: string, _lang?: string, options?: CallOptions): Promise<Chapter[]> {
    const html = await getHTML(`/manga/${externalId}/_`, options?.signal);
    const chapters: Chapter[] = [];
    for (const m of html.matchAll(/<a[^>]+href="\/chapters\/([^/"]+)[^"]*"[^>]*>([^<]+)<\/a>/g)) {
      const label = m[2].trim();
      const num = label.match(/chapter\s*([\d.]+)/i)?.[1] ?? label.match(/([\d.]+)/)?.[1];
      const group = label.match(/group\s*\d+/i)?.[0];
      chapters.push({
        sourceId: 'mangapill',
        externalId: m[1],
        mangaExternalId: externalId,
        title: label || undefined,
        chapterNumber: num,
        scanlationGroup: group,
        language: 'en',
      });
    }
    return checked(chapters, html).reverse();
  }

  async getChapterPages(chapterId: string, options?: CallOptions): Promise<ChapterPage[]> {
    const html = await getHTML(`/chapters/${chapterId}/_`, options?.signal);
    const pages: ChapterPage[] = [];
    // Each page tag carries its real size (width="1066" height="1600").
    for (const m of html.matchAll(/<img[^>]+class="js-page"[^>]*>/g)) {
      const tag = m[0];
      const url = tag.match(/data-src="([^"]+)"/)?.[1];
      if (!url) continue;
      pages.push({
        index: pages.length,
        imageUrl: url,
        width: attrNum(tag, 'width'),
        height: attrNum(tag, 'height'),
        headers: { Referer: REFERER, 'User-Agent': UA },
      });
    }
    return checked(pages, html);
  }
}
