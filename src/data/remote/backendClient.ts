import { API_BASE_URL } from '@/config';
import type {
  Chapter,
  ChapterPage,
  MangaDetails,
  MangaSearchResult,
  SourceInfo,
} from '@/data/sources/types';

/**
 * The app's only door to the outside world (Phase 2). Every screen goes through
 * these functions; none of them know anything about MangaDex or AniList.
 */

// Generous timeout: a free cloud host (Render) can cold-start in ~30s after
// idling, so the first request shouldn't fail too eagerly.
const TIMEOUT_MS = 25_000;

async function getJSON<T>(path: string): Promise<T> {
  // Abort instead of hanging forever when the backend is unreachable (e.g. a
  // phone that can't see the dev machine). Surfaces a clear error in the UI.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { signal: ctrl.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Backend timed out (${API_BASE_URL}). Is it running?`);
    }
    throw new Error(`Can't reach backend at ${API_BASE_URL}. Is it running?`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error ?? '';
    } catch {
      // ignore non-JSON error bodies
    }
    throw new Error(detail || `Backend ${res.status} on ${path}`);
  }
  return (await res.json()) as T;
}

// Encode a path segment (MangaLib ids contain "~" and "--").
const enc = (s: string): string => encodeURIComponent(s);

const qs = (params: Record<string, string | undefined>): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const backend = {
  getSources: () => getJSON<{ sources: SourceInfo[] }>('/sources').then((r) => r.sources),

  getTrending: (source: string, lang?: string, sort?: 'popular' | 'latest', limit?: number) =>
    getJSON<{ results: MangaSearchResult[] }>(
      `/manga/trending${qs({ source, lang, sort, limit: limit ? String(limit) : undefined })}`,
    ).then((r) => r.results),

  search: (source: string, q: string, lang?: string) =>
    getJSON<{ results: MangaSearchResult[] }>(`/manga/search${qs({ source, q, lang })}`).then(
      (r) => r.results,
    ),

  /** Find the same title on other sources (cross-source "available on"). */
  match: (q: string, exclude?: string) =>
    getJSON<{ matches: MangaSearchResult[] }>(`/manga/match${qs({ q, exclude })}`).then(
      (r) => r.matches,
    ),

  getDetails: (source: string, externalId: string) =>
    getJSON<MangaDetails>(`/manga/${source}/${enc(externalId)}`),

  getChapters: (source: string, externalId: string, lang: string) =>
    getJSON<{ chapters: Chapter[] }>(
      `/manga/${source}/${enc(externalId)}/chapters${qs({ lang })}`,
    ).then((r) => r.chapters),

  getPages: (source: string, chapterId: string) =>
    getJSON<{ pages: ChapterPage[] }>(`/chapter/${source}/${enc(chapterId)}/pages`).then(
      (r) => r.pages,
    ),
};
