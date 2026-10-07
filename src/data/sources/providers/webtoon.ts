import { fetchJSON, fetchText, UnexpectedPageError } from '../http';
import type { SourceProvider } from '../SourceProvider';
import type {
  CallOptions,
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

const getHTML = (url: string, signal?: AbortSignal) =>
  fetchText(url, { headers: HTML_HEADERS, signal, label: 'Webtoon' });

// Real pages name the site in <title> (lists, search) or og:site_name (series,
// viewer); an error page served with 200 does neither.
const isWebtoonPage = (html: string) =>
  /<title>[^<]*WEBTOON|property="og:site_name"\s+content="www\.webtoons\.com"/.test(html);

function checked<T>(items: T[], html: string): T[] {
  if (!items.length && !isWebtoonPage(html)) throw new UnexpectedPageError('Webtoon');
  return items;
}

/** Numeric attribute of an HTML tag (viewer images declare width/height). */
const attrNum = (tag: string, name: string) => {
  const n = Number(tag.match(new RegExp(`\\s${name}="([\\d.]+)"`))?.[1]);
  return n > 0 ? n : undefined;
};

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
  // Chapters come from a JSON API (shape-checked below), so empty is real.
  trustEmptyChapters = true;

  async trending(options?: SearchOptions): Promise<MangaSearchResult[]> {
    // Originals daily list = curated popular series.
    const html = await getHTML(`${BASE}/en/originals`, options?.signal);
    const cards = parseCards(html, options?.limit ?? 30);
    if (!cards.length) throw new UnexpectedPageError('Webtoon');
    return cards;
  }

  async search(query: string, options?: SearchOptions): Promise<MangaSearchResult[]> {
    const html = await getHTML(
      `${BASE}/en/search?keyword=${encodeURIComponent(query)}`,
      options?.signal,
    );
    return checked(parseCards(html, options?.limit ?? 30), html);
  }

  async getMangaDetails(externalId: string, options?: CallOptions): Promise<MangaDetails> {
    const { genre, slug, titleNo } = parseId(externalId);
    const html = await getHTML(
      `${BASE}/en/${genre}/${slug}/list?title_no=${titleNo}`,
      options?.signal,
    );
    const title =
      html.match(/property="og:title"\s+content="([^"]+)"/)?.[1] ??
      html.match(/<h1[^>]*class="subj"[^>]*>([^<]+)/)?.[1];
    if (!title || !isWebtoonPage(html)) throw new UnexpectedPageError('Webtoon');
    const coverUrl = html.match(/property="og:image"\s+content="([^"]+)"/)?.[1];
    const description = html.match(/property="og:description"\s+content="([^"]+)"/)?.[1];
    const author = html.match(/class="author"[^>]*>([^<]+)/)?.[1]?.trim();
    const genreLabel = html.match(/class="genre[^"]*"[^>]*>([^<]+)/)?.[1]?.trim();
    return {
      sourceId: 'webtoon',
      externalId,
      title: title.trim() || slug,
      coverUrl,
      description: description?.trim(),
      authors: author ? [author] : undefined,
      genres: genreLabel ? [genreLabel] : undefined,
      languages: ['en'],
    };
  }

  async getChapters(externalId: string, _lang?: string, options?: CallOptions): Promise<Chapter[]> {
    const { titleNo } = parseId(externalId);
    const json = await fetchJSON<{ result?: { episodeList?: Episode[] } }>(
      `${MOBILE_API}/webtoon/${titleNo}/episodes?pageSize=1000`,
      {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: options?.signal,
        label: 'Webtoon episodes',
      },
    );
    const episodes = json.result?.episodeList;
    // A changed response shape must surface as an error, not as "no chapters".
    if (!Array.isArray(episodes)) throw new Error('Webtoon: unexpected episodes response');
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

  async getChapterPages(chapterId: string, options?: CallOptions): Promise<ChapterPage[]> {
    const [titleNo, episodeNo] = chapterId.split(SEP);
    // The viewer only needs the query params; the path segments are ignored.
    const html = await getHTML(
      `${BASE}/en/x/x/_/viewer?title_no=${titleNo}&episode_no=${episodeNo}`,
      options?.signal,
    );
    const seen = new Set<string>();
    const pages: ChapterPage[] = [];
    // Each slice tag declares its size (width="700" height="1140.0").
    for (const m of html.matchAll(/<img[^>]*class="_images"[^>]*>/g)) {
      const tag = m[0];
      const url = tag.match(/data-url="(https:\/\/[^"]+)"/)?.[1];
      if (!url || seen.has(url)) continue;
      seen.add(url);
      pages.push({
        index: pages.length,
        imageUrl: url,
        width: attrNum(tag, 'width'),
        height: attrNum(tag, 'height'),
        headers: IMG_HEADERS,
      });
    }
    return checked(pages, html);
  }
}
