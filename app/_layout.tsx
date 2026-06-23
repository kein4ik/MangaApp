import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/theme/colors';

const DAY = 24 * 60 * 60 * 1000;

export default function RootLayout() {
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
              // URLs (signed/expiring) or cross-source match results.
              shouldDehydrateQuery: (q) =>
                q.state.status === 'success' &&
                q.queryKey[0] !== 'pages' &&
                q.queryKey[0] !== 'match',
            },
          }}
        >
          <StatusBar style="light" />
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
          </Stack>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
