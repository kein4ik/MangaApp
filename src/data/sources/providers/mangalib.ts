import { delay, fetchJSON, HttpError, isAbortError } from '../http';
import type { SourceProvider } from '../SourceProvider';
import type {
  CallOptions,
  Chapter,
  ChapterPage,
  MangaDetails,
  MangaSearchResult,
  MangaStatus,
  SearchOptions,
} from '../types';

/**
 * The Lib backend answers on several domains. Some ISPs/carriers block
 * mangalib.me while cdnlibs.org still resolves — getJSON fails over between
 * them (sticky: keeps using whichever host worked last).
 */
const API_HOSTS = ['https://api2.mangalib.me/api', 'https://api.cdnlibs.org/api'];
const SITE_ID = '1';
const IMAGE_REFERER = 'https://mangalib.me/';
const FALLBACK_IMAGE_SERVER = 'https://img2.imglib.info';
const CHID_SEP = '~';

// Mimic the site's own browser traffic as closely as possible (mobile Chrome
// UA + Origin/Referer of the site) — some networks/filters treat "app-looking"
// clients differently from browsers even when the same URL works in a browser.
const HEADERS = {
  'Site-Id': SITE_ID,
  Accept: 'application/json',
  'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
  Origin: 'https://mangalib.me',
  Referer: 'https://mangalib.me/',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
};

type MlCover = { default?: string; thumbnail?: string };
type MlManga = {
  id: number;
  name?: string;
  rus_name?: string;
  eng_name?: string;
  slug_url: string;
  cover?: MlCover;
  summary?: unknown;
  status?: { id?: number };
  genres?: { name: string }[];
  authors?: { name: string }[];
  /** id 4 = 18+. MangaLib serves NO chapters for 18+ titles anonymously. */
  ageRestriction?: { id?: number; label?: string };
};
type MlChapter = {
  volume: string;
  number: string;
  name?: string;
  branches?: { branch_id: number | null; teams?: { name?: string }[] }[];
};
type MlPage = { url: string; height?: number; width?: number };

/** One host attempt with a single short-backoff retry on 429/5xx (rate limits). */
async function fetchHost<T>(base: string, path: string, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchJSON<T>(`${base}${path}`, { headers: HEADERS, signal, label: 'MangaLib' });
    } catch (e) {
      if (attempt === 0 && e instanceof HttpError && (e.status === 429 || e.status >= 500)) {
        await delay(1500, signal);
        continue;
      }
      throw e;
    }
  }
}

let preferredHost = 0;

/** Fetch with host failover — `path` starts with '/', e.g. `/manga?...`. */
async function getJSON<T>(path: string, signal?: AbortSignal): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < API_HOSTS.length; i++) {
    const idx = (preferredHost + i) % API_HOSTS.length;
    try {
      const data = await fetchHost<T>(API_HOSTS[idx], path, signal);
      preferredHost = idx;
      return data;
    } catch (e) {
      // A cancelled request isn't a host problem — don't try the mirror.
      if (isAbortError(e)) throw e;
      // Surfaced in the Metro terminal so a device-only failure is debuggable.
      if (__DEV__) {
        console.warn(`[mangalib] ${API_HOSTS[idx]}${path.slice(0, 60)} → ${String(e)}`);
      }
      // A definitive client answer (404 etc.) is the same on every mirror —
      // only fail over on network errors, rate limits and 5xx.
      if (e instanceof HttpError && e.status !== 429 && e.status < 500) throw e;
      lastError = e;
    }
  }
  throw lastError;
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

function flattenSummary(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === 'text' && typeof n.text === 'string') return n.text;
  const inner = Array.isArray(n.content) ? n.content.map(flattenSummary).join('') : '';
  return n.type === 'paragraph' ? inner + '\n' : inner;
}

function toResult(m: MlManga): MangaSearchResult {
  return {
    sourceId: 'mangalib',
    externalId: m.slug_url,
    title: m.rus_name || m.name || m.eng_name || 'Без названия',
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
    }>(`/constants?fields[]=imageServers`);
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

// Genre name (lowercased) → genre id, fetched once, for browseByGenre. MangaLib
// genre names are Russian and so are the genre strings in its manga details, so
// feeding a title's own genre back in matches cleanly.
let genreMapCache: { map: Map<string, string>; at: number } | null = null;
async function genreMap(): Promise<Map<string, string>> {
  if (genreMapCache && Date.now() - genreMapCache.at < 24 * 60 * 60 * 1000) return genreMapCache.map;
  const map = new Map<string, string>();
  try {
    const data = await getJSON<{ data: { genres: { id: number; name: string }[] } }>(
      `/constants?fields[]=genres`,
    );
    for (const g of data.data.genres) {
      if (g.name) map.set(g.name.toLowerCase(), String(g.id));
    }
    genreMapCache = { map, at: Date.now() };
  } catch {
    // Empty map → browseByGenre returns nothing.
  }
  return map;
}

export class MangaLibProvider implements SourceProvider {
  id = 'mangalib';
  name = 'MangaLib';
  languages = ['ru'];
  type = 'scraper' as const;
  supportsSearch = true;
  supportsReading = true;
  // JSON API: `data: []` is a real answer (licensed or 18+ login-walled).
  trustEmptyChapters = true;

  async trending(options?: SearchOptions): Promise<MangaSearchResult[]> {
    const p = new URLSearchParams();
    p.append('site_id[]', SITE_ID);
    p.set('sort_by', options?.sort === 'latest' ? 'last_chapter_at' : 'views');
    const data = await getJSON<{ data: MlManga[] }>(`/manga?${p}`, options?.signal);
    return data.data.slice(0, options?.limit ?? 30).map(toResult);
  }

  async search(query: string, options?: SearchOptions): Promise<MangaSearchResult[]> {
    const p = new URLSearchParams();
    p.set('q', query);
    p.append('site_id[]', SITE_ID);
    const data = await getJSON<{ data: MlManga[] }>(`/manga?${p}`, options?.signal);
    return data.data.slice(0, options?.limit ?? 30).map(toResult);
  }

  async browseByGenre(genre: string, options?: SearchOptions): Promise<MangaSearchResult[]> {
    const genres = await genreMap();
    const id = genres.get(genre.trim().toLowerCase());
    if (!id) return [];
    const p = new URLSearchParams();
    p.append('site_id[]', SITE_ID);
    p.append('genres[]', id);
    p.set('sort_by', options?.sort === 'latest' ? 'last_chapter_at' : 'views');
    const data = await getJSON<{ data: MlManga[] }>(`/manga?${p}`, options?.signal);
    return data.data.slice(0, options?.limit ?? 30).map(toResult);
  }

  async getMangaDetails(externalId: string, options?: CallOptions): Promise<MangaDetails> {
    const p = new URLSearchParams();
    // NOTE: fields[] is validated by the API — an unknown name 422s the whole
    // request (asking for ageRestriction broke every details load once).
    // ageRestriction is returned by default anyway.
    ['summary', 'authors', 'genres', 'status_id'].forEach((f) => p.append('fields[]', f));
    const data = await getJSON<{ data: MlManga }>(
      `/manga/${encodeURIComponent(externalId)}?${p}`,
      options?.signal,
    );
    const m = data.data;
    return {
      ...toResult(m),
      description: flattenSummary(m.summary).trim(),
      authors: m.authors?.map((a) => a.name).filter(Boolean),
      genres: m.genres?.map((g) => g.name).filter(Boolean),
      // Surfaced so the UI can explain WHY chapters are empty (login-walled).
      contentRating: m.ageRestriction?.id === 4 ? '18+' : m.ageRestriction?.label,
    };
  }

  async getChapters(externalId: string, _lang?: string, options?: CallOptions): Promise<Chapter[]> {
    const data = await getJSON<{ data: MlChapter[] }>(
      `/manga/${encodeURIComponent(externalId)}/chapters`,
      options?.signal,
    );
    // An unexpected shape is an error, not "no chapters" (which would get the
    // title remembered as dead for days).
    if (!Array.isArray(data.data)) throw new Error('MangaLib: unexpected chapters response');
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

  async getChapterPages(chapterId: string, options?: CallOptions): Promise<ChapterPage[]> {
    const [slug, volume, number, branchId] = chapterId.split(CHID_SEP);
    const p = new URLSearchParams();
    p.set('number', number);
    p.set('volume', volume);
    if (branchId) p.set('branch_id', branchId);
    const [data, server] = await Promise.all([
      getJSON<{ data: { pages?: MlPage[] } }>(
        `/manga/${encodeURIComponent(slug)}/chapter?${p}`,
        options?.signal,
      ),
      imageServer(),
    ]);
    const pages = data.data.pages ?? [];
    return pages.map((pg, index) => ({
      index,
      imageUrl: `${server}/${pg.url.replace(/^\/+/, '')}`,
      width: pg.width,
      height: pg.height,
      headers: { Referer: IMAGE_REFERER },
    }));
  }
}
