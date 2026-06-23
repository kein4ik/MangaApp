import * as cheerio from 'cheerio';

import type { SourceProvider } from './SourceProvider.js';
import type {
  Chapter,
  ChapterPage,
  MangaDetails,
  MangaSearchResult,
  SearchOptions,
} from '../types.js';

/**
 * Mangabuff (mangabuff.ru) — popular RU source. Mostly server-rendered HTML
 * (cheerio), with a JSON search endpoint. Unlike Grouple/ReadManga it serves
 * FULL-resolution page images (no `_res` downscale), so quality is good.
 *  - search:   GET /search/suggestions?q=  → JSON
 *  - catalog:  GET /manga/top | /manga      → `a.cards__item`
 *  - chapters: GET /manga/{slug}            → `.chapters__item` (vol + number)
 *  - pages:    GET /manga/{slug}/{vol}/{ch} → `.reader img[data-src]`
 * Page images (c3.mangabuff.ru) and covers load without special headers.
 */

const BASE = 'https://mangabuff.ru';
const CHID_SEP = '~';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
  Referer: `${BASE}/`,
};

async function getHTML(path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`, { headers: { ...HEADERS, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`Mangabuff ${res.status} on ${path}`);
  return res.text();
}

const coverFor = (slug: string) => `${BASE}/img/manga/posters/${slug}.jpg`;

function parseCards(html: string, limit: number): MangaSearchResult[] {
  const $ = cheerio.load(html);
  const out: MangaSearchResult[] = [];
  $('a.cards__item').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const slug = href.match(/\/manga\/([a-z0-9-]+)/i)?.[1];
    if (!slug) return;
    const title = $(el).find('.cards__name').text().trim() || slug;
    out.push({
      sourceId: 'mangabuff',
      externalId: slug,
      title,
      coverUrl: coverFor(slug),
      languages: ['ru'],
    });
  });
  return out.slice(0, limit);
}

type SearchHit = { name: string; slug: string; rating?: string };

export class MangabuffProvider implements SourceProvider {
  id = 'mangabuff';
  name = 'Mangabuff';
  languages = ['ru'];
  type = 'scraper' as const;
  supportsSearch = true;
  supportsReading = true;

  async trending(options?: SearchOptions): Promise<MangaSearchResult[]> {
    const path = options?.sort === 'latest' ? '/manga' : '/manga/top';
    return parseCards(await getHTML(path), options?.limit ?? 30);
  }

  async search(query: string, options?: SearchOptions): Promise<MangaSearchResult[]> {
    const res = await fetch(`${BASE}/search/suggestions?q=${encodeURIComponent(query)}`, {
      headers: { ...HEADERS, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!res.ok) throw new Error(`Mangabuff search ${res.status}`);
    const hits = (await res.json()) as SearchHit[];
    return hits.slice(0, options?.limit ?? 30).map((h) => ({
      sourceId: 'mangabuff',
      externalId: h.slug,
      title: h.name,
      coverUrl: coverFor(h.slug),
      languages: ['ru'],
    }));
  }

  async getMangaDetails(externalId: string): Promise<MangaDetails> {
    const $ = cheerio.load(await getHTML(`/manga/${externalId}`));
    const title = $('h1').first().text().trim();
    const description =
      $('meta[name="description"]').attr('content') ||
      $('.manga__description, .text-expand').first().text().trim();
    const genres: string[] = [];
    $('a[href*="/genres/"], .tags__item').each((_, el) => {
      const t = $(el).text().trim();
      if (t) genres.push(t);
    });
    return {
      sourceId: 'mangabuff',
      externalId,
      title: title || externalId,
      coverUrl: coverFor(externalId),
      description: description?.trim(),
      genres: genres.length ? [...new Set(genres)].slice(0, 12) : undefined,
      languages: ['ru'],
    };
  }

  async getChapters(externalId: string): Promise<Chapter[]> {
    const $ = cheerio.load(await getHTML(`/manga/${externalId}`));
    const chapters: Chapter[] = [];
    $('.chapters__item').each((_, el) => {
      const number = $(el).attr('data-chapter') || $(el).find('.chapters__value span').text().trim();
      const volume = $(el).find('.chapters__volume span').text().trim() || '1';
      if (!number) return;
      chapters.push({
        sourceId: 'mangabuff',
        externalId: [externalId, volume, number].join(CHID_SEP),
        mangaExternalId: externalId,
        chapterNumber: number,
        volume,
        language: 'ru',
      });
    });
    // Newest-first on the page; present oldest-first.
    return chapters.sort((a, b) => {
      const va = Number(a.volume) - Number(b.volume);
      return va || Number(a.chapterNumber) - Number(b.chapterNumber);
    });
  }

  async getChapterPages(chapterId: string): Promise<ChapterPage[]> {
    const [slug, vol, num] = chapterId.split(CHID_SEP);
    const $ = cheerio.load(await getHTML(`/manga/${slug}/${vol}/${num}`));
    const pages: ChapterPage[] = [];
    $('.reader img').each((_, el) => {
      const url = $(el).attr('data-src') || $(el).attr('src');
      if (url && /mangabuff\.ru\/chapters\//.test(url)) {
        pages.push({ index: pages.length, imageUrl: url });
      }
    });
    return pages;
  }
}
