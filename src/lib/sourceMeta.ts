/** Display name + brand-ish accent per source, used for badges and cards. */
export const SOURCE_META: Record<string, { name: string; color: string }> = {
  mangadex: { name: 'MangaDex', color: '#FF6740' },
  mangapill: { name: 'Mangapill', color: '#E5B53A' },
  mangalib: { name: 'MangaLib', color: '#7C5CFC' },
  remanga: { name: 'Remanga', color: '#3FB97A' },
  mangabuff: { name: 'Mangabuff', color: '#1FB6C9' },
  anilist: { name: 'AniList', color: '#3DB4F2' },
};

const FALLBACK_COLORS = ['#E5544B', '#E5B53A', '#1FB6C9', '#D4537E'];

export function sourceMeta(id: string, index = 0): { name: string; color: string } {
  return (
    SOURCE_META[id] ?? {
      name: id.charAt(0).toUpperCase() + id.slice(1),
      color: FALLBACK_COLORS[index % FALLBACK_COLORS.length],
    }
  );
}
