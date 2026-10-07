import { getLibrary, getNotifyWatermarks, setNotifyWatermark } from '@/data/local/db';
import { SourceManager, SourceRegistry } from '@/data/sources/registry';
import type { Chapter } from '@/data/sources/types';

import {
  canPostNotifications,
  presentChapterNotification,
  presentSummaryNotification,
  type ChapterNotice,
} from './notifications';
import { mapLimit } from './pool';

/** Individual alerts per run; anything beyond goes into ONE summary notification. */
const MAX_INDIVIDUAL = 6;

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

type Hit = { notice: ChapterNotice; latestNumber: string | null; latestId: string };

const advance = (h: Hit) =>
  setNotifyWatermark(h.notice.sourceId, h.notice.externalId, h.latestNumber, h.latestId);

/**
 * Walk every library title, fetch its chapters via the normal on-device
 * providers, and detect whichever are newer than the last watermark. The first
 * time a title is seen we only record a baseline (so enabling notifications
 * never dumps the whole backlog). Returns the hits.
 *
 * With `notify`, a title's watermark moves forward only AFTER the user has
 * actually been told about it — individually, or in the summary for the rest.
 * A failed post or missing permission leaves it for the next run instead of
 * silently marking it as announced.
 */
export async function checkForNewChapters(notify: boolean): Promise<ChapterNotice[]> {
  const [lib, marks] = await Promise.all([getLibrary(), getNotifyWatermarks()]);
  const markBy = new Map(marks.map((m) => [`${m.source_id}:${m.external_id}`, m]));
  const hits: Hit[] = [];

  // A few at a time, not the whole library at once — bursts trip source rate
  // limits (which would silently skip those titles' notifications).
  await mapLimit(lib, 3, async (m) => {
    const lang = m.language || SourceRegistry.get(m.source_id)?.languages[0] || 'en';
    try {
      const chapters = await SourceManager.require(m.source_id).getChapters(m.external_id, lang);
      if (!chapters.length) return;
      const latest = pickLatest(chapters);
      if (!latest) return;

      const prev = markBy.get(`${m.source_id}:${m.external_id}`);
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
        notice: {
          sourceId: m.source_id,
          externalId: m.external_id,
          chapterId: latest.externalId,
          title: m.title,
          number: latest.chapterNumber,
          language: lang,
        },
        latestNumber: latest.chapterNumber ?? null,
        latestId: latest.externalId,
      });
    } catch {
      // A source being down shouldn't fail the whole run — retry next time.
    }
  });

  if (!notify) {
    // Silent baseline (turning notifications on): record, don't announce.
    for (const h of hits) await advance(h).catch(() => {});
    return hits.map((h) => h.notice);
  }
  if (hits.length === 0 || !(await canPostNotifications())) return hits.map((h) => h.notice);

  // Up to MAX_INDIVIDUAL + 1 fit individually; otherwise the rest are grouped.
  const individual = hits.length > MAX_INDIVIDUAL + 1 ? hits.slice(0, MAX_INDIVIDUAL) : hits;
  for (const h of individual) {
    try {
      await presentChapterNotification(h.notice);
      await advance(h);
    } catch {
      // Not shown → not marked; the next run tries again.
    }
  }
  const rest = hits.slice(individual.length);
  if (rest.length > 0) {
    try {
      await presentSummaryNotification(rest.map((h) => h.notice));
      for (const h of rest) await advance(h);
    } catch {
      // Same: unannounced titles stay pending.
    }
  }
  return hits.map((h) => h.notice);
}
