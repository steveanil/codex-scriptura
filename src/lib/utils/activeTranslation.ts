/**
 * Which translation a reader opens on (issue #401). The persisted
 * preference wins when it is installed. When it is not - removed in the
 * Translation Manager, mid-replacement, an unknown id, or junk in the
 * settings row - the reader opens on KJV if it is installed, else on the
 * first installed translation, and reports that it fell back so the
 * caller does not write the stand-in over the user's preference.
 */

export const DEFAULT_TRANSLATION = 'KJV';

export type ResolvedTranslation = {
    /** Null only when nothing is installed. */
    id: string | null;
    /** True when a persisted choice existed but could not be honoured. */
    fellBack: boolean;
};

export function resolveActiveTranslation(persisted: unknown, installed: readonly string[]): ResolvedTranslation {
    const wanted = typeof persisted === 'string' && persisted.length > 0 ? persisted : null;
    if (wanted !== null && installed.includes(wanted)) return { id: wanted, fellBack: false };
    const fallback = installed.includes(DEFAULT_TRANSLATION) ? DEFAULT_TRANSLATION : installed[0] ?? null;
    // No persisted choice is a fresh profile: the default is the default, not a fallback
    return { id: fallback, fellBack: wanted !== null && fallback !== null };
}
