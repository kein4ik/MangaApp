import { fetchWithTimeout } from '../http';
import type { SourceProvider } from '../SourceProvider';
import type {
  Chapter,
  ChapterPage,
  MangaDetails,
  MangaSearchResult,
  SearchOptions,
} from '../types';

/**
 * Asura Scans (asurascans.com) — EN scanlation aggregator on a Next.js site.
 * Series/chapters/pages are server-rendered, so they scrape cleanly. Text
 * search runs through a JS-only API we can't reach, so instead we pull the
 * site's series sitemap once (cached) and match titles locally. Page images
 * load without a Referer.
 */

const BASE = 'https://asurascans.com';
const SEP = '~';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const HEADERS = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html' };

async function getHTML(path: string): Promise<string> {
  const res = await fetchWithTimeout(`${BASE}${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Asura ${res.status}`);
  return res.text();
}

/** Catalog/home links carry a per-deploy hash suffix; the clean slug is stable. */
const cleanSlug = (slug: string) => slug.replace(/-[0-9a-f]{8}$/i, '');
const titleFromSlug = (slug: string) =>
  slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function parseCards(html: string, limit: number): MangaSearchResult[] {
  // Covers are keyed by the clean slug (covers/{slug}.{hash}.webp), so map them
  // up front and attach by slug.
  const coverMap = new Map<string, string>();
  for (const m of html.matchAll(
    /https:\/\/cdn\.asurascans\.com\/asura-images\/covers\/([a-z0-9-]+)\.[0-9a-f]+(?:-\d+)?\.(?:webp|jpg|jpeg|png)/g,
  )) {
    if (!coverMap.has(m[1])) coverMap.set(m[1], m[0]);
  }

  const out: MangaSearchResult[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(
    /<a[^>]+href="\/comics\/([a-z0-9-]+)"[^>]*>\s*<h3[^>]*>([^<]+)<\/h3>/g,
  )) {
    const slug = cleanSlug(m[1]);
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({
      sourceId: 'asura',
      externalId: slug,
      title: m[2].replace(/&#x27;/g, "'").replace(/&amp;/g, '&').trim(),
      coverUrl: coverMap.get(slug),
      languages: ['en'],
    });
    if (out.length >= limit) break;
  }
  return out;
}

// Series index from the sitemap, cached so search doesn't refetch every keystroke.
let indexCache: { at: number; series: { slug: string; title: string }[] } | null = null;
const INDEX_TTL = 6 * 60 * 60 * 1000;

async function seriesIndex(): Promise<{ slug: string; title: string }[]> {
  if (indexCache && Date.now() - indexCache.at < INDEX_TTL) return indexCache.series;
  const res = await fetchWithTimeout(`${BASE}/sitemap-series.xml`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Asura sitemap ${res.status}`);
  const xml = await res.text();
  const series = [...xml.matchAll(/\/comics\/([a-z0-9-]+)<\/loc>/g)].map((m) => {
    const slug = cleanSlug(m[1]);
    return { slug, title: titleFromSlug(slug) };
  });
  indexCache = { at: Date.now(), series };
  return series;
}

export class AsuraProvider implements SourceProvider {
  id = 'asura';
  name = 'Asura Scans';
  languages = ['en'];
  type = 'scraper' as const;
  supportsSearch = true;
  supportsReading = true;

  async trending(options?: SearchOptions): Promise<MangaSearchResult[]> {
    // The catalog renders proper cards (title + cover) server-side; the ranking
    // page is a JS-only list, so we use the catalog for both sorts.
    return parseCards(await getHTML('/comics?page=1'), options?.limit ?? 30);
  }

  async search(query: string, options?: SearchOptions): Promise<MangaSearchResult[]> {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const series = await seriesIndex();
    return series
      .filter((s) => terms.every((t) => s.slug.includes(t)))
      .slice(0, options?.limit ?? 30)
      .map((s) => ({ sourceId: 'asura', externalId: s.slug, title: s.title, languages: ['en'] }));
  }

  async getMangaDetails(externalId: string): Promise<MangaDetails> {
    const html = await getHTML(`/comics/${externalId}`);
    const title =
      html.match(/property="og:title"\s+content="([^"]+)"/)?.[1] ??
      html.match(/<title>([^<|]+)/)?.[1];
    const coverUrl = html.match(/property="og:image"\s+content="([^"]+)"/)?.[1];
    const description = html.match(/property="og:description"\s+content="([^"]+)"/)?.[1];
    const genres = [...html.matchAll(/\/genres\/([a-z0-9-]+)/g)].map((m) => titleFromSlug(m[1]));
    return {
      sourceId: 'asura',
      externalId,
      title: title?.replace(/\s*\|\s*Asura Scans\s*$/i, '').trim() || titleFromSlug(externalId),
      coverUrl,
      description: description?.trim(),
      genres: genres.length ? [...new Set(genres)].slice(0, 12) : undefined,
      languages: ['en'],
    };
  }

  async getChapters(externalId: string): Promise<Chapter[]> {
    const html = await getHTML(`/comics/${externalId}`);
    const nums = [...new Set([...html.matchAll(/\/chapter\/([\d.]+)"/g)].map((m) => m[1]))];
    return nums
      .map((n) => ({
        sourceId: 'asura',
        externalId: [externalId, n].join(SEP),
        mangaExternalId: externalId,
        chapterNumber: n,
        language: 'en',
      }))
      .sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber));
  }

  async getChapterPages(chapterId: string): Promise<ChapterPage[]> {
    const sep = chapterId.lastIndexOf(SEP);
    const slug = chapterId.slice(0, sep);
    const num = chapterId.slice(sep + 1);
    const html = await getHTML(`/comics/${slug}/chapter/${num}`);
    const seen = new Set<string>();
    const pages: ChapterPage[] = [];
    for (const m of html.matchAll(
      /https:\/\/[^"&\\ ]*asura[^"&\\ ]*\/asura-images\/chapters[a-z-]*\/[^"&\\ ]+\.(?:webp|jpg|jpeg|png)(?:\?v=\d+)?/g,
    )) {
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      pages.push({ index: pages.length, imageUrl: m[0] });
    }
    return pages;
  }
}
