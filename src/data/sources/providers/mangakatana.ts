import { fetchWithTimeout } from '../http';
import type { SourceProvider } from '../SourceProvider';
import type {
  Chapter,
  ChapterPage,
  MangaDetails,
  MangaSearchResult,
  MangaStatus,
  SearchOptions,
} from '../types';

/**
 * MangaKatana (mangakatana.com) — EN aggregator, plain server-rendered HTML and
 * no Cloudflare. The whole chapter list is on the title page (one request), and
 * reader pages embed image URLs in a `var thzq = [...]` array. Page image URLs
 * are tokenized/expiring, so they're fetched fresh per chapter (our `pages`
 * query isn't persisted).
 */

const BASE = 'https://mangakatana.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const HEADERS = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html' };

async function getHTML(path: string): Promise<string> {
  const res = await fetchWithTimeout(`${BASE}${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`MangaKatana ${res.status}`);
  return res.text();
}

const decode = (s: string) =>
  s.replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();

function mapStatus(s?: string): MangaStatus {
  const t = (s ?? '').toLowerCase();
  if (t.includes('ongoing')) return 'ongoing';
  if (t.includes('completed')) return 'completed';
  return 'unknown';
}

function parseCards(html: string, limit: number): MangaSearchResult[] {
  // The card's cover <img> has alt="[Cover]"; the real title is in the
  // <h3 class="title"> anchor. Map covers by slug, then read titles.
  const covers = new Map<string, string>();
  for (const m of html.matchAll(
    /href="https:\/\/mangakatana\.com\/manga\/([a-z0-9.-]+)">\s*<picture><source srcset="([^"]+)"/g,
  )) {
    if (!covers.has(m[1])) covers.set(m[1], m[2]);
  }

  const out: MangaSearchResult[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(
    /<h3 class="title">\s*<a href="https:\/\/mangakatana\.com\/manga\/([a-z0-9.-]+)"[^>]*>([^<]+)<\/a>/g,
  )) {
    const slug = m[1];
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({
      sourceId: 'mangakatana',
      externalId: slug,
      title: decode(m[2]) || slug,
      coverUrl: covers.get(slug),
      languages: ['en'],
    });
    if (out.length >= limit) break;
  }
  return out;
}

export class MangaKatanaProvider implements SourceProvider {
  id = 'mangakatana';
  name = 'MangaKatana';
  languages = ['en'];
  type = 'scraper' as const;
  supportsSearch = true;
  supportsReading = true;

  async trending(options?: SearchOptions): Promise<MangaSearchResult[]> {
    // Catalog ordered by latest update (no real popularity sort on the site).
    return parseCards(await getHTML('/manga/page/1?filter=1&order=latest'), options?.limit ?? 30);
  }

  async search(query: string, options?: SearchOptions): Promise<MangaSearchResult[]> {
    const html = await getHTML(`/?search=${encodeURIComponent(query)}&search_by=book_name`);
    return parseCards(html, options?.limit ?? 30);
  }

  async getMangaDetails(externalId: string): Promise<MangaDetails> {
    const html = await getHTML(`/manga/${externalId}`);
    const title =
      html.match(/<h1[^>]*class="heading"[^>]*>([^<]+)/)?.[1] ?? html.match(/<h1[^>]*>([^<]+)/)?.[1];
    const coverUrl =
      html.match(/property="og:image"\s+content="([^"]+)"/)?.[1] ??
      html.match(/class="wrap_img">\s*<img[^>]+src="([^"]+)"/)?.[1];
    const description = html.match(/class="summary"[\s\S]{0,120}?<p>([\s\S]*?)<\/p>/)?.[1];
    const authors = [...new Set([...html.matchAll(/\/author\/[^"]*"[^>]*>([^<]+)</gi)].map((m) => decode(m[1])))];
    const genres = [...new Set([...html.matchAll(/\/genre\/[^"]*"[^>]*>([^<]+)</gi)].map((m) => decode(m[1])))];
    const status = html.match(/class="[^"]*\bstatus\s+(ongoing|completed)\b/i)?.[1];
    return {
      sourceId: 'mangakatana',
      externalId,
      title: title ? decode(title) : externalId,
      coverUrl,
      description: description ? decode(description.replace(/<[^>]+>/g, ' ')) : undefined,
      authors: authors.length ? authors : undefined,
      genres: genres.length ? genres.slice(0, 12) : undefined,
      status: mapStatus(status),
      languages: ['en'],
    };
  }

  async getChapters(externalId: string): Promise<Chapter[]> {
    const html = await getHTML(`/manga/${externalId}`);
    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    for (const m of html.matchAll(
      /<div class="chapter"><a href="https:\/\/mangakatana\.com\/manga\/([a-z0-9.-]+\/c([\d.]+))"[^>]*>([^<]+)<\/a>/g,
    )) {
      const chapterId = m[1];
      if (seen.has(chapterId)) continue;
      seen.add(chapterId);
      chapters.push({
        sourceId: 'mangakatana',
        externalId: chapterId,
        mangaExternalId: externalId,
        chapterNumber: m[2],
        title: decode(m[3]),
        language: 'en',
      });
    }
    return chapters.sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber));
  }

  async getChapterPages(chapterId: string): Promise<ChapterPage[]> {
    const html = await getHTML(`/manga/${chapterId}`);
    // Reader embeds the page URLs in `var thzq = ['url', 'url', ...];`.
    const arr = html.match(/var\s+thzq\s*=\s*\[([\s\S]*?)\]/);
    const urls = arr ? [...arr[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
    return urls
      .filter((u) => /^https?:\/\//.test(u))
      .map((u, index) => ({ index, imageUrl: u, headers: { Referer: `${BASE}/`, 'User-Agent': UA } }));
  }
}
