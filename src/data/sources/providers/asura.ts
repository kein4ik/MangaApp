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

/**
 * Asura Scans (asurascans.com) — EN scanlation aggregator (an Astro site).
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

const getHTML = (path: string, signal?: AbortSignal) =>
  fetchText(`${BASE}${path}`, { headers: HEADERS, signal, label: 'Asura' });

// Page image URLs, and their sizes, which sit next to each url in the page's
// island props as `"url":[0,"…"],"width":[0,720],"height":[0,4000]` (quotes
// HTML-escaped). Knowing the size up front lets the reader lay pages out once.
const PAGE_URL_RE =
  /https:\/\/[^"&\\ ]*asura[^"&\\ ]*\/asura-images\/chapters[a-z-]*\/[^"&\\ ]+\.(?:webp|jpg|jpeg|png)(?:\?v=\d+)?/g;
const PAGE_DIMS_RE =
  /(https:\/\/[^"&\\ ]*asura-images\/chapters[a-z-]*\/[^"&\\ ]+\.(?:webp|jpg|jpeg|png)(?:\?v=\d+)?)(?:&quot;|\\?")\],(?:&quot;|\\?")width(?:&quot;|\\?"):\[0,(\d+)\],(?:&quot;|\\?")height(?:&quot;|\\?"):\[0,(\d+)\]/g;

// Real pages, as opposed to an error page that still says 200. A series page
// links to itself (og:url …/comics/{slug}); a chapter page is an article.
const isSeriesPage = (html: string) => /property="og:url"\s+content="[^"]*\/comics\//.test(html);
const isChapterPage = (html: string) => /property="og:type"\s+content="article"/.test(html);

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
let indexInFlight: Promise<{ slug: string; title: string }[]> | null = null;
const INDEX_TTL = 6 * 60 * 60 * 1000;

async function seriesIndex(): Promise<{ slug: string; title: string }[]> {
  if (indexCache && Date.now() - indexCache.at < INDEX_TTL) return indexCache.series;
  // Shared by every keystroke's search, so it's fetched once and never tied to
  // (or cancelled with) a single search request.
  indexInFlight ??= fetchText(`${BASE}/sitemap-series.xml`, { headers: HEADERS, label: 'Asura sitemap' })
    .then((xml) => {
      const series = [...xml.matchAll(/\/comics\/([a-z0-9-]+)<\/loc>/g)].map((m) => {
        const slug = cleanSlug(m[1]);
        return { slug, title: titleFromSlug(slug) };
      });
      // Never cache an empty index: search would find nothing for six hours.
      if (!series.length) throw new UnexpectedPageError('Asura sitemap');
      indexCache = { at: Date.now(), series };
      return series;
    })
    .finally(() => {
      indexInFlight = null;
    });
  return indexInFlight;
}

export class AsuraProvider implements SourceProvider {
  id = 'asura';
  name = 'Asura Scans';
  languages = ['en'];
  type = 'scraper' as const;
  supportsSearch = true;
  supportsReading = true;

  async trending(options?: SearchOptions): Promise<MangaSearchResult[]> {
    // Browse renders proper cards (title + cover) server-side, ordered by
    // latest update unless asked for popularity.
    const path = options?.sort === 'latest' ? '/browse' : '/browse?sort=popular';
    const cards = parseCards(await getHTML(path, options?.signal), options?.limit ?? 30);
    if (!cards.length) throw new UnexpectedPageError('Asura');
    return cards;
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

  async getMangaDetails(externalId: string, options?: CallOptions): Promise<MangaDetails> {
    const html = await getHTML(`/comics/${externalId}`, options?.signal);
    if (!isSeriesPage(html)) throw new UnexpectedPageError('Asura');
    const title =
      html.match(/property="og:title"\s+content="([^"]+)"/)?.[1] ??
      html.match(/<title>([^<|]+)/)?.[1];
    const coverUrl = html.match(/property="og:image"\s+content="([^"]+)"/)?.[1];
    const description = html.match(/property="og:description"\s+content="([^"]+)"/)?.[1];
    // Genre chips link to the browse filter: /browse?genres=genius-mc.
    const genres = [...html.matchAll(/\/browse\?genres=([a-z0-9-]+)"[^>]*>\s*([^<]+?)\s*</g)].map(
      (m) => m[2].replace(/&amp;/g, '&') || titleFromSlug(m[1]),
    );
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

  async getChapters(externalId: string, _lang?: string, options?: CallOptions): Promise<Chapter[]> {
    const html = await getHTML(`/comics/${externalId}`, options?.signal);
    const nums = [...new Set([...html.matchAll(/\/chapter\/([\d.]+)"/g)].map((m) => m[1]))];
    if (!nums.length && !isSeriesPage(html)) throw new UnexpectedPageError('Asura');
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

  async getChapterPages(chapterId: string, options?: CallOptions): Promise<ChapterPage[]> {
    const sep = chapterId.lastIndexOf(SEP);
    const slug = chapterId.slice(0, sep);
    const num = chapterId.slice(sep + 1);
    const html = await getHTML(`/comics/${slug}/chapter/${num}`, options?.signal);
    const dims = new Map<string, { width: number; height: number }>();
    for (const m of html.matchAll(PAGE_DIMS_RE)) {
      dims.set(m[1], { width: Number(m[2]), height: Number(m[3]) });
    }
    const seen = new Set<string>();
    const pages: ChapterPage[] = [];
    for (const m of html.matchAll(PAGE_URL_RE)) {
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      pages.push({ index: pages.length, imageUrl: m[0], ...dims.get(m[0]) });
    }
    if (!pages.length && !isChapterPage(html)) throw new UnexpectedPageError('Asura');
    return pages;
  }
}
