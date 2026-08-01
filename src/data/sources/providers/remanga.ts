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

const API = 'https://api.remanga.org/api';
const MEDIA = 'https://api.remanga.org';
const REFERER = 'https://remanga.org/';

const HEADERS = {
  Accept: 'application/json',
  Referer: REFERER,
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
};

type RmImg = { low?: string; mid?: string; high?: string };
type RmTitle = {
  id: number;
  dir: string;
  en_name?: string;
  rus_name?: string;
  main_name?: string;
  secondary_name?: string;
  img?: RmImg;
  issue_year?: number;
  description?: string;
  status?: { id?: number };
  genres?: { name: string }[];
  branches?: { id: number; total_chapters?: number | null }[];
  publishers?: { name: string }[];
  /** Flagged titles are login-walled on Remanga (chapters hidden anonymously). */
  is_erotic?: boolean;
  is_yaoi?: boolean;
};
type RmChapter = { id: number; chapter?: string; tome?: number; name?: string; is_paid?: boolean };
type RmPage = { link: string; height?: number; width?: number };

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetchWithTimeout(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Remanga ${res.status}`);
  return (await res.json()) as T;
}

function mapStatus(id?: number): MangaStatus {
  switch (id) {
    case 1:
      return 'ongoing';
    case 2:
      return 'completed';
    case 3:
      return 'hiatus';
    default:
      return 'unknown';
  }
}

function cover(img?: RmImg): string | undefined {
  const rel = img?.high || img?.mid || img?.low;
  return rel ? `${MEDIA}${rel}` : undefined;
}

function toResult(t: RmTitle): MangaSearchResult {
  return {
    sourceId: 'remanga',
    externalId: t.dir,
    title: t.rus_name || t.en_name || t.main_name || 'Без названия',
    altTitles: [t.en_name, t.secondary_name].filter((x): x is string => Boolean(x)),
    coverUrl: cover(t.img),
    status: mapStatus(t.status?.id),
    languages: ['ru'],
  };
}

// Genre name (lowercased) → id, from the forms reference endpoint, cached 24h.
// Remanga's naming differs from MangaLib's for a couple of genres, so common
// aliases are registered too (Боевик→Экшен, Школа→Школьники) — the browse layer
// hands us MangaLib-style canonical names.
const GENRE_ALIASES: [alias: string, canonical: string][] = [
  ['боевик', 'экшен'],
  ['школа', 'школьники'],
];
let genreMapCache: { map: Map<string, number>; at: number } | null = null;
async function genreMap(): Promise<Map<string, number>> {
  if (genreMapCache && Date.now() - genreMapCache.at < 24 * 60 * 60 * 1000) {
    return genreMapCache.map;
  }
  const map = new Map<string, number>();
  try {
    const data = await getJSON<{ content: { genres: { id: number; name: string }[] } }>(
      `${API}/forms/titles/?get=genres`,
    );
    for (const g of data.content.genres) {
      if (g.name) map.set(g.name.toLowerCase(), g.id);
    }
    for (const [alias, canonical] of GENRE_ALIASES) {
      const id = map.get(canonical);
      if (id != null && !map.has(alias)) map.set(alias, id);
    }
    genreMapCache = { map, at: Date.now() };
  } catch {
    // Empty map → browseByGenre returns nothing.
  }
  return map;
}

export class RemangaProvider implements SourceProvider {
  id = 'remanga';
  name = 'Remanga';
  languages = ['ru'];
  type = 'scraper' as const;
  supportsSearch = true;
  supportsReading = true;

  async trending(options?: SearchOptions): Promise<MangaSearchResult[]> {
    const count = Math.min(options?.limit ?? 30, 30);
    const ordering = options?.sort === 'latest' ? '-chapter_date' : '-rating';
    const data = await getJSON<{ content: RmTitle[] }>(
      `${API}/search/catalog/?ordering=${ordering}&count=${count}&page=1`,
    );
    return data.content.map(toResult);
  }

  async search(query: string, options?: SearchOptions): Promise<MangaSearchResult[]> {
    const count = options?.limit ?? 30;
    const data = await getJSON<{ content: RmTitle[] }>(
      `${API}/search/?query=${encodeURIComponent(query)}&count=${count}&page=1`,
    );
    return data.content.map(toResult);
  }

  /** Real genre filter over the catalog (same endpoint trending uses). */
  async browseByGenre(genre: string, options?: SearchOptions): Promise<MangaSearchResult[]> {
    const genres = await genreMap();
    const id = genres.get(genre.trim().toLowerCase());
    if (id == null) return [];
    // Remanga 400s on count > ~30 — same cap as trending.
    const count = Math.min(options?.limit ?? 30, 30);
    const ordering = options?.sort === 'latest' ? '-chapter_date' : '-rating';
    const data = await getJSON<{ content: RmTitle[] }>(
      `${API}/search/catalog/?genres=${id}&ordering=${ordering}&count=${count}&page=1`,
    );
    return data.content.map(toResult);
  }

  private async detail(dir: string): Promise<RmTitle> {
    const data = await getJSON<{ content: RmTitle }>(`${API}/titles/${encodeURIComponent(dir)}/`);
    return data.content;
  }

  async getMangaDetails(externalId: string): Promise<MangaDetails> {
    const t = await this.detail(externalId);
    const authors = Array.isArray(t.publishers)
      ? t.publishers.map((p) => p.name).filter(Boolean)
      : undefined;
    return {
      ...toResult(t),
      description: t.description?.trim(),
      authors,
      genres: t.genres?.map((g) => g.name).filter(Boolean),
      year: t.issue_year,
      contentRating: t.is_erotic || t.is_yaoi ? '18+' : undefined,
    };
  }

  async getChapters(externalId: string): Promise<Chapter[]> {
    const t = await this.detail(externalId);
    const branches = t.branches ?? [];
    if (branches.length === 0) return [];
    const branch = branches.reduce((a, b) =>
      (b.total_chapters ?? 0) > (a.total_chapters ?? 0) ? b : a,
    );
    const all: Chapter[] = [];
    for (let page = 1; page <= 12; page++) {
      const data = await getJSON<{ content: RmChapter[] }>(
        `${API}/titles/chapters/?branch_id=${branch.id}&count=100&ordering=index&page=${page}`,
      );
      const chunk = data.content ?? [];
      if (chunk.length === 0) break;
      for (const ch of chunk) {
        if (ch.is_paid) continue;
        all.push({
          sourceId: 'remanga',
          externalId: String(ch.id),
          mangaExternalId: externalId,
          title: ch.name || undefined,
          chapterNumber: ch.chapter,
          volume: ch.tome != null ? String(ch.tome) : undefined,
          language: 'ru',
        });
      }
      if (chunk.length < 100) break;
    }
    return all.sort((a, b) => {
      const va = Number(a.volume ?? 0) - Number(b.volume ?? 0);
      if (va) return va;
      return Number(a.chapterNumber ?? 0) - Number(b.chapterNumber ?? 0);
    });
  }

  async getChapterPages(chapterId: string): Promise<ChapterPage[]> {
    const data = await getJSON<{ content: { pages?: (RmPage | RmPage[])[] } }>(
      `${API}/titles/chapters/${chapterId}/`,
    );
    const raw = data.content.pages ?? [];
    const flat: RmPage[] = [];
    for (const p of raw) {
      if (Array.isArray(p)) flat.push(...p);
      else flat.push(p);
    }
    return flat
      .filter((pg) => pg?.link)
      .map((pg, index) => ({
        index,
        imageUrl: pg.link,
        width: pg.width,
        height: pg.height,
        headers: { Referer: REFERER },
      }));
  }
}
