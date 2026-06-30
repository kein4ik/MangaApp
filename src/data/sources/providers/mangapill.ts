import { fetchWithTimeout } from '../http';
import type { SourceProvider } from '../SourceProvider';
import type {
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

async function getHTML(path: string): Promise<string> {
  const res = await fetchWithTimeout(`${BASE}${path}`, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`Mangapill ${res.status}`);
  return res.text();
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').trim();

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
    return parseList(await getHTML('/')).slice(0, options?.limit ?? 30);
  }

  async search(query: string, options?: SearchOptions): Promise<MangaSearchResult[]> {
    const html = await getHTML(`/search?q=${encodeURIComponent(query)}`);
    return parseList(html).slice(0, options?.limit ?? 30);
  }

  async getMangaDetails(externalId: string): Promise<MangaDetails> {
    const html = await getHTML(`/manga/${externalId}/_`);
    const title = html.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1]?.trim();
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

  async getChapters(externalId: string): Promise<Chapter[]> {
    const html = await getHTML(`/manga/${externalId}/_`);
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
    return chapters.reverse();
  }

  async getChapterPages(chapterId: string): Promise<ChapterPage[]> {
    const html = await getHTML(`/chapters/${chapterId}/_`);
    const pages: ChapterPage[] = [];
    for (const m of html.matchAll(/<img[^>]+class="js-page"[^>]+data-src="([^"]+)"[^>]*>/g)) {
      pages.push({
        index: pages.length,
        imageUrl: m[1],
        headers: { Referer: REFERER, 'User-Agent': UA },
      });
    }
    return pages;
  }
}
