import type { PageSize } from './readerPageSizes';

// A tall strip can be narrow enough to pass the screen-width check while still
// occupying 50–100 MB. Bound both its pixel count and its longest texture edge.
// These limits apply only to Asura on Android; normal pages keep their pixels.
const MAX_STRIP_EDGE = 8192;
const MAX_STRIP_PIXELS = 6_000_000;

export function asuraDecodeSize(size: PageSize | undefined): PageSize | undefined {
  if (!size || !Number.isFinite(size.w) || !Number.isFinite(size.h) || size.w <= 0 || size.h <= 0) return;
  const scale = Math.min(
    1,
    MAX_STRIP_EDGE / Math.max(size.w, size.h),
    Math.sqrt(MAX_STRIP_PIXELS / (size.w * size.h)),
  );
  if (scale === 1) return;
  return { w: Math.max(1, Math.floor(size.w * scale)), h: Math.max(1, Math.floor(size.h * scale)) };
}
