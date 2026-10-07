import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CoverArt } from './CoverArt';
import { useDownloadChapter, useDownloadedChapters, useReadChapterNumbers, type UpdateItem } from '@/data/queries';
import type { Chapter } from '@/data/sources/types';
import { normChapterNumber } from '@/data/local/db';
import { useGuardedRouter } from '@/lib/useGuardedRouter';
import { sourceMeta } from '@/lib/sourceMeta';
import { timeAgo } from '@/lib/time';
import { downloadKey, useDownloadProgress } from '@/store/downloads.store';
import { colors } from '@/theme/colors';
import { typography } from '@/theme/typography';

export function UpdateMangaCard({ item }: { item: UpdateItem }) {
  const router = useGuardedRouter();
  const qc = useQueryClient();
  const [visibleCount, setVisibleCount] = useState(2);
  const read = useReadChapterNumbers(item.sourceId, item.externalId);
  const downloaded = useDownloadedChapters(item.sourceId, item.externalId);
  const download = useDownloadChapter(item.sourceId, item.externalId, item.language);
  const active = useDownloadProgress(s => s.active);
  // Updates already fetched these lists. The presentation never adds source requests.
  const chapters = qc.getQueryData<Chapter[]>(['chapters', item.sourceId, item.externalId, item.language]) ?? [];
  const start = chapters.findIndex(c => c.externalId === item.next?.id);
  const seen = new Set<string>();
  const finished = new Set(read.data ?? []);
  const unread = start >= 0 && read.data !== undefined ? chapters.slice(start).filter(c => {
    const key = normChapterNumber(c.chapterNumber) ?? c.externalId;
    if (seen.has(key) || finished.has(key)) return false;
    seen.add(key); return true;
  }).reverse() : item.next ? [{ sourceId: item.sourceId, mangaExternalId: item.externalId, externalId: item.next.id, chapterNumber: item.next.number, language: item.language } as Chapter] : [];
  const visible = unread.slice(0, visibleCount);
  const openTitle = () => router.push({ pathname: '/manga/[id]', params: { id: item.externalId, sourceId: item.sourceId } });
  const downloadOne = (chapter: Chapter) => {
    if (downloaded.data?.includes(chapter.externalId) || active[downloadKey(item.sourceId, chapter.externalId)]) return;
    download.mutate({ chapterId: chapter.externalId, chapterNumber: chapter.chapterNumber });
  };
  return <View style={styles.card}>
    <Pressable onPress={openTitle} style={styles.heading} accessibilityLabel={'Open ' + item.title}>
      <CoverArt uri={item.coverUrl} title={item.title} style={styles.cover} />
      <View style={styles.info}><Text style={styles.title} numberOfLines={2}>{item.title}</Text><View style={styles.sourceLine}><View style={[styles.sourceDot, { backgroundColor: sourceMeta(item.sourceId).color }]} /><Text numberOfLines={1} style={styles.meta}>{sourceMeta(item.sourceId).name} · {item.unread} unread</Text></View></View>
      <Ionicons name="chevron-forward" size={19} color={colors.textMuted} />
    </Pressable>
    {visible.map(chapter => {
      const saved = downloaded.data?.includes(chapter.externalId);
      const progress = active[downloadKey(item.sourceId, chapter.externalId)];
      const date = chapter.publishedAt ? Date.parse(chapter.publishedAt) : NaN;
      return <View key={chapter.externalId} style={styles.chapterRow}>
        <Pressable style={styles.chapterLink} onPress={() => router.push({ pathname: '/reader/[chapterId]', params: { chapterId: chapter.externalId, sourceId: item.sourceId, mangaId: item.externalId, chapterNumber: chapter.chapterNumber ?? '', lang: item.language, startPage: '0' } })}>
          <View style={styles.unreadDot} /><Text style={styles.chapterTitle} numberOfLines={1}>{chapter.chapterNumber ? 'Chapter ' + chapter.chapterNumber : chapter.title || 'Read chapter'}</Text>
          {!Number.isNaN(date) && <Text style={styles.date}>{timeAgo(date)}</Text>}
        </Pressable>
        <Pressable accessibilityLabel={saved ? 'Chapter downloaded' : 'Download chapter'} disabled={saved || !!progress} onPress={() => downloadOne(chapter)} style={styles.download}>
          {progress ? <Text style={styles.downloadProgress}>{progress.total ? progress.done + '/' + progress.total : '…'}</Text> : <Ionicons name={saved ? 'checkmark-circle' : 'download-outline'} size={21} color={saved ? colors.accent : colors.textMuted} />}
        </Pressable>
      </View>;
    })}
    {(unread.length > 2 || item.unread > unread.length) && <View style={styles.footer}>
      <Pressable style={styles.footerButton} onPress={item.unread > unread.length ? openTitle : () => setVisibleCount(count => count >= unread.length ? 2 : count + 12)}><Text style={styles.footerText}>{item.unread > unread.length ? 'View all ' + item.unread + ' chapters' : visibleCount >= unread.length ? 'Show less' : 'Show ' + Math.min(12, unread.length - visibleCount) + ' more'}</Text></Pressable>
      {unread.length === item.unread && <Pressable style={styles.footerButton} onPress={() => unread.forEach(downloadOne)}><Ionicons name="download-outline" size={15} color={colors.accent} /><Text style={styles.footerText}>Download all</Text></Pressable>}
    </View>}
  </View>;
}
const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 14, backgroundColor: colors.card, borderRadius: 18, overflow: 'hidden' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  cover: { width: 52, height: 74, borderRadius: 9 },
  info: { flex: 1, minWidth: 0, gap: 7 },
  title: { ...typography.bodyStrong, color: colors.text, lineHeight: 20 },
  sourceLine: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  sourceDot: { width: 6, height: 6, borderRadius: 3 },
  meta: { ...typography.caption, color: colors.textMuted, flexShrink: 1 },
  chapterRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, minHeight: 50 },
  chapterLink: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, minWidth: 0 },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  chapterTitle: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  date: { ...typography.tiny, color: colors.textMuted, maxWidth: 74 },
  download: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  downloadProgress: { ...typography.tiny, color: colors.accent },
  footer: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  footerButton: { minHeight: 46, flexDirection: 'row', gap: 5, alignItems: 'center', paddingHorizontal: 4 },
  footerText: { ...typography.caption, fontWeight: '700', color: colors.accent },
});
