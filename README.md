# MangaApp

Multi-source manga reader. Mobile app (Expo + React Native + TypeScript) + a
Node/Fastify backend that owns all source logic. Built per
`manga_reader_architecture_plan.pdf`. Current state: **Phase 0–3**.

## What works now

**App**
- **Home** — Trending + Continue Reading, with a source/language switcher.
- **Explore** — debounced search with a cover grid.
- **Manga Details** — cover, info, genres, description, chapter list, add-to-library.
  Read-only sources (e.g. AniList) show an "info only" banner instead of a reader.
- **Reader** — vertical scroll (FlashList), lazy image loading + disk cache,
  tap to toggle chrome, progress bar, keep-awake.
- **Library** — saved titles with reading progress.
- **Source + Language switcher** — pick source and language; live source-health
  badges (online / slow / down / off); switching source resets the language if
  the new source doesn't offer it.
- **Local progress** — SQLite, debounced, survives restarts (offline-first).

**Backend** (`backend/`)
- Provider system: one `SourceProvider` interface, five providers wired up —
  **MangaDex** (`official_api`, reading, ~19 languages), **Mangapill** (EN,
  `scraper` via cheerio, reading), **MangaLib** (RU, `scraper`, reading),
  **Remanga** (RU, `scraper`, reading) and **AniList** (`external_link`, metadata).
- `SourceRegistry` + `SourceManager`, in-memory TTL cache (Redis-ready shape),
  `SourceHealthService` (periodic pings → online/slow/broken), feature flag to
  disable a source via `DISABLED_SOURCES` env.
- Endpoints: `/sources`, `/manga/trending`, `/manga/search`,
  `/manga/:source/:id`, `/manga/:source/:id/chapters`,
  `/chapter/:source/:chapterId/pages`, `/healthz`.

The app talks **only** to the backend — it knows nothing about MangaDex/AniList.

## Run it

Two processes. **Start the backend first.**

```bash
# 1) backend
cd backend
npm install
npm run dev            # http://localhost:4000  (logs the LAN IP too)

# 2) app (new terminal, repo root)
npm install            # .npmrc sets legacy-peer-deps for Expo SDK 56
npx expo start
```

- **Android emulator** reaches the host backend automatically (`10.0.2.2:4000`).
- **iOS simulator / web** use `localhost:4000`.
- **Physical device (Expo Go):** point the app at your machine's LAN IP:
  `EXPO_PUBLIC_API_URL=http://192.168.1.141:4000 npx expo start`
  (the backend prints its LAN IP on startup).

## Architecture

```
backend/src/
  sources/            SourceProvider.ts, mangadex.ts, anilist.ts, registry.ts
  services/           cache.ts (TTL), health.ts (source health)
  server.ts           Fastify routes (the normalized API)
  types.ts            normalized DTOs

src/ (app)
  config.ts                 backend base URL (EXPO_PUBLIC_API_URL)
  data/
    remote/backendClient.ts the app's ONLY door to the backend
    local/db.ts             SQLite: progress, library, cached manga (offline-first)
    queries.ts              TanStack Query hooks
    sources/types.ts        shared DTOs + SourceInfo
  store/                    Zustand: settings (source/lang) + reader settings
  components/               MangaCard, SourceLangBar, BottomSheet, HealthBadge, ...
  theme/                    dark/purple/orange palette
app/                        Expo Router screens (tabs, manga/[id], reader/[chapterId])
```

Add a new source = one new file in `backend/src/sources/` + one line in
`registry.ts`. No app changes, no route changes.

## Notes

- Many popular MangaDex titles are licensed and listed as external links — those
  chapters are skipped (not readable in-app). Fan-scanlated titles read fine.
- **MangaLib** is RU and reads fine (e.g. Tower of God = 655 chapters). It's an
  unofficial API (`scraper` type) so it can rate-limit or change — the health
  badge reflects that. Its images need a Referer header, handled automatically.
- Personal / portfolio use.

## Not built yet (next phases)

- Phase 4: Supabase auth + cloud sync (the `dirty_for_sync` columns are ready).
- Phase 5: downloads / offline chapters.
- Phase 6: new-chapter push notifications (cron worker).
- Phase 7: gestures, paged mode, polish. Redis cache; a real RU provider.
