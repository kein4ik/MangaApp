import { getLibrary, getNotifyWatermarks, setNotifyWatermark } from '@/data/local/db';
import { SourceManager } from '@/data/sources/registry';
import type { Chapter } from '@/data/sources/types';

import { presentChapterNotification, type ChapterNotice } from './notifications';

/** Newest chapter of a title = the one with the highest number (fallback: last). */
function pickLatest(chapters: Chapter[]): Chapter | undefined {
  let best = chapters[chapters.length - 1];
  let bestNum = Number(best?.chapterNumber);
  for (const c of chapters) {
    const n = Number(c.chapterNumber);
    if (!isNaN(n) && (isNaN(bestNum) || n > bestNum)) {
      best = c;
      bestNum = n;
    }
  }
  return best;
}

/**
 * Walk every library title, fetch its chapters via the normal on-device
 * providers, and detect whichever are newer than the last watermark. The first
 * time a title is seen we only record a baseline (so enabling notifications
 * never dumps the whole backlog). Returns the hits; if `notify` is set, also
 * fires a local notification for each (capped, so a long-idle gap can't storm).
 */
export async function checkForNewChapters(notify: boolean): Promise<ChapterNotice[]> {
  const [lib, marks] = await Promise.all([getLibrary(), getNotifyWatermarks()]);
  const markBy = new Map(marks.map((m) => [`${m.source_id}:${m.external_id}`, m]));
  const hits: ChapterNotice[] = [];

  await Promise.all(
    lib.map(async (m) => {
      const lang = m.language || 'en';
      try {
        const chapters = await SourceManager.require(m.source_id).getChapters(m.external_id, lang);
        if (!chapters.length) return;
        const latest = pickLatest(chapters);
        if (!latest) return;

        const key = `${m.source_id}:${m.external_id}`;
        const prev = markBy.get(key);
        if (!prev) {
          // Baseline only — never notify on first sighting.
          await setNotifyWatermark(m.source_id, m.external_id, latest.chapterNumber ?? null, latest.externalId);
          return;
        }
        if (prev.notified_id === latest.externalId) return;

        const prevNum = Number(prev.latest_number);
        const latestNum = Number(latest.chapterNumber);
        const isNewer =
          !isNaN(latestNum) && !isNaN(prevNum)
            ? latestNum > prevNum
            : latest.chapterNumber !== prev.latest_number;
        if (!isNewer) return;

        hits.push({
          sourceId: m.source_id,
          externalId: m.external_id,
          chapterId: latest.externalId,
          title: m.title,
          number: latest.chapterNumber,
          language: lang,
        });
        await setNotifyWatermark(m.source_id, m.external_id, latest.chapterNumber ?? null, latest.externalId);
      } catch {
        // A source being down shouldn't fail the whole run — retry next time.
      }
    }),
  );

  if (notify) {
    for (const h of hits.slice(0, 8)) await presentChapterNotification(h);
  }
  return hits;
}
