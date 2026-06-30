/**
 * fetch with a hard timeout. Scraper sources can hang indefinitely; aborting
 * after a sensible deadline means one slow/dead source never stalls a screen
 * (especially the cross-source search/match, which waits on every source). A
 * timeout surfaces as a normal fetch error, which callers already handle.
 */
const DEFAULT_TIMEOUT = 12_000;

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
