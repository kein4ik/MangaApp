/**
 * Sources taken out of the app. Whatever still points at them — library rows,
 * progress, downloads, settings, the persisted query cache — is cleaned up on
 * start, so nothing in the UI leads to a source that no longer exists.
 *
 * - mangabuff: blocked outside Russia (2026-10).
 */
export const REMOVED_SOURCES: readonly string[] = ['mangabuff'];

export const isRemovedSource = (id: string) => REMOVED_SOURCES.includes(id);
