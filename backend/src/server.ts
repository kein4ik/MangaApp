import cors from '@fastify/cors';
import Fastify from 'fastify';

import { bestMatch } from './match.js';
import { cache, TTL } from './services/cache.js';
import { health } from './services/health.js';
import { SourceError, SourceManager, SourceRegistry } from './sources/registry.js';
import type { SourceInfo } from './types.js';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

// Map SourceError -> clean HTTP status; everything else -> 502 (bad upstream).
app.setErrorHandler((err, _req, reply) => {
  if (err instanceof SourceError) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  app.log.error(err);
  const detail = err instanceof Error ? err.message : 'unknown';
  return reply.code(502).send({ error: 'Upstream source error', detail });
});

// --- GET /sources : list + capabilities + live health ---
app.get('/sources', async () => {
  const sources: SourceInfo[] = SourceRegistry.all().map((p) => ({
    id: p.id,
    name: p.name,
    languages: p.languages,
    type: p.type,
    supportsSearch: p.supportsSearch,
    supportsReading: p.supportsReading,
    status: health.status(p.id),
  }));
  return { sources };
});

// --- GET /manga/trending?source=&lang= ---
app.get<{
  Querystring: { source?: string; lang?: string; sort?: 'popular' | 'latest'; limit?: string };
}>('/manga/trending', async (req) => {
  const sourceId = req.query.source ?? 'mangadex';
  const lang = req.query.lang;
  const sort = req.query.sort === 'latest' ? 'latest' : 'popular';
  const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 100);
  const provider = SourceManager.require(sourceId);
  const data = await cache.wrap(
    `trending:${sourceId}:${lang ?? ''}:${sort}:${limit}`,
    TTL.trending,
    () => provider.trending({ lang, sort, limit }),
  );
  return { sourceId, results: data };
});

// --- GET /manga/match?q=&exclude= : find the same title on other sources ---
app.get<{ Querystring: { q?: string; exclude?: string } }>('/manga/match', async (req) => {
  const q = (req.query.q ?? '').trim();
  const exclude = req.query.exclude;
  if (!q) return { matches: [] };

  return cache.wrap(`match:${exclude ?? ''}:${q}`, TTL.search, async () => {
    const targets = SourceRegistry.all().filter(
      (p) => p.supportsReading && p.supportsSearch && p.id !== exclude,
    );
    const found = await Promise.all(
      targets.map(async (provider) => {
        try {
          const results = await provider.search(q, { limit: 6 });
          const hit = bestMatch(q, results);
          if (!hit) return null;
          return {
            sourceId: provider.id,
            externalId: hit.externalId,
            title: hit.title,
            coverUrl: hit.coverUrl,
            status: hit.status,
          };
        } catch {
          return null; // a down/slow source shouldn't fail the whole match
        }
      }),
    );
    return { matches: found.filter((m) => m !== null) };
  });
});

// --- GET /manga/search?source=&q=&lang= ---
app.get<{ Querystring: { source?: string; q?: string; lang?: string } }>(
  '/manga/search',
  async (req) => {
    const sourceId = req.query.source ?? 'mangadex';
    const q = (req.query.q ?? '').trim();
    const lang = req.query.lang;
    if (!q) return { sourceId, results: [] };
    const provider = SourceManager.require(sourceId);
    const data = await cache.wrap(`search:${sourceId}:${lang ?? ''}:${q}`, TTL.search, () =>
      provider.search(q, { lang }),
    );
    return { sourceId, results: data };
  },
);

// --- GET /manga/:sourceId/:externalId ---
app.get<{ Params: { sourceId: string; externalId: string } }>(
  '/manga/:sourceId/:externalId',
  async (req) => {
    const { sourceId, externalId } = req.params;
    const provider = SourceManager.require(sourceId);
    const data = await cache.wrap(`details:${sourceId}:${externalId}`, TTL.details, () =>
      provider.getMangaDetails(externalId),
    );
    return data;
  },
);

// --- GET /manga/:sourceId/:externalId/chapters?lang= ---
app.get<{ Params: { sourceId: string; externalId: string }; Querystring: { lang?: string } }>(
  '/manga/:sourceId/:externalId/chapters',
  async (req) => {
    const { sourceId, externalId } = req.params;
    const lang = req.query.lang ?? 'en';
    const provider = SourceManager.require(sourceId);
    const data = await cache.wrap(
      `chapters:${sourceId}:${externalId}:${lang}`,
      TTL.chapters,
      () => provider.getChapters(externalId, lang),
    );
    return { sourceId, externalId, language: lang, chapters: data };
  },
);

// --- GET /chapter/:sourceId/:chapterId/pages ---
app.get<{ Params: { sourceId: string; chapterId: string } }>(
  '/chapter/:sourceId/:chapterId/pages',
  async (req) => {
    const { sourceId, chapterId } = req.params;
    const provider = SourceManager.requireReadable(sourceId);
    // Short TTL: at-home URLs are temporary, don't serve stale links.
    const data = await cache.wrap(`pages:${sourceId}:${chapterId}`, TTL.pages, () =>
      provider.getChapterPages(chapterId),
    );
    return { sourceId, chapterId, pages: data };
  },
);

// --- GET /healthz : process + per-source snapshot ---
app.get('/healthz', async () => ({
  ok: true,
  sources: SourceRegistry.all().map((p) => ({ id: p.id, ...health.snapshot(p.id) })),
}));

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';

health.start(SourceRegistry.all());

app
  .listen({ port: PORT, host: HOST })
  .then(() => app.log.info(`MangaApp backend on http://${HOST}:${PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
