import { fetch } from 'expo/fetch';

import type { ChapterPage } from '../data/sources/types';

export type PageSize = { w: number; h: number };
const MAX_REMEMBERED = 800;
const sizes = new Map<string, PageSize>();
const HEADER_BYTES = 4096;
const HEADER_TIMEOUT_MS = 2000;

export function rememberPageSize(url: string, size: PageSize) {
  sizes.delete(url);
  if (sizes.size >= MAX_REMEMBERED) sizes.delete(sizes.keys().next().value!);
  sizes.set(url, size);
}

export function knownPageSize(page: ChapterPage): PageSize | undefined {
  if (page.width && page.height) return { w: page.width, h: page.height };
  return sizes.get(page.imageUrl);
}

/** Only Asura's remote WebP files need this probe. Local downloads never fetch. */
export function needsPageSize(page: ChapterPage): boolean {
  return !knownPageSize(page) && /^https?:\/\/.+\.webp(?:[?#]|$)/i.test(page.imageUrl);
}

/** Read dimensions from WebP's container/header, without decoding any pixels. */
export function webpHeaderSize(bytes: Uint8Array): PageSize | undefined {
  const text = (at: number, length: number) =>
    String.fromCharCode(...bytes.subarray(at, at + length));
  if (bytes.length < 12 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WEBP') return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const uint24 = (at: number) => bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const kind = text(at, 4);
    const length = view.getUint32(at + 4, true);
    const data = at + 8;
    if (kind === 'VP8X' && length >= 10 && data + 10 <= bytes.length) {
      return { w: uint24(data + 4) + 1, h: uint24(data + 7) + 1 };
    }
    if (kind === 'VP8L' && length >= 5 && data + 5 <= bytes.length && bytes[data] === 0x2f) {
      const bits = view.getUint32(data + 1, true);
      return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (
      kind === 'VP8 ' && length >= 10 && data + 10 <= bytes.length &&
      bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a
    ) {
      const w = view.getUint16(data + 6, true) & 0x3fff;
      const h = view.getUint16(data + 8, true) & 0x3fff;
      return w && h ? { w, h } : undefined;
    }
    at = data + length + (length % 2);
  }
}

/** Best effort: slow/unsupported responses fall back to the reader's onLoad. */
export async function probePageSize(page: ChapterPage, signal: AbortSignal): Promise<PageSize | undefined> {
  if (signal.aborted) return;
  const known = knownPageSize(page);
  if (known || !needsPageSize(page)) return known;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort);
  const timer = setTimeout(abort, HEADER_TIMEOUT_MS);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (signal.aborted) return;
    const response = await fetch(page.imageUrl, {
      headers: { ...page.headers, Range: `bytes=0-${HEADER_BYTES - 1}` },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) return;
    // A 200 is allowed when Range is ignored; still consume at most 4 KiB.
    // A partial response starting elsewhere cannot contain the file header.
    if (response.status === 206 && !/^bytes 0-/i.test(response.headers.get('content-range') ?? '')) return;
    reader = response.body.getReader();
    const header = new Uint8Array(HEADER_BYTES);
    let length = 0;
    while (length < HEADER_BYTES && !controller.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      const part = value.subarray(0, HEADER_BYTES - length);
      header.set(part, length);
      length += part.length;
      const size = webpHeaderSize(header.subarray(0, length));
      if (size && !controller.signal.aborted) {
        rememberPageSize(page.imageUrl, size);
        return size;
      }
      if (length >= 12 && String.fromCharCode(...header.subarray(8, 12)) !== 'WEBP') break;
    }
  } catch {
    // A size probe must never turn a readable chapter into a chapter error.
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    // Abort the native transfer too, including servers that ignore Range.
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}

/** Current page first; two ahead and one behind cover either scroll direction. */
export function pageSizeWindow(page: number, total: number): number[] {
  if (total === 0) return [];
  const current = Math.max(0, Math.min(Math.floor(page), total - 1));
  return [current, current + 1, current + 2, current - 1].filter((i) => i >= 0 && i < total);
}

/** Two small header requests at a time; cancelling also stops queued work. */
export async function preparePageSizes(
  pages: ChapterPage[],
  indices: number[],
  signal: AbortSignal,
  onSettled: (index: number, size: PageSize | undefined) => void,
): Promise<void> {
  let next = 0;
  async function worker() {
    while (!signal.aborted && next < indices.length) {
      const index = indices[next++];
      const size = await probePageSize(pages[index], signal);
      if (!signal.aborted) onSettled(index, size);
    }
  }
  await Promise.all([worker(), worker()]);
}
