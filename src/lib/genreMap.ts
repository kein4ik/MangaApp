/**
 * EN↔RU genre-name bridge for cross-language genre browse. Each provider's
 * genre index speaks ONE language (MangaDex/Mangapill/MangaKatana tags are
 * English, MangaLib/Remanga/Mangabuff are Russian), so before querying a
 * provider we translate the genre into its tag language. Unknown names return
 * null and that provider is simply skipped — better no results than a source
 * silently ignoring the filter and returning its whole unfiltered catalog.
 *
 * Entry shape: [English, primary Russian (MangaLib naming), ...Russian aliases
 * other RU sites use (e.g. Remanga says Экшен for Боевик)]. RU aliases are
 * normalized to the primary name; each RU provider maps the primary to its own
 * id internally (remanga.ts registers the reverse aliases).
 */

const PAIRS: [en: string, ru: string, ...ruAliases: string[]][] = [
  ['Action', 'Боевик', 'Экшен'],
  ['Adventure', 'Приключения'],
  ['Comedy', 'Комедия'],
  ['Drama', 'Драма'],
  ['Fantasy', 'Фэнтези'],
  ['Horror', 'Ужасы'],
  ['Mystery', 'Детектив'],
  ['Sci-Fi', 'Научная фантастика'],
  ['Slice of Life', 'Повседневность'],
  ['Isekai', 'Исекай'],
  ['Thriller', 'Триллер'],
  ['Sports', 'Спорт'],
  ['Romance', 'Романтика'],
  ['Martial Arts', 'Боевые искусства'],
  ['Historical', 'История'],
  ['Psychological', 'Психология'],
  ['Mecha', 'Меха'],
  ['School Life', 'Школа', 'Школьники', 'Школьная жизнь'],
  ['Harem', 'Гарем'],
  ['Military', 'Военное'],
  ['Music', 'Музыка'],
  ['Magic', 'Магия'],
  ['Demons', 'Демоны'],
  ['Vampires', 'Вампиры'],
  ['Police', 'Полиция'],
  ['Tragedy', 'Трагедия'],
  ['Post-Apocalyptic', 'Постапокалиптика'],
  ['Cyberpunk', 'Киберпанк'],
  ['Supernatural', 'Сверхъестественное'],
  // Demographics — not MangaDex tags (miss → []), but real genres on the
  // aggregator sites, so RU titles tagged with them still browse EN sources.
  ['Shounen', 'Сёнэн'],
  ['Shoujo', 'Сёдзё'],
  ['Seinen', 'Сэйнэн'],
  ['Josei', 'Дзёсэй'],
];

const EN2RU = new Map(PAIRS.map(([en, ru]) => [en.toLowerCase(), ru]));
const RU2EN = new Map(
  PAIRS.flatMap(([en, ...rus]) => rus.map((ru) => [ru.toLowerCase(), en] as const)),
);

const hasCyrillic = (s: string) => /[а-яё]/i.test(s);

/** Sources whose genre index uses Russian names; everything else is English. */
const RU_TAG_SOURCES = new Set(['mangalib', 'remanga', 'mangabuff']);

export const tagLanguageOf = (sourceId: string): 'en' | 'ru' =>
  RU_TAG_SOURCES.has(sourceId) ? 'ru' : 'en';

/**
 * Translate a genre name into the given tag language. Known RU aliases collapse
 * to the primary RU name; names already in the right language pass through;
 * unmapped foreign names return null (skip that provider).
 */
export function genreForTagLanguage(genre: string, tagLang: 'en' | 'ru'): string | null {
  const g = genre.trim();
  if (!g) return null;
  const key = g.toLowerCase();
  if (tagLang === 'ru') {
    if (!hasCyrillic(g)) return EN2RU.get(key) ?? null;
    // Normalize alias spellings (Экшен → Боевик) so every RU provider matches.
    const en = RU2EN.get(key);
    return (en && EN2RU.get(en.toLowerCase())) || g;
  }
  return hasCyrillic(g) ? (RU2EN.get(key) ?? null) : g;
}
