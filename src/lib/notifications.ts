import type * as NotificationsNS from 'expo-notifications';
import { Platform } from 'react-native';

import { isExpoGo } from './runtime';

/**
 * Local (on-device) notifications for new chapters. There is no backend/push —
 * a background task checks the user's library and presents these directly.
 *
 * IMPORTANT: expo-notifications throws AT IMPORT TIME in Expo Go on Android (its
 * push auto-registration side-effect runs on load). So we NEVER import it
 * statically — `import type` is erased at build time, and the real module is
 * pulled in lazily via `load()`, which returns null in Expo Go. That keeps the
 * whole app runnable in Expo Go; notifications light up on a dev/EAS build.
 */

const CHANNEL_ID = 'chapters';

let mod: typeof NotificationsNS | null = null;
async function load(): Promise<typeof NotificationsNS | null> {
  if (isExpoGo) return null;
  if (!mod) mod = await import('expo-notifications');
  return mod;
}

let handlerSet = false;
function ensureHandler(N: typeof NotificationsNS) {
  if (handlerSet) return;
  handlerSet = true;
  // Show the banner even when the app is foregrounded.
  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Android 8+ requires a channel before any notification is shown. */
export async function setupAndroidChannel(): Promise<void> {
  const N = await load();
  if (!N) return;
  ensureHandler(N);
  if (Platform.OS !== 'android') return;
  await N.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'New chapters',
    importance: N.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 200, 100, 200],
  });
}

// The headless background task may be the first code to post in a process —
// make sure the channel exists before using it (idempotent, once per process).
let channelReady: Promise<void> | null = null;
function ensureChannel(): Promise<void> {
  channelReady ??= setupAndroidChannel().catch((e) => {
    channelReady = null;
    throw e;
  });
  return channelReady;
}

/**
 * The channel goes in the TRIGGER on Android (`content` has no channel field —
 * a channel there is silently ignored and the OS falls back to a default,
 * high-importance channel). `{ channelId }` alone = deliver immediately.
 */
const immediateTrigger = (): NotificationsNS.NotificationTriggerInput =>
  Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null;

/** Ask for notification permission, returning whether it was granted. */
export async function ensureNotificationPermission(): Promise<boolean> {
  const N = await load();
  if (!N) return false;
  ensureHandler(N);
  const current = await N.getPermissionsAsync();
  if (current.status === 'granted') return true;
  if (!current.canAskAgain) return false;
  const next = await N.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  });
  return next.status === 'granted';
}

/** Whether a notification posted now would actually reach the user (no prompt). */
export async function canPostNotifications(): Promise<boolean> {
  try {
    const N = await load();
    if (!N) return false;
    return (await N.getPermissionsAsync()).status === 'granted';
  } catch {
    return false;
  }
}

export type ChapterNotice = {
  sourceId: string;
  externalId: string;
  chapterId: string;
  title: string;
  number?: string | null;
  language: string;
};

/** Fire one "new chapter" notification. `data` is read back on tap for routing. */
export async function presentChapterNotification(n: ChapterNotice): Promise<void> {
  const N = await load();
  if (!N) return;
  ensureHandler(N);
  await ensureChannel();
  await N.scheduleNotificationAsync({
    content: {
      title: n.title,
      body: n.number ? `New chapter ${n.number} is out` : 'A new chapter is out',
      data: {
        kind: 'manga',
        sourceId: n.sourceId,
        externalId: n.externalId,
        chapterId: n.chapterId,
        number: n.number ?? '',
        language: n.language,
      },
    },
    trigger: immediateTrigger(),
  });
}

/** One grouped notification for everything past the per-run individual cap. */
export async function presentSummaryNotification(notices: ChapterNotice[]): Promise<void> {
  const N = await load();
  if (!N || notices.length === 0) return;
  ensureHandler(N);
  await ensureChannel();
  const names = notices.slice(0, 3).map((n) => n.title);
  const more = notices.length - names.length;
  await N.scheduleNotificationAsync({
    content: {
      title: `${notices.length} more titles have new chapters`,
      body: more > 0 ? `${names.join(', ')} and ${more} more` : names.join(', '),
      data: { kind: 'updates' },
    },
    trigger: immediateTrigger(),
  });
}

export type TapTarget =
  | { kind: 'manga'; sourceId: string; externalId: string }
  | { kind: 'updates' };

function targetFrom(response: NotificationsNS.NotificationResponse | null): TapTarget | null {
  const data = response?.notification.request.content.data as
    | { kind?: string; sourceId?: string; externalId?: string }
    | undefined;
  if (data?.kind === 'updates') return { kind: 'updates' };
  return data?.sourceId && data?.externalId
    ? { kind: 'manga', sourceId: data.sourceId, externalId: data.externalId }
    : null;
}

/** The notification that cold-started the app (tapped while closed), if any. */
export async function getInitialNotificationTarget(): Promise<TapTarget | null> {
  try {
    const N = await load();
    if (!N) return null;
    return targetFrom(await N.getLastNotificationResponseAsync());
  } catch {
    return null;
  }
}

/** Subscribe to notification taps while the app is running. Returns an unsub. */
export function subscribeNotificationTaps(cb: (t: TapTarget) => void): () => void {
  if (isExpoGo) return () => {};
  let sub: { remove(): void } | null = null;
  let cancelled = false;
  load()
    .then((N) => {
      if (!N || cancelled) return;
      sub = N.addNotificationResponseReceivedListener((response) => {
        const t = targetFrom(response);
        if (t) cb(t);
      });
    })
    .catch(() => {
      // No notification module in this build — taps simply aren't routed.
    });
  return () => {
    cancelled = true;
    sub?.remove();
  };
}
