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
  // Reaching (almost) the end marks the chapter read. Use UPSERT so an existing
  // `read` flag is never cleared by a later save that starts from the top.
  const read = p.percent >= 0.9 ? 1 : 0;
  await db.runAsync(
    `INSERT INTO reading_progress
      (source_id, manga_external_id, chapter_id, chapter_number, language, page_index, percent, updated_at, dirty_for_sync, read)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(source_id, manga_external_id, chapter_id) DO UPDATE SET
       chapter_number = excluded.chapter_number,
       language = excluded.language,
       page_index = excluded.page_index,
       percent = excluded.percent,
       updated_at = excluded.updated_at,
       dirty_for_sync = 1,
       read = MAX(reading_progress.read, excluded.read)`,
    p.sourceId,
    p.mangaExternalId,
    p.chapterId,
    p.chapterNumber ?? null,
    p.language ?? null,
    p.pageIndex,
    p.percent,
    now,
    read,
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
 * Explicitly mark chapters read/unread (the Mark-as-read buttons). Creates a
 * row for chapters with no progress yet. Doesn't touch library last_read_at, so
 * bookkeeping never hijacks the Continue Reading order.
 */
export async function markChaptersRead(
  sourceId: string,
  mangaExternalId: string,
  chapters: { chapterId: string; chapterNumber?: string }[],
  read: boolean,
): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  const flag = read ? 1 : 0;
  for (const c of chapters) {
    await db.runAsync(
      `INSERT INTO reading_progress
        (source_id, manga_external_id, chapter_id, chapter_number, page_index, percent, updated_at, dirty_for_sync, read)
       VALUES (?, ?, ?, ?, 0, ?, ?, 1, ?)
       ON CONFLICT(source_id, manga_external_id, chapter_id) DO UPDATE SET
         read = excluded.read, dirty_for_sync = 1`,
      sourceId,
      mangaExternalId,
      c.chapterId,
      c.chapterNumber ?? null,
      flag, // percent: 1 when marking read, 0 when unread (only on first insert)
      now,
      flag,
    );
  }
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
 * Record that several source entries are the same work. Reuses an existing
 * group if any member already has one (merging), otherwise mints a new id.
 * Linking is non-destructive: source rows keep working on their own.
 */
export async function linkWork(members: LinkInput[]): Promise<string | null> {
  if (members.length < 2) return null;
  const db = await getDb();

  let groupId: string | null = null;
  for (const m of members) {
    const existing = await getGroupId(m.sourceId, m.externalId);
    if (existing) {
      groupId = existing;
      break;
    }
  }
  if (!groupId) groupId = genGroupId();

  for (const m of members) {
    await db.runAsync(
      `INSERT OR REPLACE INTO work_source
        (group_id, source_id, external_id, language, confidence, is_primary)
       VALUES (?, ?, ?, ?, ?, ?)`,
      groupId,
      m.sourceId,
      m.externalId,
      m.language ?? null,
      m.confidence ?? 1,
      m.primary ? 1 : 0,
    );
  }
  return groupId;
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
  const rows = await db.getAllAsync<LibraryRow>(
    `SELECT l.source_id, l.manga_external_id AS external_id, l.favorite, l.status, l.last_read_at,
            m.title, m.cover_url,
            p.chapter_id, p.chapter_number, p.language, p.percent
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
