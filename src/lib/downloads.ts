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
import type { ChapterPage } from '@/data/sources/types';

import { mapLimit } from './pool';

/**
 * Offline chapter storage under <documents>/downloads/{source}/{manga}/{chapter}.
 * Files are written first and the DB row last, so an interrupted download never
 * looks complete; re-downloading just overwrites the partial files.
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

const chapterDir = (sourceId: string, mangaExternalId: string, chapterId: string) =>
  new Directory(root(), sourceId, safe(mangaExternalId), safe(chapterId));

type LocalPage = { file: string; width?: number; height?: number };

const extOf = (url: string) =>
  url.match(/\.(jpe?g|png|webp|gif)(?:[?#]|$)/i)?.[1]?.toLowerCase() ?? 'jpg';

export async function downloadChapterPages(args: {
  sourceId: string;
  mangaExternalId: string;
  chapterId: string;
  chapterNumber?: string | null;
  language: string;
  pages: ChapterPage[];
  onProgress?: (done: number, total: number) => void;
}): Promise<void> {
  const { sourceId, mangaExternalId, chapterId, pages } = args;
  if (pages.length === 0) throw new Error('No pages to download');
  const dir = chapterDir(sourceId, mangaExternalId, chapterId);
  dir.create({ intermediates: true, idempotent: true });

  const saved: LocalPage[] = new Array(pages.length);
  let done = 0;
  // A few pages at a time: keeps the JS thread free and the source unbanned.
  await mapLimit(pages, 3, async (p) => {
    const name = `${String(p.index).padStart(3, '0')}.${extOf(p.imageUrl)}`;
    const file = new File(dir, name);
    if (file.exists) file.delete();
    await File.downloadFileAsync(p.imageUrl, file, p.headers ? { headers: p.headers } : undefined);
    saved[p.index] = { file: name, width: p.width, height: p.height };
    done += 1;
    args.onProgress?.(done, pages.length);
  });

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

/** Turn a stored download row back into reader-ready pages (file:// URIs). */
export function localPages(row: DownloadRow): ChapterPage[] {
  const list = JSON.parse(row.pages) as LocalPage[];
  const base = row.dir.replace(/\/+$/, '');
  return list.map((p, index) => ({
    index,
    imageUrl: `${base}/${p.file}`,
    width: p.width,
    height: p.height,
  }));
}

function deleteDirQuiet(uri: string) {
  try {
    const dir = new Directory(uri);
    if (dir.exists) dir.delete();
  } catch {
    // Files already gone is fine — the DB row is the source of truth.
  }
}

export async function deleteChapterDownload(sourceId: string, chapterId: string): Promise<void> {
  const row = await getDownload(sourceId, chapterId);
  if (!row) return;
  deleteDirQuiet(row.dir);
  await removeDownload(sourceId, chapterId);
}

export async function deleteMangaDownloads(
  sourceId: string,
  mangaExternalId: string,
): Promise<void> {
  const rows = await getMangaDownloadRows(sourceId, mangaExternalId);
  for (const r of rows) deleteDirQuiet(r.dir);
  await removeMangaDownloads(sourceId, mangaExternalId);
}

export async function clearAllDownloads(): Promise<void> {
  deleteDirQuiet(root().uri);
  await clearDownloadsTable();
}
