/**
 * Search configuration: the one MiniSearch options object every index is
 * built and deserialized with, the query-time options of each consumer,
 * stop words, and the English inflection rules Word Study matches with.
 */

import { escapeRegex } from '@codex-scriptura/core';

export const STOP_WORDS = new Set([
    'the','and','of','in','to','a','is','was','that','it','for','his',
    'he','she','her','with','be','not','but','they','shall','unto',
    'upon','from','by','as','all','are','this','them','which','their','were',
]);

/**
 * Constructor options shared by index builds and `loadJSON`. Nothing is
 * stored beside the id (issue #164): a hit is hydrated from the verses
 * table, so a cached index no longer carries a second copy of the text.
 */
export const INDEX_OPTIONS = {
    fields: ['text', 'lemmas'] as string[],
    storeFields: [] as string[],
    idField: 'id',
    processTerm: (term: string): string | null => {
        const t = term.toLowerCase();
        return STOP_WORDS.has(t) ? null : t;
    },
};

/**
 * Identifies how an index was built. Part of the cache key, so bump the
 * leading number whenever `processTerm`, the tokenizer or the stop words
 * change; a field change is picked up on its own.
 */
export const INDEX_CONFIG_KEY = `1:${INDEX_OPTIONS.fields.join(',')}:${INDEX_OPTIONS.storeFields.join(',')}`;

/** Query options of the search page's Full Text mode. */
export const FULLTEXT_SEARCH_OPTIONS = {
    prefix: true,
    fuzzy: (term: string): number => {
        if (/^[hg]\d/i.test(term)) return 0;
        return term.length > 4 ? 0.2 : 0;
    },
    boost: { text: 1 },
};

/** Query options of the command palette: verse text only, no Strong's ids. */
export const PALETTE_SEARCH_OPTIONS = {
    fields: ['text'] as string[],
    prefix: true,
    fuzzy: (term: string): number => (term.length > 4 ? 0.2 : 0),
};

// ─── Word Study inflection rules ──────────────────────────

// The processed corpus uses U+2019 exclusively ("Lord’s" - the KJV alone
// has 1,890 such possessives and zero straight apostrophes), while keyboards
// type U+0027. Widen any apostrophe in the query to match every common form.
const APOSTROPHE_CLASS = "['‘’ʼ]";
function widenApostrophes(escapedWord: string): string {
    return escapedWord.replace(/['‘’ʼ]/g, APOSTROPHE_CLASS);
}

// Consonants English doubles before a vowel suffix: stop/stopped, sin/sinning,
// beg/begged. The set also covers roots that already end doubled (bless,
// pass, confess), which the stemmer collapses to a single letter.
const DOUBLING_CONSONANT = /[bdfglmnprstz]$/;

/**
 * Reduce a query word to the shared root of its inflection family.
 * Suffix strips run longest-first. A doubled consonant that a stripped
 * suffix leaves behind collapses ("stopped" -> "stopp" -> "stop"); an
 * unstripped query keeps its spelling, so "fill" stays "fill" and does not
 * loosen into "fil" (which would admit "filth" and "file").
 */
function stemOf(w: string): string {
    const stripped = w
        .replace(/ieth$/, 'y')   // "glorieth" -> "glory"
        .replace(/ied$/, 'y')    // "gloried"  -> "glory"
        .replace(/ies$/, 'y')    // "glories"  -> "glory"
        .replace(/eth$/, '')     // "loveth"   -> "lov"
        .replace(/est$/, '')     // "lovest"   -> "lov"
        .replace(/ings?$/, '')   // "loving"   -> "lov"
        .replace(/ed$/, '')      // "loved"    -> "lov"
        .replace(/es$/, '')      // "loves"    -> "lov"
        .replace(/(?<!s)s$/, '') // plural/3rd person, but "bless" keeps its root
        .replace(/e$/, '');      // trailing silent e

    if (stripped.length < 3 || stripped === w) return w; // don't over-strip short words
    return stripped.replace(/([bdfglmnprstz])\1$/, '$1');
}

/**
 * Build a word-boundary regex for the given query term.
 *
 * When `includeVariants` is false, produces an exact whole-word match.
 * When true, reduces the query to a stem and matches every spelling the
 * stem takes under inflection: love/loved/loves/loving/loveth/lovest,
 * glory/glories/gloried/glorieth, bless/blessed/blessing, carry/carried,
 * stop/stopped, lie/lying.
 *
 * The stem's own spelling can change under a suffix (y -> i, a doubled
 * consonant), so the pattern alternates on those letters rather than
 * only appending endings to a fixed stem (issue #182).
 */
export function buildWordPattern(word: string, includeVariants: boolean): RegExp | null {
    const w = word.trim().toLowerCase();
    if (!w) return null;

    if (!includeVariants) {
        return new RegExp(`\\b${widenApostrophes(escapeRegex(w))}\\b`, 'gi');
    }

    const build = (stem: string) => {
        let core = widenApostrophes(escapeRegex(stem));
        if (/[^aeiou]y$/.test(stem)) {
            core = core.slice(0, -1) + '(?:y|i)';       // glory / glories
        } else if (/ie$/.test(stem)) {
            core = core.slice(0, -2) + '(?:ie|y(?=ing))'; // lie / lying, but not "dyed"
        } else if (DOUBLING_CONSONANT.test(stem)) {
            core += `${stem.slice(-1)}?`;               // stop / stopped, bles / bless
        }
        return new RegExp(`\\b${core}e?(?:s|d|th|st|ing|ings|er|ers)?\\b`, 'gi');
    };

    const pattern = build(stemOf(w));
    // A stem that no longer matches the query itself has been over-stripped;
    // fall back to the exact word plus endings rather than under-report.
    return new RegExp(pattern.source, pattern.flags).test(w) ? pattern : build(w);
}
