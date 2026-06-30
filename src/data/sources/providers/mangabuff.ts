import { fetchWithTimeout } from '../http';
import type { SourceProvider } from '../SourceProvider';
import type {
  Chapter,
  ChapterPage,
  MangaDetails,
  MangaSearchResult,
  SearchOptions,
} from '../types';

const BASE = 'https://mangabuff.ru';
const CHID_SEP = '~';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const HEADERS = { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8', Referer: `${BASE}/` };

async function getHTML(path: string): Promise<string> {
  const res = await fetchWithTimeout(`${BASE}${path}`, { headers: { ...HEADERS, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`Mangabuff ${res.status}`);
  return res.text();
}

const coverFor = (slug: string) => `${BASE}/img/manga/posters/${slug}.jpg`;

/** Absolutize a parsed cover path and prefer the full-res poster over the x180 thumb. */
function absCover(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const abs = url.startsWith('http') ? url : `${BASE}${url.startsWith('/') ? '' : '/'}${url}`;
  return abs.replace('/x180/img/', '/img/');
}

/**
 * Trading-card entries ("Карточки по …", slug `karti-*`) get listed alongside
 * manga on /manga/top but 404 as manga pages — drop them so they don't surface
 * as broken covers or dead links.
 */
const isNonManga = (slug: string, title: string) =>
  slug.startsWith('karti-') || /^карточки\b/i.test(title);

function parseCards(html: string, limit: number): MangaSearchResult[] {
  const out: MangaSearchResult[] = [];
  for (const m of html.matchAll(
    /<a[^>]+href="https:\/\/mangabuff\.ru\/manga\/([a-z0-9-]+)"[^>]+class="cards__item"[^>]*>([\s\S]*?)<\/a>/g,
  )) {
    const slug = m[1];
    const block = m[2];
    const title = block.match(/cards__name[^>]*>([^<]+)/)?.[1]?.trim() || slug;
    if (isNonManga(slug, title)) continue;
    // Read the real poster from the card; fall back to the slug-based guess.
    const coverUrl =
      absCover(block.match(/background-image:\s*url\(['"]?([^'")]+)/)?.[1]) ?? coverFor(slug);
    out.push({ sourceId: 'mangabuff', externalId: slug, title, coverUrl, languages: ['ru'] });
  }
  return out.slice(0, limit);
}

type SearchHit = { name: string; slug: string };

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
    const res = await fetchWithTimeout(`${BASE}/search/suggestions?q=${encodeURIComponent(query)}`, {
      headers: { ...HEADERS, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!res.ok) throw new Error(`Mangabuff search ${res.status}`);
    const hits = (await res.json()) as SearchHit[];
    return hits
      .filter((h) => !isNonManga(h.slug, h.name))
      .slice(0, options?.limit ?? 30)
      .map((h) => ({
        sourceId: 'mangabuff',
        externalId: h.slug,
        title: h.name,
        coverUrl: coverFor(h.slug),
        languages: ['ru'],
      }));
  }

  async getMangaDetails(externalId: string): Promise<MangaDetails> {
    const html = await getHTML(`/manga/${externalId}`);
    const title = html.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1]?.trim();
    const description = html.match(/<meta name="description" content="([^"]+)"/)?.[1];
    const genres: string[] = [];
    for (const m of html.matchAll(/<a[^>]+href="[^"]*\/genres\/[^"]*"[^>]*>([^<]+)<\/a>/g)) {
      const t = m[1].trim();
      if (t) genres.push(t);
    }
    // Prefer the real poster declared on the page over the slug-based guess.
    const coverUrl =
      absCover(
        html.match(/property="og:image"\s+content="([^"]+)"/)?.[1] ??
          html.match(/class="manga__img"[\s\S]{0,160}?<img[^>]+src="([^"]+)"/)?.[1],
      ) ?? coverFor(externalId);
    return {
      sourceId: 'mangabuff',
      externalId,
      title: title || externalId,
      coverUrl,
      description: description?.trim(),
      genres: genres.length ? [...new Set(genres)].slice(0, 12) : undefined,
      languages: ['ru'],
    };
  }

  async getChapters(externalId: string): Promise<Chapter[]> {
    const html = await getHTML(`/manga/${externalId}`);
    const chapters: Chapter[] = [];
    for (const m of html.matchAll(
      /class="chapters__item"[^>]*data-chapter="([\d.]+)"[^>]*>\s*<div class="chapters__volume">[^<]*<span>(\d+)<\/span>/g,
    )) {
      chapters.push({
        sourceId: 'mangabuff',
        externalId: [externalId, m[2], m[1]].join(CHID_SEP),
        mangaExternalId: externalId,
        chapterNumber: m[1],
        volume: m[2],
        language: 'ru',
      });
    }
    return chapters.sort((a, b) => {
      const va = Number(a.volume) - Number(b.volume);
      return va || Number(a.chapterNumber) - Number(b.chapterNumber);
    });
  }

  async getChapterPages(chapterId: string): Promise<ChapterPage[]> {
    const [slug, vol, num] = chapterId.split(CHID_SEP);
    const html = await getHTML(`/manga/${slug}/${vol}/${num}`);
    const seen = new Set<string>();
    const pages: ChapterPage[] = [];
    for (const m of html.matchAll(
      /(?:data-src|src)="(https?:\/\/[^"]*mangabuff\.ru\/chapters\/[^"]+)"/g,
    )) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      pages.push({ index: pages.length, imageUrl: m[1] });
    }
    return pages;
  }
}
