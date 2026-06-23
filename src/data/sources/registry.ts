import { MangabuffProvider } from './providers/mangabuff';
import { MangaDexProvider } from './providers/mangadex';
import { MangaLibProvider } from './providers/mangalib';
import { MangapillProvider } from './providers/mangapill';
import { RemangaProvider } from './providers/remanga';
import type { SourceProvider } from './SourceProvider';
import type { SourceInfo } from './types';

/**
 * The one place that lists which providers exist. They run on-device, so adding
 * a source = one new class here. No backend, works anywhere.
 */
const providers: SourceProvider[] = [
  new MangaDexProvider(),
  new MangapillProvider(),
  new MangaLibProvider(),
  new RemangaProvider(),
  new MangabuffProvider(),
];

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

/** Capabilities for the Sources tab. Status is static online on-device — actual
 * reachability surfaces as query errors when a source is down/blocked. */
export function sourcesInfo(): SourceInfo[] {
  return providers.map((p) => ({
    id: p.id,
    name: p.name,
    languages: p.languages,
    type: p.type,
    supportsSearch: p.supportsSearch,
    supportsReading: p.supportsReading,
    status: 'online',
  }));
}
