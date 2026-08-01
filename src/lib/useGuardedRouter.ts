import { useRouter } from 'expo-router';
import { useMemo } from 'react';

/**
 * Drop-in replacement for expo-router's useRouter that swallows DUPLICATE
 * navigations to a destination we just went to. Right after launch the JS
 * thread is busy, so taps don't register immediately; users tap the same title
 * several times, the taps then all release at once, and each one fires
 * router.push — stacking multiple copies of the same screen. "Back" then lands
 * on the same title again ("manga inside the same manga"). Guarding on a shared
 * (module-level) last-destination + time window fixes it for every screen at
 * once, without touching the ~24 call sites' logic.
 */
type Router = ReturnType<typeof useRouter>;
type Dest = Parameters<Router['push']>[0];

let lastKey = '';
let lastAt = 0;
const WINDOW_MS = 700;

function keyOf(dest: Dest): string {
  try {
    return typeof dest === 'string' ? dest : JSON.stringify(dest);
  } catch {
    return String(dest);
  }
}

function allow(dest: Dest): boolean {
  const key = keyOf(dest);
  const now = Date.now();
  if (key === lastKey && now - lastAt < WINDOW_MS) return false;
  lastKey = key;
  lastAt = now;
  return true;
}

export function useGuardedRouter() {
  const router = useRouter();
  return useMemo(
    () => ({
      push: (dest: Dest) => {
        if (allow(dest)) router.push(dest);
      },
      replace: (dest: Dest) => {
        if (allow(dest)) router.replace(dest);
      },
      back: () => router.back(),
    }),
    [router],
  );
}
