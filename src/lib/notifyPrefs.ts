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
