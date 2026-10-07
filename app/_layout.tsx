import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, useQueryClient } from '@tanstack/react-query';
import {
  PersistQueryClientProvider,
  type PersistedClient,
} from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useSourceHealthSync } from '@/data/queries';
import { isRemovedSource, REMOVED_SOURCES } from '@/data/sources/removed';
import '@/lib/backgroundUpdates'; // side-effect: defines the background task
import { registerChapterCheck } from '@/lib/backgroundUpdates';
import { deleteRemovedSourceFiles } from '@/lib/downloads';
import {
  getInitialNotificationTarget,
  setupAndroidChannel,
  subscribeNotificationTaps,
  type TapTarget,
} from '@/lib/notifications';
import { isNotifyEnabled } from '@/lib/notifyPrefs';
import { isExpoGo } from '@/lib/runtime';
import { useGuardedRouter } from '@/lib/useGuardedRouter';
import { colors } from '@/theme/colors';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Only queries that make a cold start feel instant are persisted: Home rails,
 * title details, chapter lists, the Updates feed and the For-you rails. Local
 * SQLite queries are instant anyway (and persisting them showed stale state),
 * searches are throwaway, and page URLs expire.
 */
const PERSISTED = new Set(['trending', 'manga', 'chapters', 'updates', 'for-you']);

/**
 * Android's AsyncStorage keeps everything in one small SQLite db (6 MB total by
 * default, and values over ~2 MB fail to read back), shared with the app's
 * settings. Keep the snapshot well under that by dropping the biggest entries —
 * long chapter lists, which are refetchable — until it fits.
 */
const MAX_PERSIST_CHARS = 900_000;
// Serialized size per data object. Query data keeps its identity until it
// changes, so each result is measured once, not on every snapshot.
const sizeOf = new WeakMap<object, number>();
function dataSize(data: unknown): number {
  if (data === null || typeof data !== 'object') return JSON.stringify(data ?? null).length;
  let size = sizeOf.get(data);
  if (size === undefined) {
    size = JSON.stringify(data).length;
    sizeOf.set(data, size);
  }
  return size;
}

function serializeBounded(client: PersistedClient): string {
  const queries = client.clientState.queries;
  let total = 0;
  for (const q of queries) total += dataSize(q.state.data) + 300; // + key/state overhead
  if (total <= MAX_PERSIST_CHARS) return JSON.stringify(client);
  const biggestFirst = [...queries].sort((a, b) => dataSize(b.state.data) - dataSize(a.state.data));
  const drop = new Set<(typeof queries)[number]>();
  for (const q of biggestFirst) {
    if (total <= MAX_PERSIST_CHARS) break;
    drop.add(q);
    total -= dataSize(q.state.data) + 300;
  }
  return JSON.stringify({
    ...client,
    clientState: { ...client.clientState, queries: queries.filter((q) => !drop.has(q)) },
  });
}

/**
 * The saved snapshot, minus queries that mention a source taken out of the app:
 * their cards would open titles that can no longer load. Only the first start
 * after a removal pays for the per-query check.
 */
function deserializeClean(raw: string): PersistedClient {
  const client = JSON.parse(raw) as PersistedClient;
  const marks = REMOVED_SOURCES.map((id) => `"${id}"`);
  if (!marks.some((m) => raw.includes(m))) return client;
  const queries = client.clientState.queries.filter((q) => {
    const json = JSON.stringify(q);
    return !marks.some((m) => json.includes(m));
  });
  return { ...client, clientState: { ...client.clientState, queries } };
}

/**
 * Routes a tapped chapter notification to its manga page (or the Updates tab for
 * the summary). Uses the imperative notification API (lazily loaded, so it stays
 * clear of Expo Go's import-time crash) instead of the hook, which would need a
 * static import.
 */
function NotificationTapHandler() {
  const router = useGuardedRouter();
  const qc = useQueryClient();
  useEffect(() => {
    let active = true;
    const open = (t: TapTarget) => {
      if (!active) return;
      // An old notification can point at a source that's been removed since.
      if (t.kind === 'updates' || isRemovedSource(t.sourceId)) {
        router.push('/updates');
        return;
      }
      // The notification exists because the chapter list changed — don't let a
      // list cached a few minutes ago hide the new chapter.
      qc.invalidateQueries({ queryKey: ['chapters', t.sourceId, t.externalId] });
      router.push({ pathname: '/manga/[id]', params: { id: t.externalId, sourceId: t.sourceId } });
    };
    getInitialNotificationTarget()
      .then((t) => t && open(t))
      .catch(() => {});
    const unsubscribe = subscribeNotificationTaps(open);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [router, qc]);
  return null;
}

/** Keeps the source health badges live (one subscription for the whole app). */
function SourceHealthSync() {
  useSourceHealthSync();
  return null;
}

export default function RootLayout() {
  // Sweep downloads of removed sources, then prepare the notification channel
  // and re-arm the background check if the user had notifications on
  // (registration doesn't survive an app reinstall/clear). Notification setup
  // no-ops in Expo Go. Failures here must never take the app down.
  useEffect(() => {
    deleteRemovedSourceFiles();
    if (isExpoGo) return;
    setupAndroidChannel().catch(() => {});
    isNotifyEnabled()
      .then((on) => (on ? registerChapterCheck() : undefined))
      .catch(() => {});
  }, []);

  const client = useRef(
    new QueryClient({
      defaultOptions: {
        // Unused queries leave memory after 30 min (was a day). The persisted
        // snapshot mirrors memory, so it keeps what was used recently and
        // doesn't grow with everything ever browsed — cheaper to write and read.
        queries: { retry: 1, refetchOnWindowFocus: false, gcTime: 30 * 60 * 1000 },
      },
    }),
  ).current;

  const persister = useRef(
    createAsyncStoragePersister({
      storage: AsyncStorage,
      serialize: serializeBounded,
      deserialize: deserializeClean,
      // Writing the snapshot means stringifying it on the JS thread — at most
      // every few seconds, not on every tiny cache change.
      throttleTime: 3000,
    }),
  ).current;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={client}
          persistOptions={{
            persister,
            maxAge: DAY,
            // Bumped whenever a persisted query changes shape (v2: Updates now
            // returns { items, failed }) so an old snapshot is discarded.
            buster: 'v2',
            dehydrateOptions: {
              shouldDehydrateQuery: (q) =>
                q.state.status === 'success' && PERSISTED.has(String(q.queryKey[0])),
            },
          }}
        >
          <StatusBar style="light" />
          <SourceHealthSync />
          {!isExpoGo && <NotificationTapHandler />}
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="manga/[id]" options={{ title: '' }} />
            <Stack.Screen
              name="reader/[chapterId]"
              options={{ headerShown: false, animation: 'fade' }}
            />
            <Stack.Screen name="settings" />
            <Stack.Screen name="top" />
            <Stack.Screen name="browse" />
            <Stack.Screen name="diagnostics" />
          </Stack>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
