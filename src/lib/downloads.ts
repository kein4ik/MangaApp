import { Directory, File, Paths } from 'expo-file-system';

import {
  addDownload,
  clearDownloadsTable,
  getDownload,
  getMangaDownloadRows,
  removeDownload,
  removeMangaDownloads,
  type DownloadRow,
} from '@/data/local/db';
import { REMOVED_SOURCES } from '@/data/sources/removed';
import type { ChapterPage } from '@/data/sources/types';

import { createLimiter, mapLimit } from './pool';

/**
 * Offline chapter storage under <documents>/downloads/{source}/{manga}/{chapter}.
 * Files are written first and the DB row last, so an interrupted download never
 * looks complete; a failed one removes its partial files.
 */

/** djb2 — tiny stable hash so sanitized names stay unique after munging. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Composite ids contain '/', '~' etc. — make a filesystem-safe unique folder name. */
const safe = (s: string) => `${s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40)}-${hash(s)}`;

const root = () => new Directory(Paths.document, 'downloads');

const mangaDir = (sourceId: string, mangaExternalId: string) =>
  new Directory(root(), sourceId, safe(mangaExternalId));

const chapterDir = (sourceId: string, mangaExternalId: string, chapterId: string) =>
  new Directory(mangaDir(sourceId, mangaExternalId), safe(chapterId));

type LocalPage = { file: string; width?: number; height?: number };

const extOf = (url: string) =>
  url.match(/\.(jpe?g|png|webp|gif)(?:[?#]|$)/i)?.[1]?.toLowerCase() ?? 'jpg';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Chapters download one at a time: tapping ⬇ on ten chapters queues them
// instead of firing 30 parallel image downloads that starve the reader and get
// the phone rate-limited by the source.
const chapterQueue = createLimiter(1);

export function downloadChapterPages(args: {
  sourceId: string;
  mangaExternalId: string;
  chapterId: string;
  chapterNumber?: string | null;
  language: string;
  pages: ChapterPage[];
  onProgress?: (done: number, total: number) => void;
}): Promise<void> {
  return chapterQueue(() => runDownload(args));
}

/** One page, with a single retry — a flaky CDN hiccup shouldn't sink the chapter. */
async function downloadPage(page: ChapterPage, file: File): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      if (file.exists) file.delete();
      await File.downloadFileAsync(
        page.imageUrl,
        file,
        page.headers ? { headers: page.headers } : undefined,
      );
      return;
    } catch (e) {
      if (attempt >= 1) throw e;
      await sleep(800);
    }
  }
}

async function runDownload(args: Parameters<typeof downloadChapterPages>[0]): Promise<void> {
  const { sourceId, mangaExternalId, chapterId, pages } = args;
  if (pages.length === 0) throw new Error('No pages to download');
  const dir = chapterDir(sourceId, mangaExternalId, chapterId);
  dir.create({ intermediates: true, idempotent: true });

  const saved: LocalPage[] = new Array(pages.length);
  let done = 0;
  args.onProgress?.(0, pages.length);
  try {
    // A few pages at a time. mapLimit stops starting pages after a failure and
    // only rejects once the in-flight ones settle, so no progress ticks or file
    // writes happen after we report the failure.
    await mapLimit(pages, 3, async (p) => {
      const name = `${String(p.index).padStart(3, '0')}.${extOf(p.imageUrl)}`;
      await downloadPage(p, new File(dir, name));
      saved[p.index] = { file: name, width: p.width, height: p.height };
      done += 1;
      args.onProgress?.(done, pages.length);
    });
  } catch (e) {
    // Don't leave invisible partial files behind (they'd eat storage without
    // showing up anywhere) — unless a complete earlier copy is still recorded.
    if (!(await getDownload(sourceId, chapterId))) {
      try {
        deleteDir(dir.uri);
      } catch {
        // Best effort; "Clear downloads" wipes the whole folder anyway.
      }
    }
    throw e;
  }

  await addDownload({
    source_id: sourceId,
    manga_external_id: mangaExternalId,
    chapter_id: chapterId,
    chapter_number: args.chapterNumber ?? null,
    language: args.language,
    dir: dir.uri,
    pages: JSON.stringify(saved.filter(Boolean)),
    bytes: dir.size ?? 0,
  });
}

/**
 * Reader-ready pages (file:// URIs) for a stored download, or null when any file
 * is missing (cleared by the OS, deleted by hand) — the caller then falls back
 * to the network instead of showing blank pages.
 */
export function localPages(row: DownloadRow): ChapterPage[] | null {
  const list = JSON.parse(row.pages) as LocalPage[];
  if (list.length === 0) return null;
  // Rebuild the folder from ids first: an absolute path saved earlier can go
  // stale when the app container moves (iOS does this on updates).
  const rebuilt = chapterDir(row.source_id, row.manga_external_id, row.chapter_id);
  const dir = rebuilt.exists ? rebuilt : new Directory(row.dir);
  const pages: ChapterPage[] = [];
  for (let index = 0; index < list.length; index++) {
    const file = new File(dir, list[index].file);
    if (!file.exists) return null;
    pages.push({ index, imageUrl: file.uri, width: list[index].width, height: list[index].height });
  }
  return pages;
}

/** Delete a directory tree. Throws only if it's still there afterwards. */
function deleteDir(uri: string) {
  try {
    const dir = new Directory(uri);
    if (dir.exists) dir.delete();
  } catch (e) {
    if (new Directory(uri).exists) throw e;
  }
}

export async function deleteChapterDownload(sourceId: string, chapterId: string): Promise<void> {
  const row = await getDownload(sourceId, chapterId);
  if (!row) return;
  // If the files can't be removed, keep the row so the space stays visible
  // (and deletable) instead of silently orphaning it.
  deleteDir(chapterDir(row.source_id, row.manga_external_id, row.chapter_id).uri);
  deleteDir(row.dir);
  await removeDownload(sourceId, chapterId);
}

export async function deleteMangaDownloads(
  sourceId: string,
  mangaExternalId: string,
): Promise<void> {
  const rows = await getMangaDownloadRows(sourceId, mangaExternalId);
  // The whole title folder — also sweeps partial chapters no row points to.
  deleteDir(mangaDir(sourceId, mangaExternalId).uri);
  for (const r of rows) deleteDir(r.dir);
  await removeMangaDownloads(sourceId, mangaExternalId);
}

export async function clearAllDownloads(): Promise<void> {
  deleteDir(root().uri);
  await clearDownloadsTable();
}

/** Chapters saved from sources taken out of the app (the db drops their rows). */
export function deleteRemovedSourceFiles(): void {
  for (const id of REMOVED_SOURCES) {
    try {
      deleteDir(new Directory(root(), id).uri);
    } catch {
      // Still there — the next start tries again.
    }
  }
}
