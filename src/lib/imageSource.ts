import type { ImageSource } from 'expo-image';

/**
 * Some source CDNs reject requests without a Referer header (HTTP 403). Cover
 * URLs travel through the app as plain strings, so we re-attach the right
 * Referer based on the host. Reader page images already carry their headers
 * from the backend, so this is only needed for covers.
 */
const REFERER_RULES: { hosts: string[]; referer: string }[] = [
  {
    hosts: ['cdnlibs.org', 'imglib.info', 'imgslib.link', 'hentaicdn.org'],
    referer: 'https://mangalib.me/',
  },
  {
    hosts: ['remanga.org', 'reimg2.org', 'reimg.org'],
    referer: 'https://remanga.org/',
  },
  {
    hosts: ['readdetectiveconan.com'], // Mangapill's image CDN
    referer: 'https://mangapill.com/',
  },
  {
    // WEBTOON image CDN (covers + pages) — pstatic.net rejects no-referer with 403.
    hosts: ['pstatic.net'],
    referer: 'https://www.webtoons.com/',
  },
];

export function imageSource(url?: string | null): ImageSource | undefined {
  if (!url) return undefined;
  for (const rule of REFERER_RULES) {
    if (rule.hosts.some((h) => url.includes(h))) {
      return { uri: url, headers: { Referer: rule.referer } };
    }
  }
  return { uri: url };
}
