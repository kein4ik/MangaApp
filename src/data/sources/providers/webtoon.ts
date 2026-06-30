import { fetchWithTimeout } from '../http';
import type { SourceProvider } from '../SourceProvider';
import type {
  Chapter,
  ChapterPage,
  MangaDetails,
  MangaSearchResult,
  SearchOptions,
} from '../types';

/**
 * WEBTOON (webtoons.com) — official EN webcomics. Search + details are scraped
 * from HTML; the chapter list comes from the mobile JSON API (one call instead
 * of paginating 10-at-a-time). Page images live on pstatic.net and REQUIRE a
 * Referer (imageSource re-attaches it for covers; pages carry headers here).
 */

const BASE = 'https://www.webtoons.com';
const MOBILE_API = 'https://m.webtoons.com/api/v1';
const SEP = '~';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
// ageGatePass skips the maturity interstitial that otherwise hides content.
const HTML_HEADERS = {
  'User-Agent': UA,
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: 'text/html',
  Cookie: 'ageGatePass=true; needGDPR=false; needCCPA=false; needCOPPA=false',
};
const IMG_HEADERS = { 'User-Agent': UA, Referer: `${BASE}/` };

async function getHTML(url: string): Promise<string> {
  const res = await fetchWithTimeout(url, { headers: HTML_HEADERS });
  if (!res.ok) throw new Error(`Webtoon ${res.status}`);
  return res.text();
}

/** externalId packs what we need to rebuild URLs: genre, slug, numeric title_no. */
const makeId = (genre: string, slug: string, titleNo: string) => [genre, slug, titleNo].join(SEP);
const parseId = (id: string) => {
  const [genre, slug, titleNo] = id.split(SEP);
  return { genre, slug, titleNo };
};

/** Parse list/search/ranking cards: any anchor to a series "list" page. */
function parseCards(html: string, limit: number): MangaSearchResult[] {
  const out: MangaSearchResult[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(
    /<a\s+href="https:\/\/www\.webtoons\.com\/en\/([a-z0-9-]+)\/([a-z0-9_-]+)\/list\?title_no=(\d+)"([\s\S]*?)<\/a>/g,
  )) {
    const [, genre, slug, titleNo, block] = m;
    if (seen.has(titleNo)) continue;
    seen.add(titleNo);
    const title =
      block.match(/class="(?:title|subj)"[^>]*>(?:\s*<span[^>]*>)?\s*([^<]+)/)?.[1]?.trim() || slug;
    const coverUrl = block.match(/<img[^>]+src="(https:\/\/[^"]+pstatic\.net[^"]+)"/)?.[1];
    out.push({ sourceId: 'webtoon', externalId: makeId(genre, slug, titleNo), title, coverUrl, languages: ['en'] });
    if (out.length >= limit) break;
  }
  return out;
}

type Episode = { episodeNo: number; episodeTitle?: string };

export class WebtoonProvider implements SourceProvider {
  id = 'webtoon';
  name = 'WEBTOON';
  languages = ['en'];
  type = 'scraper' as const;
  supportsSearch = true;
  supportsReading = true;

  async trending(options?: SearchOptions): Promise<MangaSearchResult[]> {
    // Originals daily list = curated popular series.
    const html = await getHTML(`${BASE}/en/originals`);
    return parseCards(html, options?.limit ?? 30);
  }

  async search(query: string, options?: SearchOptions): Promise<MangaSearchResult[]> {
    const html = await getHTML(`${BASE}/en/search?keyword=${encodeURIComponent(query)}`);
    return parseCards(html, options?.limit ?? 30);
  }

  async getMangaDetails(externalId: string): Promise<MangaDetails> {
    const { genre, slug, titleNo } = parseId(externalId);
    const html = await getHTML(`${BASE}/en/${genre}/${slug}/list?title_no=${titleNo}`);
    const title =
      html.match(/property="og:title"\s+content="([^"]+)"/)?.[1] ??
      html.match(/<h1[^>]*class="subj"[^>]*>([^<]+)/)?.[1];
    const coverUrl = html.match(/property="og:image"\s+content="([^"]+)"/)?.[1];
    const description = html.match(/property="og:description"\s+content="([^"]+)"/)?.[1];
    const author = html.match(/class="author"[^>]*>([^<]+)/)?.[1]?.trim();
    const genreLabel = html.match(/class="genre[^"]*"[^>]*>([^<]+)/)?.[1]?.trim();
    return {
      sourceId: 'webtoon',
      externalId,
      title: title?.trim() || slug,
      coverUrl,
      description: description?.trim(),
      authors: author ? [author] : undefined,
      genres: genreLabel ? [genreLabel] : undefined,
      languages: ['en'],
    };
  }

  async getChapters(externalId: string): Promise<Chapter[]> {
    const { titleNo } = parseId(externalId);
    const res = await fetchWithTimeout(`${MOBILE_API}/webtoon/${titleNo}/episodes?pageSize=1000`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Webtoon episodes ${res.status}`);
    const json = (await res.json()) as { result?: { episodeList?: Episode[] } };
    const episodes = json.result?.episodeList ?? [];
    return episodes
      .map((e) => ({
        sourceId: 'webtoon',
        externalId: [titleNo, e.episodeNo].join(SEP),
        mangaExternalId: externalId,
        chapterNumber: String(e.episodeNo),
        title: e.episodeTitle,
        language: 'en',
      }))
      .sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber));
  }

  async getChapterPages(chapterId: string): Promise<ChapterPage[]> {
    const [titleNo, episodeNo] = chapterId.split(SEP);
    // The viewer only needs the query params; the path segments are ignored.
    const html = await getHTML(
      `${BASE}/en/x/x/_/viewer?title_no=${titleNo}&episode_no=${episodeNo}`,
    );
    const seen = new Set<string>();
    const pages: ChapterPage[] = [];
    for (const m of html.matchAll(
      /<img[^>]*class="_images"[^>]*data-url="(https:\/\/[^"]+)"/g,
    )) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      pages.push({ index: pages.length, imageUrl: m[1], headers: IMG_HEADERS });
    }
    return pages;
  }
}
