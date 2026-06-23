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
 * Mangapill (mangapill.com) — EN source. No JSON API, so we scrape the HTML
 * with cheerio. `scraper` type: markup can change, which is what
 * SourceHealthService is for. Manga are addressed by numeric id (the URL slug
 * is ignored by the site), chapters by their id like "3-10162000". Page images
 * live on a CDN that needs `Referer: https://mangapill.com/` (403 without).
 */

const BASE = 'https://mangapill.com';
const REFERER = `${BASE}/`;
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  Accept: 'text/html',
};

async function getHTML(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Mangapill ${res.status} on ${url}`);
  return res.text();
}

/**
 * Pull {id, title, cover} cards out of any page that lists /manga/ links.
 * Titles come from the /manga/ anchors; covers are matched separately because
 * a cover image filename always encodes the manga id (".../i/{id}.jpeg"), which
 * holds even on the homepage where the cover isn't inside the title link.
 */
function parseList(html: string): MangaSearchResult[] {
  const $ = cheerio.load(html);
  const titles = new Map<string, string>();
  $('a[href^="/manga/"]').each((_, el) => {
    const m = ($(el).attr('href') ?? '').match(/^\/manga\/(\d+)\//);
    const text = $(el).text().trim();
    if (m && text && !titles.has(m[1])) titles.set(m[1], text);
  });
  const covers = new Map<string, string>();
  $('img').each((_, el) => {
    const src = $(el).attr('data-src') || $(el).attr('src') || '';
    const m = src.match(/\/i\/(\d+)\./);
    if (m && !covers.has(m[1])) covers.set(m[1], src);
  });
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
    // The homepage lists popular / recently added titles.
    const html = await getHTML(`${BASE}/`);
    return parseList(html).slice(0, options?.limit ?? 30);
  }

  async search(query: string, options?: SearchOptions): Promise<MangaSearchResult[]> {
    const html = await getHTML(`${BASE}/search?q=${encodeURIComponent(query)}`);
    return parseList(html).slice(0, options?.limit ?? 30);
  }

  async getMangaDetails(externalId: string): Promise<MangaDetails> {
    const html = await getHTML(`${BASE}/manga/${externalId}/_`);
    const $ = cheerio.load(html);
    const title = $('h1').first().text().trim();
    const cover =
      $('meta[property="og:image"]').attr('content') || $('img[data-src]').first().attr('data-src');
    const description =
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content');
    const genres: string[] = [];
    $('a[href*="genre"]').each((_, el) => {
      const t = $(el).text().trim();
      if (t) genres.push(t);
    });
    return {
      sourceId: 'mangapill',
      externalId,
      title,
      coverUrl: cover,
      description: description?.trim(),
      genres: genres.length ? genres : undefined,
      languages: ['en'],
    };
  }

  async getChapters(externalId: string): Promise<Chapter[]> {
    const html = await getHTML(`${BASE}/manga/${externalId}/_`);
    const $ = cheerio.load(html);
    const chapters: Chapter[] = [];
    $('a[href^="/chapters/"]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      const m = href.match(/^\/chapters\/([^/]+)/);
      if (!m) return;
      const label = $(el).text().trim();
      // Labels look like "Chapter 382" or "Group 2 Chapter 383" — take the
      // number after "Chapter", not the group number.
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
    });
    // Page lists newest-first; present oldest-first like the other sources.
    return chapters.reverse();
  }

  async getChapterPages(chapterId: string): Promise<ChapterPage[]> {
    const html = await getHTML(`${BASE}/chapters/${chapterId}/_`);
    const $ = cheerio.load(html);
    const pages: ChapterPage[] = [];
    $('img.js-page').each((i, el) => {
      const url = $(el).attr('data-src');
      if (!url) return;
      pages.push({
        index: i,
        imageUrl: url,
        width: Number($(el).attr('width')) || undefined,
        height: Number($(el).attr('height')) || undefined,
        // The CDN checks both Referer and a browser-like User-Agent.
        headers: { Referer: REFERER, 'User-Agent': HEADERS['User-Agent'] },
      });
    });
    return pages;
  }
}
