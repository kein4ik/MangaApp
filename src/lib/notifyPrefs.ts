import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The "notifications on/off" flag, stored as a plain key so the headless
 * background task can read it without hydrating the zustand settings store.
 * The Settings UI mirrors its toggle into this key.
 */
const KEY = 'mangaapp-notify-enabled';

export async function isNotifyEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY)) === '1';
}

export async function setNotifyEnabledFlag(on: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY, on ? '1' : '0');
}

/**
 * When the background checker last actually ran. The OS decides when (or
 * whether) to run background work, so surfacing this in Settings is the only
 * honest way to tell "it's scheduled" from "the system is throttling it".
 */
const LAST_RUN_KEY = 'mangaapp-notify-last-run';

export async function setLastBackgroundRun(at = Date.now()): Promise<void> {
  await AsyncStorage.setItem(LAST_RUN_KEY, String(at));
}

export async function getLastBackgroundRun(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(LAST_RUN_KEY);
  const n = raw ? Number(raw) : NaN;
  return isFinite(n) && n > 0 ? n : null;
}
