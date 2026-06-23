/**
 * Strip HTML/markdown noise from source descriptions so the reader sees clean
 * text (some MangaDex descriptions arrive wrapped in <p>…</p> or with markdown
 * links). Kept deliberately simple — just enough to render nicely.
 */
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

export function cleanDescription(input?: string | null): string {
  if (!input) return '';
  return input
    .replace(/<\s*br\s*\/?>/gi, '\n') // <br> -> newline
    .replace(/<\/p>/gi, '\n\n') // paragraph breaks
    .replace(/<[^>]+>/g, '') // any other tags
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // markdown links -> text
    .replace(/&#?\w+;/g, (m) => ENTITIES[m] ?? '') // entities
    .replace(/\n{3,}/g, '\n\n') // collapse blank lines
    .trim();
}
