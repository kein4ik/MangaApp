import { recordSourceCall, sourceStatus } from './health';
import { AsuraProvider } from './providers/asura';
import { MangaDexProvider } from './providers/mangadex';
import { MangaKatanaProvider } from './providers/mangakatana';
import { MangaLibProvider } from './providers/mangalib';
import { MangapillProvider } from './providers/mangapill';
import { RemangaProvider } from './providers/remanga';
import { WebtoonProvider } from './providers/webtoon';
import type { SourceProvider } from './SourceProvider';
import type { SourceInfo } from './types';

/**
 * Wrap a provider so every call is timed and its outcome feeds the live health
 * status (what the source badges show). Pure delegation — behaviour is unchanged.
 */
function withHealth(p: SourceProvider): SourceProvider {
  const track =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const t0 = Date.now();
      try {
        const result = await fn.apply(p, args);
        recordSourceCall(p.id, null, Date.now() - t0);
        return result;
      } catch (e) {
        recordSourceCall(p.id, e, Date.now() - t0);
        throw e;
      }
    };
  return {
    id: p.id,
    name: p.name,
    languages: p.languages,
    type: p.type,
    supportsSearch: p.supportsSearch,
    supportsReading: p.supportsReading,
    trustEmptyChapters: p.trustEmptyChapters,
    trending: track(p.trending),
    search: track(p.search),
    getMangaDetails: track(p.getMangaDetails),
    getChapters: track(p.getChapters),
    getChapterPages: track(p.getChapterPages),
    browseByGenre: p.browseByGenre ? track(p.browseByGenre) : undefined,
  };
}

/**
 * The one place that lists which providers exist. They run on-device, so adding
 * a source = one new class here. No backend, works anywhere.
 */
const providers: SourceProvider[] = [
  new MangaDexProvider(),
  new MangapillProvider(),
  new WebtoonProvider(),
  new AsuraProvider(),
  new MangaKatanaProvider(),
  new MangaLibProvider(),
  new RemangaProvider(),
].map(withHealth);

const byId = new Map(providers.map((p) => [p.id, p]));

export const SourceRegistry = {
  all: (): SourceProvider[] => providers,
  get: (id: string): SourceProvider | undefined => byId.get(id),
};

export const SourceManager = {
  require(sourceId: string): SourceProvider {
    const provider = SourceRegistry.get(sourceId);
    if (!provider) throw new Error(`Unknown source: ${sourceId}`);
    return provider;
  },
};

/** Capabilities + live health (learned from real requests; `unknown` until the
 * source has been used this session). */
export function sourcesInfo(): SourceInfo[] {
  return providers.map((p) => ({
    id: p.id,
    name: p.name,
    languages: p.languages,
    type: p.type,
    supportsSearch: p.supportsSearch,
    supportsReading: p.supportsReading,
    status: sourceStatus(p.id),
  }));
}
