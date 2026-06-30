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

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetchWithTimeout(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`MangaDex ${res.status}`);
  return (await res.json()) as T;
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

  async trending(options?: SearchOptions): Promise<MangaSearchResult[]> {
    const p = new URLSearchParams();
    p.set('limit', String(options?.limit ?? 24));
    p.append(options?.sort === 'latest' ? 'order[latestUploadedChapter]' : 'order[followedCount]', 'desc');
    p.append('includes[]', 'cover_art');
    p.append('contentRating[]', 'safe');
    p.append('contentRating[]', 'suggestive');
    p.append('hasAvailableChapters', 'true');
    if (options?.lang) p.append('availableTranslatedLanguage[]', options.lang);
    const data = await getJSON<{ data: MdManga[] }>(`${API}/manga?${p}`);
    return data.data.map(toResult);
  }

  async search(query: string, options?: SearchOptions): Promise<MangaSearchResult[]> {
    const p = new URLSearchParams();
    p.set('title', query);
    p.set('limit', String(options?.limit ?? 24));
    p.append('includes[]', 'cover_art');
    p.append('contentRating[]', 'safe');
    p.append('contentRating[]', 'suggestive');
    // Skip titles with no readable chapters (licensed/empty) — trending already does this.
    p.append('hasAvailableChapters', 'true');
    if (options?.lang) p.append('availableTranslatedLanguage[]', options.lang);
    const data = await getJSON<{ data: MdManga[] }>(`${API}/manga?${p}`);
    return data.data.map(toResult);
  }

  async getMangaDetails(externalId: string): Promise<MangaDetails> {
    const p = new URLSearchParams();
    p.append('includes[]', 'cover_art');
    p.append('includes[]', 'author');
    p.append('includes[]', 'artist');
    const data = await getJSON<{ data: MdManga }>(`${API}/manga/${externalId}?${p}`);
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

  async getChapters(externalId: string, lang = 'en'): Promise<Chapter[]> {
    const limit = 100;
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

    // Fetch page 1 to learn the total, then pull the rest in PARALLEL — a
    // 1000-chapter series loads in one round-trip instead of ten.
    const first = await getJSON<{ data: MdChapter[]; total: number }>(feedUrl(0));
    const offsets: number[] = [];
    for (let o = limit; o < first.total && o < limit * 20; o += limit) offsets.push(o);
    const rest = await Promise.all(
      offsets.map((o) => getJSON<{ data: MdChapter[]; total: number }>(feedUrl(o))),
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

  async getChapterPages(chapterId: string): Promise<ChapterPage[]> {
    const data = await getJSON<{
      baseUrl: string;
      chapter: { hash: string; data: string[] };
    }>(`${API}/at-home/server/${chapterId}`);
    const { baseUrl } = data;
    const { hash, data: files } = data.chapter;
    return files.map((file, index) => ({
      index,
      imageUrl: `${baseUrl}/data/${hash}/${file}`,
    }));
  }
}
