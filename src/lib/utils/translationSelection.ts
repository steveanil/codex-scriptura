/**
 * Which translation should render a passage (issue #404). A canonical
 * reference exists independently of any translation; whether a translation
 * can render it is a capability question over the installed data. Both
 * Reader paths that pick a translation automatically - the offers in the
 * unsupported-book empty state and the translation for a new split pane -
 * answer it here, so the policy has one source of truth:
 *
 *   filter: installed, has the book, not excluded by the caller
 *   rank:   the stored preference, then KJV, then catalog order
 *
 * Nothing here writes the preference. An automatic pick is an effective
 * translation, never a new preferred one.
 */
import { DEFAULT_TRANSLATION } from './activeTranslation';

/** An installed translation and the books it holds on this device. */
export type TranslationCoverage = { id: string; books: readonly string[] };

export type RankOptions = {
    /** The user's stored preference; ranked first when eligible, ignored otherwise. */
    preferredId?: string | null;
    excludeIds?: readonly string[];
};

/** Candidates that contain `book`, ranked. Ties keep the candidates' own (catalog) order. */
export function rankTranslationsForBook<T extends TranslationCoverage>(
    book: string,
    candidates: readonly T[],
    { preferredId, excludeIds = [] }: RankOptions = {},
): T[] {
    const tier = (id: string) => (id === preferredId ? 0 : id === DEFAULT_TRANSLATION ? 1 : 2);
    return candidates
        .map((c, order) => ({ c, order }))
        .filter(({ c }) => !excludeIds.includes(c.id) && c.books.includes(book))
        .sort((a, b) => tier(a.c.id) - tier(b.c.id) || a.order - b.order)
        .map(({ c }) => c);
}

export type SplitPickOptions = RankOptions & {
    /** Translations the open panes already show. */
    inUse: readonly string[];
    /** The pane the new one is opened from. */
    sourceId?: string | null;
};

/**
 * Translation for a new split pane: compatibility first, uniqueness
 * second, source-pane affinity third. A compatible translation that is
 * already in use is a valid answer (two panes on KJV compare nothing,
 * but the pane still reads); null only when no installed translation
 * contains the book.
 */
export function pickSplitTranslation<T extends TranslationCoverage>(
    book: string,
    candidates: readonly T[],
    { inUse, sourceId, ...rank }: SplitPickOptions,
): string | null {
    const ranked = rankTranslationsForBook(book, candidates, rank);
    if (ranked.length === 0) return null;
    const unused = ranked.find((t) => !inUse.includes(t.id));
    if (unused) return unused.id;
    if (sourceId && ranked.some((t) => t.id === sourceId)) return sourceId;
    return ranked[0].id;
}
