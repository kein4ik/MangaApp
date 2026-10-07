import { mapLimit } from '@/lib/pool';

import { fetchJSON } from '../http';
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

const API = 'https://api.mangadex.org';
const COVERS = 'https://uploads.mangadex.org/covers';
const HEADERS = { 'User-Agent': 'MangaApp/0.1' };

type MdRelationship = { id: string; type: string; attributes?: Record<string, any> };
type MdManga = {
  id: string;
  attributes: {
    title: Record<string, string>;
    altTitles?: Record<string, string>[];
    description?: Record<string, string>;
    status?: string;
    year?: number;
    contentRating?: string;
    availableTranslatedLanguages?: string[];
    tags?: { attributes: { name: Record<string, string> } }[];
  };
  relationships: MdRelationship[];
};
type MdChapter = {
  id: string;
  attributes: {
    title?: string;
    chapter?: string;
    volume?: string;
    translatedLanguage: string;
    publishAt?: string;
    externalUrl?: string;
  };
  relationships: MdRelationship[];
};

// The http gate paces MangaDex to its ~5 req/s limit; a 429 that still slips
// through waits for the server's Retry-After instead of failing the whole list.
const getJSON = <T>(url: string, signal?: AbortSignal) =>
  fetchJSON<T>(url, { headers: HEADERS, signal, label: 'MangaDex', retries429: 2 });

/** Languages to filter results by: every requested one MangaDex actually has. */
function wantedLangs(options: SearchOptions | undefined, supported: string[]): string[] {
  const langs = options?.langs?.length ? options.langs : options?.lang ? [options.lang] : [];
  return langs.filter((l) => supported.includes(l));
}

function pickText(map: Record<string, string> | undefined, lang?: string): string {
  if (!map) return '';
  if (lang && map[lang]) return map[lang];
  return map.en ?? map['ja-ro'] ?? Object.values(map)[0] ?? '';
}

function mapStatus(s?: string): MangaStatus {
  if (s === 'ongoing' || s === 'completed' || s === 'hiatus') return s;
  return 'unknown';
}

function coverUrl(manga: MdManga): string | undefined {
  const file = manga.relationships.find((r) => r.type === 'cover_art')?.attributes?.fileName;
  return file ? `${COVERS}/${manga.id}/${file}.512.jpg` : undefined;
}

function toResult(manga: MdManga): MangaSearchResult {
  return {
    sourceId: 'mangadex',
    externalId: manga.id,
    title: pickText(manga.attributes.title),
    altTitles: manga.attributes.altTitles?.map((t) => Object.values(t)[0]).filter(Boolean),
    coverUrl: coverUrl(manga),
    description: pickText(manga.attributes.description),
    status: mapStatus(manga.attributes.status),
    languages: manga.attributes.availableTranslatedLanguages ?? [],
  };
}

// Tag name (lowercased) → tag id, fetched once. Lets browseByGenre turn a genre
// string from a manga's details into a real includedTags filter.
let tagMapCache: { map: Map<string, string>; at: number } | null = null;
async function tagMap(): Promise<Map<string, string>> {
  if (tagMapCache && Date.now() - tagMapCache.at < 24 * 60 * 60 * 1000) return tagMapCache.map;
  const map = new Map<string, string>();
  try {
    const data = await getJSON<{
      data: { id: string; attributes: { name: Record<string, string> } }[];
    }>(`${API}/manga/tag`);
    for (const t of data.data) {
      const name = t.attributes.name?.en;
      if (name) map.set(name.toLowerCase(), t.id);
    }
    tagMapCache = { map, at: Date.now() };
  } catch {
    // Leave the map empty on failure — browseByGenre just returns nothing.
  }
  return map;
}

export class MangaDexProvider implements SourceProvider {
  id = 'mangadex';
  name = 'MangaDex';
  languages = [
    'en', 'ru', 'es', 'es-la', 'fr', 'de', 'pt-br', 'it', 'pl', 'tr',
    'vi', 'id', 'ja', 'ko', 'zh', 'zh-hk', 'ar', 'th', 'uk',
  ];
  type = 'official_api' as const;
  supportsSearch = true;
  supportsReading = true;
  // JSON API: an empty feed really means "nothing readable in this language".
  trustEmptyChapters = true;

  async trending(options?: SearchOptions): Promise<MangaSearchResult[]> {
    const p = new URLSearchParams();
    p.set('limit', String(options?.limit ?? 24));
    p.append(options?.sort === 'latest' ? 'order[latestUploadedChapter]' : 'order[followedCount]', 'desc');
    p.append('includes[]', 'cover_art');
    p.append('contentRating[]', 'safe');
    p.append('contentRating[]', 'suggestive');
    p.append('hasAvailableChapters', 'true');
    for (const l of wantedLangs(options, this.languages)) p.append('availableTranslatedLanguage[]', l);
    const data = await getJSON<{ data: MdManga[] }>(`${API}/manga?${p}`, options?.signal);
    return data.data.map(toResult);
  }

  async search(query: string, options?: SearchOptions): Promise<MangaSearchResult[]> {
    const p = new URLSearchParams();
    p.set('title', query);
    p.set('limit', String(options?.limit ?? 24));
    // Best title match first (the API's default order is "recently updated").
    p.append('order[relevance]', 'desc');
    p.append('includes[]', 'cover_art');
    p.append('contentRating[]', 'safe');
    p.append('contentRating[]', 'suggestive');
    // Skip titles with no readable chapters (licensed/empty) — trending already does this.
    p.append('hasAvailableChapters', 'true');
    // Only titles readable in the user's languages (MangaDex hosts dozens).
    for (const l of wantedLangs(options, this.languages)) p.append('availableTranslatedLanguage[]', l);
    const data = await getJSON<{ data: MdManga[] }>(`${API}/manga?${p}`, options?.signal);
    return data.data.map(toResult);
  }

  async browseByGenre(genre: string, options?: SearchOptions): Promise<MangaSearchResult[]> {
    const tags = await tagMap();
    const id = tags.get(genre.trim().toLowerCase());
    if (!id) return [];
    const p = new URLSearchParams();
    p.append('includedTags[]', id);
    p.append(options?.sort === 'latest' ? 'order[latestUploadedChapter]' : 'order[followedCount]', 'desc');
    p.set('limit', String(options?.limit ?? 24));
    p.append('includes[]', 'cover_art');
    p.append('contentRating[]', 'safe');
    p.append('contentRating[]', 'suggestive');
    p.append('hasAvailableChapters', 'true');
    for (const l of wantedLangs(options, this.languages)) p.append('availableTranslatedLanguage[]', l);
    const data = await getJSON<{ data: MdManga[] }>(`${API}/manga?${p}`, options?.signal);
    return data.data.map(toResult);
  }

  async getMangaDetails(externalId: string, options?: CallOptions): Promise<MangaDetails> {
    const p = new URLSearchParams();
    p.append('includes[]', 'cover_art');
    p.append('includes[]', 'author');
    p.append('includes[]', 'artist');
    const data = await getJSON<{ data: MdManga }>(`${API}/manga/${externalId}?${p}`, options?.signal);
    const manga = data.data;
    const authors = manga.relationships
      .filter((r) => r.type === 'author' || r.type === 'artist')
      .map((r) => r.attributes?.name)
      .filter((n): n is string => Boolean(n));
    return {
      ...toResult(manga),
      authors: [...new Set(authors)],
      genres: manga.attributes.tags?.map((t) => pickText(t.attributes.name)).filter(Boolean),
      year: manga.attributes.year,
      contentRating: manga.attributes.contentRating,
    };
  }

  async getChapters(externalId: string, lang = 'en', options?: CallOptions): Promise<Chapter[]> {
    // 500 is the feed endpoint's max page size: a 2000-entry series is 4
    // requests instead of 20.
    const limit = 500;
    const feedUrl = (offset: number) => {
      const p = new URLSearchParams();
      p.set('limit', String(limit));
      p.set('offset', String(offset));
      p.append('translatedLanguage[]', lang);
      p.append('order[chapter]', 'asc');
      p.append('includes[]', 'scanlation_group');
      p.append('contentRating[]', 'safe');
      p.append('contentRating[]', 'suggestive');
      p.append('contentRating[]', 'erotica');
      return `${API}/manga/${externalId}/feed?${p}`;
    };

    // Fetch page 1 to learn the total, then the rest a few at a time. No cap
    // below the API's own offset+limit ≤ 10000 window: the feed is oldest-first,
    // so a cap would silently drop the NEWEST chapters of long series.
    const signal = options?.signal;
    const first = await getJSON<{ data: MdChapter[]; total: number }>(feedUrl(0), signal);
    const offsets: number[] = [];
    for (let o = limit; o < first.total && o + limit <= 10_000; o += limit) offsets.push(o);
    const rest = await mapLimit(offsets, 3, (o) =>
      getJSON<{ data: MdChapter[]; total: number }>(feedUrl(o), signal),
    );

    const all: Chapter[] = [];
    for (const data of [first, ...rest]) {
      for (const ch of data.data) {
        if (ch.attributes.externalUrl) continue;
        const group = ch.relationships.find((r) => r.type === 'scanlation_group');
        all.push({
          sourceId: 'mangadex',
          externalId: ch.id,
          mangaExternalId: externalId,
          title: ch.attributes.title || undefined,
          chapterNumber: ch.attributes.chapter ?? undefined,
          volume: ch.attributes.volume ?? undefined,
          language: ch.attributes.translatedLanguage,
          publishedAt: ch.attributes.publishAt,
          scanlationGroup: group?.attributes?.name,
        });
      }
    }
    return all;
  }

  async getChapterPages(chapterId: string, options?: CallOptions): Promise<ChapterPage[]> {
    const data = await getJSON<{
      baseUrl: string;
      chapter: { hash: string; data: string[] };
    }>(`${API}/at-home/server/${chapterId}`, options?.signal);
    const { baseUrl } = data;
    const { hash, data: files } = data.chapter;
    return files.map((file, index) => ({
      index,
      imageUrl: `${baseUrl}/data/${hash}/${file}`,
    }));
  }
}
