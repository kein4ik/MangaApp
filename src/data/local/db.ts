import * as SQLite from 'expo-sqlite';

import { REMOVED_SOURCES } from '@/data/sources/removed';

/**
 * Local offline-first store. Holds what must open fast and work even when a
 * source is down: cached manga, reading progress, library. `dirty_for_sync`
 * columns are here from day one so a future SyncService (Phase 4) can push
 * local changes to the backend.
 */

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function init(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('mangaapp.db');
  // busy_timeout: the headless background task opens its own connection; wait
  // for its write lock instead of failing with "database is locked".
  await db.execAsync(`
    PRAGMA busy_timeout = 5000;
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

    -- Cross-source grouping: the same work on MangaDex/MangaLib/ReManga shares
    -- one group_id, so library/favourite/status/progress are treated as one.
    CREATE TABLE IF NOT EXISTS work_source (
      group_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      language TEXT,
      confidence REAL NOT NULL DEFAULT 1,
      is_primary INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (source_id, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_work_source_group ON work_source (group_id);

    -- Per-work preference: which source + language to default to when opening it.
    CREATE TABLE IF NOT EXISTS work_pref (
      pref_key TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      language TEXT
    );

    -- Remembers (source, title, language) combos that returned zero readable
    -- chapters, so we stop surfacing them in search / "Also available on". Only
    -- written on a SUCCESSFUL empty result, and expires so it self-heals.
    CREATE TABLE IF NOT EXISTS dead_chapters (
      source_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      language TEXT NOT NULL,
      checked_at INTEGER NOT NULL,
      PRIMARY KEY (source_id, external_id, language)
    );

    -- Chapters saved to device storage for offline reading. A row exists only
    -- for COMPLETED downloads (files land first, then the row) — in-flight
    -- progress lives in memory, so a killed app never leaves phantom rows.
    CREATE TABLE IF NOT EXISTS downloads (
      source_id TEXT NOT NULL,
      manga_external_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      chapter_number TEXT,
      language TEXT NOT NULL,
      dir TEXT NOT NULL,
      pages TEXT NOT NULL,
      bytes INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (source_id, chapter_id)
    );
    CREATE INDEX IF NOT EXISTS idx_downloads_manga ON downloads (source_id, manga_external_id);

    -- Highest chapter we've already told the user about, per library title, so
    -- the background checker only fires a notification for genuinely new chapters
    -- (the first sighting of a title records a baseline and stays silent).
    CREATE TABLE IF NOT EXISTS notify_watermark (
      source_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      latest_number TEXT,
      notified_id TEXT,
      checked_at INTEGER NOT NULL,
      PRIMARY KEY (source_id, external_id)
    );
  `);

  // Migration: add the language column to older databases that predate it.
  const cols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(reading_progress)`,
  );
  if (!cols.some((c) => c.name === 'language')) {
    await db.execAsync(`ALTER TABLE reading_progress ADD COLUMN language TEXT`);
  }
  // `read` marks a chapter finished (auto on ~full scroll, or manual mark).
  if (!cols.some((c) => c.name === 'read')) {
    await db.execAsync(`ALTER TABLE reading_progress ADD COLUMN read INTEGER NOT NULL DEFAULT 0`);
  }
  // `opened_at` is set only by the reader, so rows created by "mark as read"
  // (opened_at NULL) can never pose as where the user actually is. Backfill:
  // rows the mark buttons made have page 0 and percent exactly 0 or 1.
  if (!cols.some((c) => c.name === 'opened_at')) {
    await db.execAsync(`
      ALTER TABLE reading_progress ADD COLUMN opened_at INTEGER;
      UPDATE reading_progress SET opened_at = updated_at
        WHERE NOT (page_index = 0 AND (percent = 0 OR percent = 1));
    `);
  }
  // `genres` (JSON array) on cached titles powers the Home "For you" rails.
  const mangaCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(cached_manga)`);
  if (!mangaCols.some((c) => c.name === 'genres')) {
    await db.execAsync(`ALTER TABLE cached_manga ADD COLUMN genres TEXT`);
  }

  await purgeRemovedSources(db);
  return db;
}

/** Tables keyed by a source id — everything a removed source can leave behind. */
const SOURCE_TABLES = [
  'library_items',
  'reading_progress',
  'cached_manga',
  'work_source',
  'work_pref',
  'downloads',
  'dead_chapters',
  'notify_watermark',
] as const;

/**
 * Drop every row of a source taken out of the app (their titles can't load any
 * more). A work also linked to another source stays in the library through that
 * link: the other entry gets the library row and, if it was never opened on its
 * own, the title text to show. Reading positions can't move (chapter ids are
 * per source) and go with the source. A cheap no-op once clean.
 */
async function purgeRemovedSources(db: SQLite.SQLiteDatabase): Promise<void> {
  const ids = [...REMOVED_SOURCES];
  if (!ids.length) return;
  const list = ids.map(() => '?').join(', ');

  let stale = false;
  for (const table of SOURCE_TABLES) {
    if (await db.getFirstAsync(`SELECT 1 FROM ${table} WHERE source_id IN (${list}) LIMIT 1`, ...ids)) {
      stale = true;
      break;
    }
  }
  if (!stale) return;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR IGNORE INTO library_items
        (source_id, manga_external_id, status, favorite, last_read_at, dirty_for_sync)
       SELECT o.source_id, o.external_id, l.status, l.favorite, l.last_read_at, 1
       FROM library_items l
       JOIN work_source w ON w.source_id = l.source_id AND w.external_id = l.manga_external_id
       JOIN work_source o ON o.group_id = w.group_id AND o.source_id NOT IN (${list})
       WHERE l.source_id IN (${list})`,
      ...ids,
      ...ids,
    );
    // No cover: the removed source's image host is what's unreachable.
    await db.runAsync(
      `INSERT OR IGNORE INTO cached_manga
        (source_id, external_id, title, cover_url, description, genres, updated_at)
       SELECT o.source_id, o.external_id, m.title, NULL, m.description, m.genres, m.updated_at
       FROM cached_manga m
       JOIN work_source w ON w.source_id = m.source_id AND w.external_id = m.external_id
       JOIN work_source o ON o.group_id = w.group_id AND o.source_id NOT IN (${list})
       WHERE m.source_id IN (${list})`,
      ...ids,
      ...ids,
    );
    for (const table of SOURCE_TABLES) {
      await db.runAsync(`DELETE FROM ${table} WHERE source_id IN (${list})`, ...ids);
    }
    // Prefs of works never linked are keyed `source:external`.
    for (const id of ids) {
      await db.runAsync(`DELETE FROM work_pref WHERE pref_key LIKE ?`, `${id}:%`);
    }
  });
}

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = init().catch((e) => {
      // Don't cache a failed open (a transient lock, a crash mid-migration) —
      // the next call gets a fresh attempt instead of the same error forever.
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

// Our multi-statement writes run one at a time: expo-sqlite's transactions
// share the connection, so two overlapping BEGINs would fail.
let txChain: Promise<unknown> = Promise.resolve();

/** Run `task` inside a transaction (atomic + one fsync instead of hundreds). */
async function inTransaction<T>(task: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  const db = await getDb();
  const run = txChain.then(async () => {
    let result!: T;
    await db.withTransactionAsync(async () => {
      result = await task(db);
    });
    return result;
  });
  txChain = run.catch(() => {});
  return run;
}

// ---- cached_manga ----
export type CachedManga = {
  source_id: string;
  external_id: string;
  title: string;
  cover_url: string | null;
  description: string | null;
  /** Genre names as the source reports them (JSON array in the DB). */
  genres?: string[] | null;
};

export async function cacheManga(m: CachedManga): Promise<void> {
  const db = await getDb();
  // COALESCE keeps previously-stored genres when a caller (e.g. the library
  // mutations, which only know the search-result shape) passes none — only
  // getMangaDetails actually knows genres, and a favorite toggle must not wipe them.
  await db.runAsync(
    `INSERT OR REPLACE INTO cached_manga
      (source_id, external_id, title, cover_url, description, genres, updated_at)
     VALUES (?, ?, ?, ?, ?,
             COALESCE(?, (SELECT genres FROM cached_manga WHERE source_id = ? AND external_id = ?)),
             ?)`,
    m.source_id,
    m.external_id,
    m.title,
    m.cover_url,
    m.description,
    m.genres && m.genres.length ? JSON.stringify(m.genres) : null,
    m.source_id,
    m.external_id,
    Date.now(),
  );
}

export type CachedMangaRow = {
  source_id: string;
  external_id: string;
  title: string;
  cover_url: string | null;
  description: string | null;
  /** JSON array of genre names. */
  genres: string | null;
};

/** The locally cached title info — lets a title page open without network. */
export async function getCachedManga(
  sourceId: string,
  externalId: string,
): Promise<CachedMangaRow | null> {
  const db = await getDb();
  return db.getFirstAsync<CachedMangaRow>(
    `SELECT source_id, external_id, title, cover_url, description, genres
     FROM cached_manga WHERE source_id = ? AND external_id = ?`,
    sourceId,
    externalId,
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
  read: number;
  /** When the reader last had this chapter open; null = only marked read/unread. */
  opened_at: number | null;
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
  // Reaching (almost) the end marks the chapter read. Use UPSERT so an existing
  // `read` flag is never cleared by a later save that starts from the top.
  const read = p.percent >= 0.9 ? 1 : 0;
  await db.runAsync(
    `INSERT INTO reading_progress
      (source_id, manga_external_id, chapter_id, chapter_number, language, page_index, percent, updated_at, dirty_for_sync, read, opened_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(source_id, manga_external_id, chapter_id) DO UPDATE SET
       chapter_number = excluded.chapter_number,
       language = excluded.language,
       page_index = excluded.page_index,
       percent = excluded.percent,
       updated_at = excluded.updated_at,
       dirty_for_sync = 1,
       read = MAX(reading_progress.read, excluded.read),
       opened_at = excluded.opened_at`,
    p.sourceId,
    p.mangaExternalId,
    p.chapterId,
    p.chapterNumber ?? null,
    p.language ?? null,
    p.pageIndex,
    p.percent,
    now,
    read,
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

// "Where the user is" for a title: the chapter the reader had open most
// recently; only when nothing was ever opened, the highest marked chapter.
const LATEST_PROGRESS_ORDER = `(opened_at IS NULL), opened_at DESC, updated_at DESC,
  CAST(chapter_number AS REAL) DESC`;

export async function getMangaProgress(
  sourceId: string,
  mangaExternalId: string,
): Promise<ProgressRow | null> {
  const db = await getDb();
  return db.getFirstAsync<ProgressRow>(
    `SELECT * FROM reading_progress
     WHERE source_id = ? AND manga_external_id = ?
     ORDER BY ${LATEST_PROGRESS_ORDER} LIMIT 1`,
    sourceId,
    mangaExternalId,
  );
}

/** Chapter ids the user has finished/marked read for a title. */
export async function getReadChapterIds(
  sourceId: string,
  mangaExternalId: string,
): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ chapter_id: string }>(
    `SELECT chapter_id FROM reading_progress
     WHERE source_id = ? AND manga_external_id = ? AND read = 1`,
    sourceId,
    mangaExternalId,
  );
  return rows.map((r) => r.chapter_id);
}

// ---- downloads (offline chapters) ----
export type DownloadRow = {
  source_id: string;
  manga_external_id: string;
  chapter_id: string;
  chapter_number: string | null;
  language: string;
  /** file:// URI of the chapter's directory. */
  dir: string;
  /** JSON array of { file, width?, height? } in page order. */
  pages: string;
  bytes: number;
  created_at: number;
};

export async function addDownload(row: Omit<DownloadRow, 'created_at'>): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO downloads
      (source_id, manga_external_id, chapter_id, chapter_number, language, dir, pages, bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.source_id,
    row.manga_external_id,
    row.chapter_id,
    row.chapter_number,
    row.language,
    row.dir,
    row.pages,
    row.bytes,
    Date.now(),
  );
}

export async function getDownload(
  sourceId: string,
  chapterId: string,
): Promise<DownloadRow | null> {
  const db = await getDb();
  return (
    (await db.getFirstAsync<DownloadRow>(
      `SELECT * FROM downloads WHERE source_id = ? AND chapter_id = ?`,
      sourceId,
      chapterId,
    )) ?? null
  );
}

export async function getDownloadedChapterIds(
  sourceId: string,
  mangaExternalId: string,
): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ chapter_id: string }>(
    `SELECT chapter_id FROM downloads WHERE source_id = ? AND manga_external_id = ?`,
    sourceId,
    mangaExternalId,
  );
  return rows.map((r) => r.chapter_id);
}

/** A title's downloaded chapters, for the offline chapter list. */
export async function getMangaDownloadChapters(
  sourceId: string,
  mangaExternalId: string,
): Promise<{ chapter_id: string; chapter_number: string | null; language: string }[]> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT chapter_id, chapter_number, language FROM downloads
     WHERE source_id = ? AND manga_external_id = ?
     ORDER BY CAST(chapter_number AS REAL), created_at`,
    sourceId,
    mangaExternalId,
  );
}

export type DownloadedManga = {
  source_id: string;
  manga_external_id: string;
  title: string;
  cover_url: string | null;
  chapters: number;
  bytes: number;
  latest_at: number;
};

/** Downloads grouped per title (joined with the cached title/cover), newest first. */
export async function getDownloadedManga(): Promise<DownloadedManga[]> {
  const db = await getDb();
  return db.getAllAsync<DownloadedManga>(
    `SELECT d.source_id, d.manga_external_id,
            COALESCE(m.title, d.manga_external_id) AS title, m.cover_url,
            COUNT(*) AS chapters, SUM(d.bytes) AS bytes, MAX(d.created_at) AS latest_at
     FROM downloads d
     LEFT JOIN cached_manga m
       ON m.source_id = d.source_id AND m.external_id = d.manga_external_id
     GROUP BY d.source_id, d.manga_external_id
     ORDER BY latest_at DESC`,
  );
}

export async function getMangaDownloadRows(
  sourceId: string,
  mangaExternalId: string,
): Promise<{ chapter_id: string; dir: string }[]> {
  const db = await getDb();
  return db.getAllAsync<{ chapter_id: string; dir: string }>(
    `SELECT chapter_id, dir FROM downloads WHERE source_id = ? AND manga_external_id = ?`,
    sourceId,
    mangaExternalId,
  );
}

export async function removeDownload(sourceId: string, chapterId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `DELETE FROM downloads WHERE source_id = ? AND chapter_id = ?`,
    sourceId,
    chapterId,
  );
}

export async function removeMangaDownloads(
  sourceId: string,
  mangaExternalId: string,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `DELETE FROM downloads WHERE source_id = ? AND manga_external_id = ?`,
    sourceId,
    mangaExternalId,
  );
}

export async function getDownloadsTotalBytes(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(bytes) AS total FROM downloads`,
  );
  return row?.total ?? 0;
}

export async function clearDownloadsTable(): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM downloads`);
}

// ---- notify_watermark (background new-chapter notifications) ----
export type NotifyWatermark = {
  source_id: string;
  external_id: string;
  latest_number: string | null;
  notified_id: string | null;
};

/** Every title's last-notified watermark, for the background chapter checker. */
export async function getNotifyWatermarks(): Promise<NotifyWatermark[]> {
  const db = await getDb();
  return db.getAllAsync<NotifyWatermark>(
    `SELECT source_id, external_id, latest_number, notified_id FROM notify_watermark`,
  );
}

/** Record the newest chapter we've seen/notified for a title. */
export async function setNotifyWatermark(
  sourceId: string,
  externalId: string,
  latestNumber: string | null,
  notifiedId: string | null,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO notify_watermark (source_id, external_id, latest_number, notified_id, checked_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(source_id, external_id)
     DO UPDATE SET latest_number = excluded.latest_number,
                   notified_id = excluded.notified_id,
                   checked_at = excluded.checked_at`,
    sourceId,
    externalId,
    latestNumber,
    notifiedId,
    Date.now(),
  );
}

/** Canonical chapter number so "41", "41.0" and " 41 " all compare equal. */
export function normChapterNumber(num: string | null | undefined): string | null {
  if (num == null) return null;
  const n = Number(num);
  return isFinite(n) ? String(n) : num.trim() || null;
}

/**
 * Read chapter NUMBERS across the whole group, so a chapter read on one source
 * shows as read when you switch to another source of the same work.
 */
export async function getReadChapterNumbers(
  sourceId: string,
  mangaExternalId: string,
): Promise<string[]> {
  const db = await getDb();
  const targets = await groupTargets(sourceId, mangaExternalId);
  const where = targets.map(() => '(source_id = ? AND manga_external_id = ?)').join(' OR ');
  const args = targets.flatMap((t) => [t.sourceId, t.externalId]);
  const rows = await db.getAllAsync<{ chapter_number: string | null }>(
    `SELECT DISTINCT chapter_number FROM reading_progress WHERE read = 1 AND (${where})`,
    ...args,
  );
  const set = new Set<string>();
  for (const r of rows) {
    const n = normChapterNumber(r.chapter_number);
    if (n) set.add(n);
  }
  return [...set];
}

/**
 * Explicitly mark chapters read/unread (the Mark-as-read buttons).
 *
 * Marking creates rows for chapters with no progress yet, but with
 * `opened_at` NULL — so a mark can never pose as the chapter the user is on
 * (Continue Reading) or duplicate the title there. Unmarking only updates rows
 * that exist, and clears the chapter NUMBER across every linked source (and
 * duplicate scanlations), since read state is shared by number.
 */
export async function markChaptersRead(
  sourceId: string,
  mangaExternalId: string,
  chapters: { chapterId: string; chapterNumber?: string }[],
  read: boolean,
  language?: string,
): Promise<void> {
  if (chapters.length === 0) return;
  await inTransaction(async (db) => {
    if (read) {
      const now = Date.now();
      const stmt = await db.prepareAsync(
        `INSERT INTO reading_progress
          (source_id, manga_external_id, chapter_id, chapter_number, language, page_index, percent, updated_at, dirty_for_sync, read, opened_at)
         VALUES (?, ?, ?, ?, ?, 0, 1, ?, 1, 1, NULL)
         ON CONFLICT(source_id, manga_external_id, chapter_id) DO UPDATE SET
           read = 1, dirty_for_sync = 1`,
      );
      try {
        for (const c of chapters) {
          await stmt.executeAsync([
            sourceId,
            mangaExternalId,
            c.chapterId,
            c.chapterNumber ?? null,
            language ?? null,
            now,
          ]);
        }
      } finally {
        await stmt.finalizeAsync();
      }
      return;
    }

    const ids = new Set(chapters.map((c) => c.chapterId));
    const nums = new Set(
      chapters.map((c) => normChapterNumber(c.chapterNumber)).filter((n): n is string => !!n),
    );
    const targets = await groupTargets(sourceId, mangaExternalId);
    const where = targets.map(() => '(source_id = ? AND manga_external_id = ?)').join(' OR ');
    const rows = await db.getAllAsync<{
      source_id: string;
      manga_external_id: string;
      chapter_id: string;
      chapter_number: string | null;
    }>(
      `SELECT source_id, manga_external_id, chapter_id, chapter_number FROM reading_progress
       WHERE read = 1 AND (${where})`,
      ...targets.flatMap((t) => [t.sourceId, t.externalId]),
    );
    for (const r of rows) {
      const own = r.source_id === sourceId && r.manga_external_id === mangaExternalId;
      const n = normChapterNumber(r.chapter_number);
      if ((own && ids.has(r.chapter_id)) || (n && nums.has(n))) {
        await db.runAsync(
          `UPDATE reading_progress SET read = 0, dirty_for_sync = 1
           WHERE source_id = ? AND manga_external_id = ? AND chapter_id = ?`,
          r.source_id,
          r.manga_external_id,
          r.chapter_id,
        );
      }
    }
  });
}

// ---- dead_chapters (known-empty source+title+language) ----

const DEAD_TTL = 5 * 24 * 60 * 60 * 1000; // self-heal after 5 days

/** Record whether a (source, title, language) has readable chapters. Marks it
 * dead when empty, clears it when chapters appear. Call ONLY after a successful
 * fetch — never on a timeout/error, or a glitch would hide a working source. */
export async function markChaptersChecked(
  sourceId: string,
  externalId: string,
  language: string,
  hasChapters: boolean,
): Promise<void> {
  const db = await getDb();
  if (hasChapters) {
    await db.runAsync(
      `DELETE FROM dead_chapters WHERE source_id = ? AND external_id = ? AND language = ?`,
      sourceId,
      externalId,
      language,
    );
  } else {
    await db.runAsync(
      `INSERT OR REPLACE INTO dead_chapters (source_id, external_id, language, checked_at)
       VALUES (?, ?, ?, ?)`,
      sourceId,
      externalId,
      language,
      Date.now(),
    );
  }
}

/** Non-expired dead keys as `source:external:lang`, for client-side filtering. */
export async function getDeadChapterKeys(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ source_id: string; external_id: string; language: string }>(
    `SELECT source_id, external_id, language FROM dead_chapters WHERE checked_at >= ?`,
    Date.now() - DEAD_TTL,
  );
  return rows.map((r) => `${r.source_id}:${r.external_id}:${r.language}`);
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

// ---- work_source (cross-source grouping) ----

export type WorkMember = {
  group_id: string;
  source_id: string;
  external_id: string;
  language: string | null;
  confidence: number;
  is_primary: number;
};

function genGroupId(): string {
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** The group a source entry belongs to, if it has been linked. */
export async function getGroupId(
  sourceId: string,
  externalId: string,
): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ group_id: string }>(
    `SELECT group_id FROM work_source WHERE source_id = ? AND external_id = ?`,
    sourceId,
    externalId,
  );
  return row?.group_id ?? null;
}

/** Every source entry linked to a group. */
export async function getWorkMembers(groupId: string): Promise<WorkMember[]> {
  const db = await getDb();
  return db.getAllAsync<WorkMember>(`SELECT * FROM work_source WHERE group_id = ?`, groupId);
}

export type LinkInput = {
  sourceId: string;
  externalId: string;
  language?: string;
  confidence?: number;
  primary?: boolean;
};

/**
 * Record that several source entries are the same work. If members already
 * belong to groups, those groups are MERGED — every variant of every group
 * moves into one, so none is left behind in an old group. The per-work source
 * preference moves to the surviving group key. All in one transaction.
 * Linking is non-destructive: source rows keep working on their own.
 */
export async function linkWork(members: LinkInput[]): Promise<string | null> {
  if (members.length < 2) return null;
  return inTransaction(async (db) => {
    const groups: string[] = [];
    for (const m of members) {
      const g = await getGroupId(m.sourceId, m.externalId);
      if (g && !groups.includes(g)) groups.push(g);
    }
    const groupId = groups[0] ?? genGroupId();
    const absorbed = groups.slice(1);

    for (const g of absorbed) {
      await db.runAsync(`UPDATE work_source SET group_id = ? WHERE group_id = ?`, groupId, g);
    }
    for (const m of members) {
      await db.runAsync(
        `INSERT INTO work_source
          (group_id, source_id, external_id, language, confidence, is_primary)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_id, external_id) DO UPDATE SET
           group_id = excluded.group_id,
           language = COALESCE(excluded.language, work_source.language),
           confidence = excluded.confidence,
           is_primary = MAX(work_source.is_primary, excluded.is_primary)`,
        groupId,
        m.sourceId,
        m.externalId,
        m.language ?? null,
        m.confidence ?? 1,
        m.primary ? 1 : 0,
      );
    }

    // Prefs were keyed by the old group ids, or by `source:external` for
    // members that weren't grouped yet — keep the first one found (unless the
    // surviving group already has its own) and drop the now-unreachable rest.
    const oldKeys = [...absorbed, ...members.map((m) => `${m.sourceId}:${m.externalId}`)];
    const kept = await db.getFirstAsync<{ pref_key: string }>(
      `SELECT pref_key FROM work_pref WHERE pref_key = ?`,
      groupId,
    );
    if (!kept) {
      for (const key of oldKeys) {
        const moved = await db.runAsync(
          `UPDATE work_pref SET pref_key = ? WHERE pref_key = ?`,
          groupId,
          key,
        );
        if (moved.changes > 0) break;
      }
    }
    await db.runAsync(
      `DELETE FROM work_pref WHERE pref_key IN (${oldKeys.map(() => '?').join(', ')})`,
      ...oldKeys,
    );
    return groupId;
  });
}

/** A work's preferred source+language (what to open by default). Keyed by the
 * group so it applies whichever source you arrive from. */
export type WorkPref = { source_id: string; external_id: string; language: string | null };

async function prefKey(sourceId: string, externalId: string): Promise<string> {
  return (await getGroupId(sourceId, externalId)) ?? `${sourceId}:${externalId}`;
}

export async function getWorkPref(
  sourceId: string,
  externalId: string,
): Promise<WorkPref | null> {
  const db = await getDb();
  return db.getFirstAsync<WorkPref>(
    `SELECT source_id, external_id, language FROM work_pref WHERE pref_key = ?`,
    await prefKey(sourceId, externalId),
  );
}

export async function setWorkPref(
  sourceId: string,
  externalId: string,
  pref: { source: string; external: string; language?: string },
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO work_pref (pref_key, source_id, external_id, language)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(pref_key) DO UPDATE SET
       source_id = excluded.source_id,
       external_id = excluded.external_id,
       language = excluded.language`,
    await prefKey(sourceId, externalId),
    pref.source,
    pref.external,
    pref.language ?? null,
  );
}

/** Source entries (incl. itself) that share a group with the given entry. */
async function groupTargets(
  sourceId: string,
  externalId: string,
): Promise<{ sourceId: string; externalId: string }[]> {
  const groupId = await getGroupId(sourceId, externalId);
  if (!groupId) return [{ sourceId, externalId }];
  const members = await getWorkMembers(groupId);
  const targets = members.map((m) => ({ sourceId: m.source_id, externalId: m.external_id }));
  if (!targets.some((t) => t.sourceId === sourceId && t.externalId === externalId)) {
    targets.push({ sourceId, externalId });
  }
  return targets;
}

// ---- library_items ----

export async function getLibraryStatus(
  sourceId: string,
  mangaExternalId: string,
): Promise<{ inLibrary: boolean; favorite: boolean; status: string | null }> {
  const db = await getDb();
  const groupId = await getGroupId(sourceId, mangaExternalId);

  // Aggregate across the whole group so favourite/status read the same no
  // matter which source you opened the work from.
  if (groupId) {
    const rows = await db.getAllAsync<{ source_id: string; favorite: number; status: string }>(
      `SELECT li.source_id, li.favorite, li.status
       FROM work_source ws
       JOIN library_items li
         ON li.source_id = ws.source_id AND li.manga_external_id = ws.external_id
       WHERE ws.group_id = ?`,
      groupId,
    );
    if (rows.length > 0) {
      const own = rows.find((r) => r.source_id === sourceId);
      return {
        inLibrary: true,
        favorite: rows.some((r) => r.favorite === 1),
        status: own?.status ?? rows[0].status,
      };
    }
  }

  const row = await db.getFirstAsync<{ favorite: number; status: string }>(
    `SELECT favorite, status FROM library_items WHERE source_id = ? AND manga_external_id = ?`,
    sourceId,
    mangaExternalId,
  );
  return { inLibrary: !!row, favorite: (row?.favorite ?? 0) === 1, status: row?.status ?? null };
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

/** Reading-status categories for a library title. */
export type LibraryStatus = 'reading' | 'plan' | 'completed' | 'on_hold' | 'dropped';

export async function setLibraryStatus(
  sourceId: string,
  mangaExternalId: string,
  status: LibraryStatus,
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
    `UPDATE library_items SET status = ?, dirty_for_sync = 1
     WHERE source_id = ? AND manga_external_id = ?`,
    status,
    sourceId,
    mangaExternalId,
  );
}

// ---- group-aware writes ----
// These mirror an action to every linked source so a work's favourite/status/
// membership stay consistent however you reach it. They degrade to the single
// entry when nothing is linked.

export async function setFavoriteForGroup(
  sourceId: string,
  externalId: string,
  favorite: boolean,
): Promise<void> {
  for (const t of await groupTargets(sourceId, externalId)) {
    await setFavorite(t.sourceId, t.externalId, favorite);
  }
}

export async function setLibraryStatusForGroup(
  sourceId: string,
  externalId: string,
  status: LibraryStatus,
): Promise<void> {
  for (const t of await groupTargets(sourceId, externalId)) {
    await setLibraryStatus(t.sourceId, t.externalId, status);
  }
}

export async function addToLibraryForGroup(
  sourceId: string,
  externalId: string,
): Promise<void> {
  for (const t of await groupTargets(sourceId, externalId)) {
    await addToLibrary(t.sourceId, t.externalId);
  }
}

export async function removeFromLibraryForGroup(
  sourceId: string,
  externalId: string,
): Promise<void> {
  for (const t of await groupTargets(sourceId, externalId)) {
    await removeFromLibrary(t.sourceId, t.externalId);
  }
}

export type LibraryRow = {
  source_id: string;
  external_id: string;
  title: string;
  cover_url: string | null;
  /** JSON array of genre names (from cached_manga), null for older cache rows. */
  genres: string | null;
  favorite: number;
  status: string;
  last_read_at: number | null;
  chapter_id: string | null;
  chapter_number: string | null;
  language: string | null;
  percent: number | null;
};

/**
 * Library rows joined with their cached manga + latest progress, recent first.
 * Grouped works collapse to a single entry: the row sorts first (most recently
 * read) becomes the representative, and favourite is OR'd across the group.
 */
export async function getLibrary(): Promise<LibraryRow[]> {
  const db = await getDb();
  // Exactly ONE progress row per title (ROW_NUMBER), so ties in updated_at —
  // e.g. a batch of chapters marked read in the same millisecond — can't
  // multiply rows. Language falls back to any row that recorded one.
  const rows = await db.getAllAsync<LibraryRow>(
    `SELECT l.source_id, l.manga_external_id AS external_id, l.favorite, l.status, l.last_read_at,
            m.title, m.cover_url, m.genres,
            p.chapter_id, p.chapter_number, p.percent,
            COALESCE(p.language, (
              SELECT r.language FROM reading_progress r
              WHERE r.source_id = l.source_id AND r.manga_external_id = l.manga_external_id
                AND r.language IS NOT NULL
              ORDER BY (r.opened_at IS NULL), r.opened_at DESC, r.updated_at DESC LIMIT 1
            )) AS language
     FROM library_items l
     JOIN cached_manga m
       ON m.source_id = l.source_id AND m.external_id = l.manga_external_id
     LEFT JOIN (
       SELECT source_id, manga_external_id, chapter_id, chapter_number, language, percent,
              ROW_NUMBER() OVER (
                PARTITION BY source_id, manga_external_id ORDER BY ${LATEST_PROGRESS_ORDER}
              ) AS rn
       FROM reading_progress
     ) p
       ON p.source_id = l.source_id AND p.manga_external_id = l.manga_external_id AND p.rn = 1
     ORDER BY l.last_read_at DESC NULLS LAST`,
  );

  const links = await db.getAllAsync<{ source_id: string; external_id: string; group_id: string }>(
    `SELECT source_id, external_id, group_id FROM work_source`,
  );
  const groupOf = new Map(links.map((l) => [`${l.source_id}:${l.external_id}`, l.group_id]));

  // Rows are already ordered most-recent-first, so the first row seen for a
  // group is the best representative; later rows only contribute their favourite.
  const byGroup = new Map<string, LibraryRow>();
  const order: string[] = [];
  for (const row of rows) {
    const key = groupOf.get(`${row.source_id}:${row.external_id}`) ?? `${row.source_id}:${row.external_id}`;
    const existing = byGroup.get(key);
    if (!existing) {
      byGroup.set(key, row);
      order.push(key);
    } else if (row.favorite === 1) {
      existing.favorite = 1;
    }
  }
  return order.map((key) => byGroup.get(key)!);
}

/**
 * Manga the user actually read (opened in the reader), one row per title, for
 * the Home "Continue Reading" rail. Chapters only MARKED read don't count —
 * they used to hijack the position and fill the rail with copies of one title.
 */
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
    `SELECT source_id, external_id, chapter_id, chapter_number, language, page_index, percent,
            title, cover_url
     FROM (
       SELECT p.source_id, p.manga_external_id AS external_id,
              p.chapter_id, p.chapter_number, p.language, p.page_index, p.percent, p.opened_at,
              m.title, m.cover_url,
              ROW_NUMBER() OVER (
                PARTITION BY p.source_id, p.manga_external_id ORDER BY p.opened_at DESC
              ) AS rn
       FROM reading_progress p
       JOIN cached_manga m
         ON m.source_id = p.source_id AND m.external_id = p.manga_external_id
       WHERE p.opened_at IS NOT NULL
     )
     WHERE rn = 1
     ORDER BY opened_at DESC
     LIMIT ?`,
    limit,
  );
}
