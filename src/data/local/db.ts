import * as SQLite from 'expo-sqlite';

/**
 * Local offline-first store. Holds what must open fast and work even when a
 * source is down: cached manga, reading progress, library. `dirty_for_sync`
 * columns are here from day one so a future SyncService (Phase 4) can push
 * local changes to the backend.
 */

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function init(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('mangaapp.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS cached_manga (
      source_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      title TEXT NOT NULL,
      cover_url TEXT,
      description TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (source_id, external_id)
    );

    CREATE TABLE IF NOT EXISTS reading_progress (
      source_id TEXT NOT NULL,
      manga_external_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      chapter_number TEXT,
      language TEXT,
      page_index INTEGER NOT NULL DEFAULT 0,
      percent REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      dirty_for_sync INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (source_id, manga_external_id, chapter_id)
    );

    CREATE TABLE IF NOT EXISTS library_items (
      source_id TEXT NOT NULL,
      manga_external_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'reading',
      favorite INTEGER NOT NULL DEFAULT 0,
      last_read_at INTEGER,
      dirty_for_sync INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (source_id, manga_external_id)
    );
  `);

  // Migration: add the language column to older databases that predate it.
  const cols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(reading_progress)`,
  );
  if (!cols.some((c) => c.name === 'language')) {
    await db.execAsync(`ALTER TABLE reading_progress ADD COLUMN language TEXT`);
  }

  return db;
}

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = init();
  return dbPromise;
}

// ---- cached_manga ----
export type CachedManga = {
  source_id: string;
  external_id: string;
  title: string;
  cover_url: string | null;
  description: string | null;
};

export async function cacheManga(m: CachedManga): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO cached_manga
      (source_id, external_id, title, cover_url, description, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    m.source_id,
    m.external_id,
    m.title,
    m.cover_url,
    m.description,
    Date.now(),
  );
}

// ---- reading_progress ----
export type ProgressRow = {
  source_id: string;
  manga_external_id: string;
  chapter_id: string;
  chapter_number: string | null;
  language: string | null;
  page_index: number;
  percent: number;
  updated_at: number;
};

export async function saveProgress(p: {
  sourceId: string;
  mangaExternalId: string;
  chapterId: string;
  chapterNumber?: string;
  language?: string;
  pageIndex: number;
  percent: number;
}): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT OR REPLACE INTO reading_progress
      (source_id, manga_external_id, chapter_id, chapter_number, language, page_index, percent, updated_at, dirty_for_sync)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    p.sourceId,
    p.mangaExternalId,
    p.chapterId,
    p.chapterNumber ?? null,
    p.language ?? null,
    p.pageIndex,
    p.percent,
    now,
  );
  // Touch the library row so "Continue Reading" can order by recency.
  await db.runAsync(
    `UPDATE library_items SET last_read_at = ?, dirty_for_sync = 1
     WHERE source_id = ? AND manga_external_id = ?`,
    now,
    p.sourceId,
    p.mangaExternalId,
  );
}

export async function getMangaProgress(
  sourceId: string,
  mangaExternalId: string,
): Promise<ProgressRow | null> {
  const db = await getDb();
  return db.getFirstAsync<ProgressRow>(
    `SELECT * FROM reading_progress
     WHERE source_id = ? AND manga_external_id = ?
     ORDER BY updated_at DESC LIMIT 1`,
    sourceId,
    mangaExternalId,
  );
}

/** Wipe all reading progress (Continue Reading + per-chapter positions). */
export async function clearReadingProgress(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`DELETE FROM reading_progress`);
}

/** Remove every title from the library (keeps reading progress). */
export async function clearLibrary(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`DELETE FROM library_items`);
}

// ---- library_items ----

export async function getLibraryStatus(
  sourceId: string,
  mangaExternalId: string,
): Promise<{ inLibrary: boolean; favorite: boolean }> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ favorite: number }>(
    `SELECT favorite FROM library_items WHERE source_id = ? AND manga_external_id = ?`,
    sourceId,
    mangaExternalId,
  );
  return { inLibrary: !!row, favorite: (row?.favorite ?? 0) === 1 };
}

/** Toggle favourite, adding the title to the library if it isn't there yet. */
export async function setFavorite(
  sourceId: string,
  mangaExternalId: string,
  favorite: boolean,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO library_items
      (source_id, manga_external_id, status, favorite, last_read_at, dirty_for_sync)
     VALUES (?, ?, 'reading', 0, ?, 1)`,
    sourceId,
    mangaExternalId,
    Date.now(),
  );
  await db.runAsync(
    `UPDATE library_items SET favorite = ?, dirty_for_sync = 1
     WHERE source_id = ? AND manga_external_id = ?`,
    favorite ? 1 : 0,
    sourceId,
    mangaExternalId,
  );
}

export async function addToLibrary(sourceId: string, mangaExternalId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO library_items
      (source_id, manga_external_id, status, favorite, last_read_at, dirty_for_sync)
     VALUES (?, ?, 'reading', 0, ?, 1)`,
    sourceId,
    mangaExternalId,
    Date.now(),
  );
}

export async function removeFromLibrary(
  sourceId: string,
  mangaExternalId: string,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `DELETE FROM library_items WHERE source_id = ? AND manga_external_id = ?`,
    sourceId,
    mangaExternalId,
  );
}

/** Library rows joined with their cached manga + latest progress, recent first. */
export async function getLibrary(): Promise<
  {
    source_id: string;
    external_id: string;
    title: string;
    cover_url: string | null;
    favorite: number;
    last_read_at: number | null;
    chapter_number: string | null;
    percent: number | null;
  }[]
> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT l.source_id, l.manga_external_id AS external_id, l.favorite, l.last_read_at,
            m.title, m.cover_url,
            p.chapter_number, p.percent
     FROM library_items l
     JOIN cached_manga m
       ON m.source_id = l.source_id AND m.external_id = l.manga_external_id
     LEFT JOIN reading_progress p
       ON p.source_id = l.source_id AND p.manga_external_id = l.manga_external_id
       AND p.updated_at = (
         SELECT MAX(updated_at) FROM reading_progress
         WHERE source_id = l.source_id AND manga_external_id = l.manga_external_id
       )
     ORDER BY l.last_read_at DESC NULLS LAST`,
  );
}

/** Manga the user has progress in, for the Home "Continue Reading" rail. */
export async function getContinueReading(limit = 12): Promise<
  {
    source_id: string;
    external_id: string;
    title: string;
    cover_url: string | null;
    chapter_id: string;
    chapter_number: string | null;
    language: string | null;
    page_index: number;
    percent: number;
  }[]
> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT p.source_id, p.manga_external_id AS external_id,
            p.chapter_id, p.chapter_number, p.language, p.page_index, p.percent,
            m.title, m.cover_url
     FROM reading_progress p
     JOIN cached_manga m
       ON m.source_id = p.source_id AND m.external_id = p.manga_external_id
     WHERE p.updated_at = (
       SELECT MAX(updated_at) FROM reading_progress
       WHERE source_id = p.source_id AND manga_external_id = p.manga_external_id
     )
     ORDER BY p.updated_at DESC
     LIMIT ?`,
    limit,
  );
}
