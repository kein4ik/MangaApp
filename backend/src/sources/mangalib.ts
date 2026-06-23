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
 * MangaLib (mangalib.me) — popular RU source. Community JSON API at
 * api2.mangalib.me. Requires a `Site-Id: 1` header on API calls, and its image
 * CDN requires a `Referer: https://mangalib.me/` header (403 without) — we pass
 * that through on every page via ChapterPage.headers.
 *
 * Marked `scraper` since it's an unofficial API: it can rate-limit or change,
 * which is exactly why SourceHealthService surfaces online/slow/broken.
 */

const API = 'https://api2.mangalib.me/api';
const SITE_ID = '1';
const IMAGE_REFERER = 'https://mangalib.me/';
const FALLBACK_IMAGE_SERVER = 'https://img2.imglib.info';

const HEADERS = {
  'Site-Id': SITE_ID,
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
};

// chapterId is composite (slug~volume~number~branch) because MangaLib fetches
// pages by manga slug + chapter number/volume, not by a standalone id.
const CHID_SEP = '~';

type MlCover = { default?: string; thumbnail?: string };
type MlManga = {
  id: number;
  name?: string;
  rus_name?: string;
  eng_name?: string;
  slug_url: string;
  cover?: MlCover;
  summary?: unknown;
  status?: { id?: number; label?: string };
  genres?: { name: string }[];
  authors?: { name: string }[];
  releaseDate?: string;
};
type MlChapter = {
  volume: string;
  number: string;
  name?: string;
  branches?: { branch_id: number | null; teams?: { name?: string }[] }[];
};
type MlPage = { url: string; height?: number; width?: number };

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`MangaLib ${res.status} on ${url}`);
  return (await res.json()) as T;
}

function mapStatus(id?: number): MangaStatus {
  switch (id) {
    case 1:
      return 'ongoing';
    case 2:
      return 'completed';
    case 4:
      return 'hiatus';
    default:
      return 'unknown';
  }
}

/** MangaLib descriptions come as a ProseMirror doc; flatten to plain text. */
function flattenSummary(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === 'text' && typeof n.text === 'string') return n.text;
  const inner = Array.isArray(n.content) ? n.content.map(flattenSummary).join('') : '';
  return n.type === 'paragraph' ? inner + '\n' : inner;
}

function pickTitle(m: MlManga): string {
  return m.rus_name || m.name || m.eng_name || 'Без названия';
}

function toResult(m: MlManga): MangaSearchResult {
  return {
    sourceId: 'mangalib',
    externalId: m.slug_url,
    title: pickTitle(m),
    altTitles: [m.name, m.eng_name].filter((x): x is string => Boolean(x)),
    coverUrl: m.cover?.default || m.cover?.thumbnail,
    status: mapStatus(m.status?.id),
    languages: ['ru'],
  };
}

let imageServerCache: { url: string; at: number } | null = null;

async function imageServer(): Promise<string> {
  if (imageServerCache && Date.now() - imageServerCache.at < 60 * 60 * 1000) {
    return imageServerCache.url;
  }
  try {
    const data = await getJSON<{
      data: { imageServers: { id: string; url: string; site_ids: number[] }[] };
    }>(`${API}/constants?fields[]=imageServers`);
    const main = data.data.imageServers.find(
      (s) => s.id === 'main' && s.site_ids.includes(1) && s.url,
    );
    const url = main?.url || FALLBACK_IMAGE_SERVER;
    imageServerCache = { url, at: Date.now() };
    return url;
  } catch {
    return FALLBACK_IMAGE_SERVER;
  }
}

export class MangaLibProvider implements SourceProvider {
  id = 'mangalib';
  name = 'MangaLib';
  languages = ['ru'];
  type = 'scraper' as const;
  supportsSearch = true;
  supportsReading = true;

  async trending(options?: SearchOptions): Promise<MangaSearchResult[]> {
    const p = new URLSearchParams();
    p.append('site_id[]', SITE_ID);
    p.set('sort_by', options?.sort === 'latest' ? 'last_chapter_at' : 'views');
    const data = await getJSON<{ data: MlManga[] }>(`${API}/manga?${p}`);
    return data.data.slice(0, options?.limit ?? 30).map(toResult);
  }

  async search(query: string, options?: SearchOptions): Promise<MangaSearchResult[]> {
    const p = new URLSearchParams();
    p.set('q', query);
    p.append('site_id[]', SITE_ID);
    const data = await getJSON<{ data: MlManga[] }>(`${API}/manga?${p}`);
    return data.data.slice(0, options?.limit ?? 30).map(toResult);
  }

  async getMangaDetails(externalId: string): Promise<MangaDetails> {
    const p = new URLSearchParams();
    ['summary', 'authors', 'genres', 'status_id'].forEach((f) => p.append('fields[]', f));
    const data = await getJSON<{ data: MlManga }>(
      `${API}/manga/${encodeURIComponent(externalId)}?${p}`,
    );
    const m = data.data;
    return {
      ...toResult(m),
      description: flattenSummary(m.summary).trim(),
      authors: m.authors?.map((a) => a.name).filter(Boolean),
      genres: m.genres?.map((g) => g.name).filter(Boolean),
    };
  }

  async getChapters(externalId: string): Promise<Chapter[]> {
    const data = await getJSON<{ data: MlChapter[] }>(
      `${API}/manga/${encodeURIComponent(externalId)}/chapters`,
    );
    if (!Array.isArray(data.data)) return [];
    return data.data.map((ch) => {
      const branch = ch.branches?.[0];
      const branchId = branch?.branch_id ?? '';
      return {
        sourceId: 'mangalib',
        externalId: [externalId, ch.volume, ch.number, branchId].join(CHID_SEP),
        mangaExternalId: externalId,
        title: ch.name || undefined,
        chapterNumber: ch.number,
        volume: ch.volume,
        language: 'ru',
        scanlationGroup: branch?.teams?.[0]?.name,
      };
    });
  }

  async getChapterPages(chapterId: string): Promise<ChapterPage[]> {
    const [slug, volume, number, branchId] = chapterId.split(CHID_SEP);
    const p = new URLSearchParams();
    p.set('number', number);
    p.set('volume', volume);
    if (branchId) p.set('branch_id', branchId);

    const [data, server] = await Promise.all([
      getJSON<{ data: { pages?: MlPage[] } }>(
        `${API}/manga/${encodeURIComponent(slug)}/chapter?${p}`,
      ),
      imageServer(),
    ]);

    const pages = data.data.pages ?? [];
    return pages.map((pg, index) => ({
      index,
      // page url looks like "//manga/.../1_x.jpg" — strip leading slashes.
      imageUrl: `${server}/${pg.url.replace(/^\/+/, '')}`,
      width: pg.width,
      height: pg.height,
      headers: { Referer: IMAGE_REFERER },
    }));
  }
}
