/**
 * A source is usable when the user hasn't hidden it AND it serves at least one
 * of their enabled content languages. Used by search and the source pickers so
 * disabling a language hides its sources everywhere consistently.
 */
export function isSourceUsable(
  source: { id: string; languages: string[] },
  enabledLanguages: string[],
  hiddenSources: string[],
): boolean {
  if (hiddenSources.includes(source.id)) return false;
  return source.languages.some((l) => enabledLanguages.includes(l));
}

/** The content languages worth toggling: the primary language of each source. */
export function contentLanguages(sources: { languages: string[] }[]): string[] {
  const set = new Set<string>();
  for (const s of sources) if (s.languages[0]) set.add(s.languages[0]);
  return [...set];
}

/**
 * A (source, title) is "dead" only if it returned zero chapters in EVERY one of
 * the given languages. Conservative on purpose: an unchecked language counts as
 * maybe-readable, so we never hide a source we haven't actually confirmed empty.
 */
export function isWorkDead(
  deadKeys: Set<string>,
  sourceId: string,
  externalId: string,
  langs: string[],
): boolean {
  if (langs.length === 0) return false;
  return langs.every((l) => deadKeys.has(`${sourceId}:${externalId}:${l}`));
}
