/**
 * Shared MiniSearch configuration and stop words.
 *
 * Extracted so the full search page, command palette, and cache
 * serialization/deserialization all use identical options.
 */

export const STOP_WORDS = new Set([
    'the','and','of','in','to','a','is','was','that','it','for','his',
    'he','she','her','with','be','not','but','they','shall','unto',
    'upon','from','by','as','all','are','this','them','which','their','were',
]);

/**
 * MiniSearch constructor options shared between the search page index
 * and loadJSON deserialization.  The `searchOptions` key is only used
 * by new MiniSearch(...) — loadJSON ignores it — but keeping a single
 * source of truth avoids drift.
 */
export const FULL_SEARCH_OPTIONS = {
    fields: ['text', 'lemmas'] as string[],
    storeFields: ['id', 'translationId', 'book', 'chapter', 'verse', 'osisId', 'text', 'lemmas'] as string[],
    idField: 'id',
    processTerm: (term: string): string | null => {
        const t = term.toLowerCase();
        return STOP_WORDS.has(t) ? null : t;
    },
    searchOptions: {
        prefix: true,
        fuzzy: (term: string): number => {
            if (/^[hg]\d/i.test(term)) return 0;
            return term.length > 4 ? 0.2 : 0;
        },
        boost: { text: 1 },
    },
};

/**
 * MiniSearch constructor options for the command palette.
 * Simpler than the full search — fewer stored fields, no lemmas.
 */
export const PALETTE_SEARCH_OPTIONS = {
    fields: ['text'] as string[],
    storeFields: ['book', 'chapter', 'verse', 'text'] as string[],
    idField: 'id',
    processTerm: (term: string): string | null => {
        const t = term.toLowerCase();
        return STOP_WORDS.has(t) ? null : t;
    },
};
