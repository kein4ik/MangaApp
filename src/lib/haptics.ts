import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Tiny haptic vocabulary for the app. Kept in one place so feedback stays
 * consistent (and easy to mute later): `tap` for state toggles, `success` for
 * a completed action, `warn` for a destructive/rejected one.
 *
 * Every call is fire-and-forget and swallows errors — a device without a
 * haptic engine must never break a user action.
 */

const fire = (run: () => Promise<void>) => {
  if (Platform.OS === 'web') return;
  run().catch(() => {});
};

/** Light tick — marking read, toggling a chip, turning a chapter. */
export const hapticTap = () =>
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

/** Confirmation — added to library, download finished. */
export const hapticSuccess = () =>
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));

/** Something was removed or refused. */
export const hapticWarn = () =>
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
