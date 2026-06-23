import Constants from 'expo-constants';
import { Platform } from 'react-native';

const PORT = 4000;

/**
 * Base URL of our backend (Phase 2). The app talks ONLY to this.
 *
 * Resolution order:
 *  1. EXPO_PUBLIC_API_URL if you set it explicitly.
 *  2. On a physical device in Expo Go: reuse the LAN IP the phone already used
 *     to reach the Metro dev server (so no manual config needed — the backend
 *     just has to run on the same machine, on port 4000, same Wi-Fi).
 *  3. Android emulator -> 10.0.2.2 ; iOS sim / web -> localhost.
 */
function devServerHostIp(): string | null {
  // e.g. "192.168.1.141:8081" -> "192.168.1.141"
  const c = Constants as any;
  const hostUri: string | null =
    Constants.expoConfig?.hostUri ??
    c.expoGoConfig?.debuggerHost ??
    c.manifest2?.extra?.expoGo?.debuggerHost ??
    c.manifest?.debuggerHost ??
    null;
  if (!hostUri) return null;
  const ip = hostUri.split(':')[0];
  return ip && ip !== 'localhost' && ip !== '127.0.0.1' ? ip : null;
}

function resolveBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;

  const lanIp = devServerHostIp();
  if (lanIp) return `http://${lanIp}:${PORT}`;

  if (Platform.OS === 'android') return `http://10.0.2.2:${PORT}`;
  return `http://localhost:${PORT}`;
}

export const API_BASE_URL = resolveBaseUrl();
