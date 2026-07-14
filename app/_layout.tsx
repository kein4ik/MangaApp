import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '@/lib/backgroundUpdates'; // side-effect: defines the background task
import { registerChapterCheck } from '@/lib/backgroundUpdates';
import {
  getInitialNotificationTarget,
  setupAndroidChannel,
  subscribeNotificationTaps,
  type TapTarget,
} from '@/lib/notifications';
import { isNotifyEnabled } from '@/lib/notifyPrefs';
import { isExpoGo } from '@/lib/runtime';
import { colors } from '@/theme/colors';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Routes a tapped chapter notification to its manga page. Uses the imperative
 * notification API (lazily loaded, so it stays clear of Expo Go's import-time
 * crash) instead of the hook, which would need a static import.
 */
function NotificationTapHandler() {
  const router = useRouter();
  useEffect(() => {
    let active = true;
    const open = (t: TapTarget) => {
      if (!active) return;
      router.push({ pathname: '/manga/[id]', params: { id: t.externalId, sourceId: t.sourceId } });
    };
    getInitialNotificationTarget().then((t) => t && open(t));
    const unsubscribe = subscribeNotificationTaps(open);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [router]);
  return null;
}

export default function RootLayout() {
  // Prepare the notification channel and re-arm the background check if the user
  // had notifications on (registration doesn't survive an app reinstall/clear).
  // No-ops in Expo Go.
  useEffect(() => {
    if (isExpoGo) return;
    setupAndroidChannel();
    isNotifyEnabled().then((on) => {
      if (on) registerChapterCheck();
    });
  }, []);

  const client = useRef(
    new QueryClient({
      defaultOptions: {
        // gcTime >= persist maxAge so restored entries aren't dropped immediately.
        queries: { retry: 1, refetchOnWindowFocus: false, gcTime: DAY },
      },
    }),
  ).current;

  const persister = useRef(createAsyncStoragePersister({ storage: AsyncStorage })).current;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={client}
          persistOptions={{
            persister,
            maxAge: DAY,
            dehydrateOptions: {
              // Persist stable data for instant app restarts, but NOT page image
              // URLs (signed/expiring), cross-source match results, or the
              // source list (local + cheap; persisting it hides newly added sources).
              shouldDehydrateQuery: (q) =>
                q.state.status === 'success' &&
                q.queryKey[0] !== 'pages' &&
                q.queryKey[0] !== 'match' &&
                q.queryKey[0] !== 'sources',
            },
          }}
        >
          <StatusBar style="light" />
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
