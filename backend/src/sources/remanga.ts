import type { SourceProvider } from './SourceProvider.js';
import type {
  Chapter,
  ChapterPage,
  MangaDetails,
  MangaSearchResult,
  MangaStatus,
  SearchOptions,
} from '../types.js';

/**
 * Remanga (remanga.org) — popular RU source with a JSON API at api.remanga.org.
 * Like MangaLib it's an unofficial API (`scraper` type). Manga are addressed by
 * `dir` (slug); chapters have their own numeric ids so pages are a clean
 * `/chapters/{id}/` call. Covers live on api.remanga.org and page images on
 * img.reimg2.org — BOTH require `Referer: https://remanga.org/` (403 without).
 */

const API = 'https://api.remanga.org/api';
const MEDIA = 'https://api.remanga.org'; // covers are relative /media/... paths
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
  status?: { id?: number; name?: string };
  genres?: { name: string }[];
  branches?: { id: number; total_chapters?: number | null }[];
  publishers?: { name: string }[];
};
type RmChapter = {
  id: number;
  chapter?: string;
  tome?: number;
  name?: string;
  is_paid?: boolean;
};
type RmPage = { link: string; height?: number; width?: number };

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Remanga ${res.status} on ${url}`);
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

function title(t: RmTitle): string {
  return t.rus_name || t.en_name || t.main_name || 'Без названия';
}

function toResult(t: RmTitle): MangaSearchResult {
  return {
    sourceId: 'remanga',
    externalId: t.dir,
    title: title(t),
    altTitles: [t.en_name, t.secondary_name].filter((x): x is string => Boolean(x)),
    coverUrl: cover(t.img),
    status: mapStatus(t.status?.id),
    languages: ['ru'],
  };
}

export class RemangaProvider implements SourceProvider {
  id = 'remanga';
  name = 'Remanga';
  languages = ['ru'];
  type = 'scraper' as const;
  supportsSearch = true;
  supportsReading = true;

  async trending(options?: SearchOptions): Promise<MangaSearchResult[]> {
    // Remanga's catalog rejects large counts (400) — cap at 30 per page.
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

  private async detail(dir: string): Promise<RmTitle> {
    const data = await getJSON<{ content: RmTitle }>(`${API}/titles/${encodeURIComponent(dir)}/`);
    return data.content;
  }

  async getMangaDetails(externalId: string): Promise<MangaDetails> {
    const t = await this.detail(externalId);
    // Remanga doesn't expose authors as a usable array; show the publisher
    // (translation team) instead when present.
    const authors = Array.isArray(t.publishers)
      ? t.publishers.map((p) => p.name).filter(Boolean)
      : undefined;
    return {
      ...toResult(t),
      description: t.description?.trim(),
      authors,
      genres: t.genres?.map((g) => g.name).filter(Boolean),
      year: t.issue_year,
    };
  }

  async getChapters(externalId: string): Promise<Chapter[]> {
    const t = await this.detail(externalId);
    const branches = t.branches ?? [];
    if (branches.length === 0) return [];
    // Use the branch with the most chapters (the main translation).
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
        if (ch.is_paid) continue; // locked / early-access — no readable pages
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
    // Present oldest-first (by volume then chapter number) like other sources.
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
    // Some entries are arrays (sliced double-pages); flatten them.
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
