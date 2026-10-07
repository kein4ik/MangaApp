import { normChapterNumber } from '@/data/local/db';
import type { Chapter } from '@/data/sources/types';

/**
 * The previous/next chapter around `chapterId`, skipping other groups' copies of
 * the SAME chapter (MangaDex lists one entry per scanlation group) and, among
 * the copies of the neighbouring chapter, preferring the group being read.
 */
export function chapterNeighbours(
  chapters: Chapter[] | undefined,
  chapterId: string,
): { prev: Chapter | undefined; next: Chapter | undefined } {
  const idx = chapters?.findIndex((c) => c.externalId === chapterId) ?? -1;
  if (!chapters || idx < 0) return { prev: undefined, next: undefined };
  const cur = chapters[idx];
  const curNum = normChapterNumber(cur.chapterNumber);
  const pick = (dir: 1 | -1): Chapter | undefined => {
    let found: Chapter | undefined;
    for (let i = idx + dir; i >= 0 && i < chapters.length; i += dir) {
      const c = chapters[i];
      const n = normChapterNumber(c.chapterNumber);
      if (curNum && n === curNum) continue;
      if (!found) found = c;
      else if (n !== normChapterNumber(found.chapterNumber)) break;
      if (cur.scanlationGroup && c.scanlationGroup === cur.scanlationGroup) return c;
    }
    return found;
  };
  return { prev: pick(-1), next: pick(1) };
}
