import { MangabuffProvider } from './mangabuff.js';
import { MangaDexProvider } from './mangadex.js';
import { MangaLibProvider } from './mangalib.js';
import { MangapillProvider } from './mangapill.js';
import { RemangaProvider } from './remanga.js';
import type { SourceProvider } from './SourceProvider.js';

/**
 * SourceRegistry — the one place that lists which providers exist.
 * Add a source by importing it and pushing it here; routes never change.
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

/** Raised by SourceManager so routes can map it to a clean 4xx. */
export class SourceError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

export const SourceManager = {
  require(sourceId: string): SourceProvider {
    const provider = SourceRegistry.get(sourceId);
    if (!provider) throw new SourceError(`Unknown source: ${sourceId}`, 404);
    return provider;
  },
  requireReadable(sourceId: string): SourceProvider {
    const provider = this.require(sourceId);
    if (!provider.supportsReading) {
      throw new SourceError(`Source ${sourceId} does not support reading`, 422);
    }
    return provider;
  },
};
