/**
 * Search configuration: the one MiniSearch options object every index is
 * built and deserialized with, the query-time options of each consumer,
 * stop words, and the English inflection rules Word Study matches with.
 */

import MiniSearch from 'minisearch';
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
 *
 * `stems` indexes the verse text a second time for Word Study (issue
 * #166): every term reduced by `stemOf`, stop words kept, because a
 * concordance of "unto" or "shall" is a legitimate exhaustive search. Raw
 * terms and stems never share a field: the stemmer maps "made" to "mad"
 * and "wine" to "win", which must not leak into Full Text.
 */
export const INDEX_OPTIONS = {
    fields: ['text', 'stems', 'lemmas'] as string[],
    storeFields: [] as string[],
    idField: 'id',
    extractField: (doc: object, fieldName: string): unknown =>
        (doc as Record<string, unknown>)[fieldName === 'stems' ? 'text' : fieldName],
    // Queries arrive without a field name and take the raw-term path
    processTerm: (term: string, fieldName?: string): string | null => {
        const t = term.toLowerCase();
        if (fieldName === 'stems') return stemOf(t);
        return STOP_WORDS.has(t) ? null : t;
    },
};

/**
 * Identifies how an index was built. Part of the cache key, so bump the
 * leading number whenever `processTerm`, the tokenizer or the stop words
 * change; a field change is picked up on its own.
 */
export const INDEX_CONFIG_KEY = `2:${INDEX_OPTIONS.fields.join(',')}:${INDEX_OPTIONS.storeFields.join(',')}`;

/** Query options of the search page's Full Text mode. */
export const FULLTEXT_SEARCH_OPTIONS = {
    fields: ['text', 'lemmas'] as string[],
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

/**
 * Query options of Word Study's candidate lookup: exact stems only. The
 * terms arrive already tokenized and stemmed (`candidateStems`), so the
 * query side must not process them again.
 */
export const STEMS_SEARCH_OPTIONS = {
    fields: ['stems'] as string[],
    prefix: false,
    fuzzy: false,
    tokenize: (term: string): string[] => [term],
    processTerm: (term: string): string => term,
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

const ENDINGS = ['', 's', 'd', 'th', 'st', 'ing', 'ings', 'er', 'ers'];

/**
 * Every spelling a stem takes under inflection. The stem's own spelling
 * can change under a suffix (y -> i, a doubled consonant), so those
 * letters alternate rather than only appending endings to a fixed stem
 * (issue #182).
 */
function inflectedForms(stem: string): string[] {
    let cores = [stem];
    const forms: string[] = [];
    if (/[^aeiou]y$/.test(stem)) {
        cores = [stem, stem.slice(0, -1) + 'i'];       // glory / glories
    } else if (/ie$/.test(stem)) {
        const base = stem.slice(0, -2);
        forms.push(`${base}ying`, `${base}yings`);     // lie / lying, but not "dyed"
    } else if (DOUBLING_CONSONANT.test(stem)) {
        cores = [stem, stem + stem.slice(-1)];         // stop / stopped, bles / bless
    }
    for (const core of cores) {
        for (const e of ['', 'e']) {
            for (const ending of ENDINGS) forms.push(core + e + ending);
        }
    }
    return forms;
}

/**
 * The spellings that count as the query word. Exact mode: the word alone.
 * With variants: the inflection family of its stem, as in
 * love/loved/loves/loving/loveth/lovest, glory/glories/gloried/glorieth,
 * bless/blessed/blessing, carry/carried, stop/stopped, lie/lying.
 */
function wordForms(word: string, includeVariants: boolean): string[] {
    const w = word.trim().toLowerCase();
    if (!w) return [];
    if (!includeVariants) return [w];
    const forms = inflectedForms(stemOf(w));
    // A stem whose family no longer holds the query itself has been
    // over-stripped; fall back to the exact word plus endings rather than
    // under-report.
    return forms.includes(w) ? forms : inflectedForms(w);
}

/** Whole-word regex over the spellings `wordForms` allows, or null for an empty query. */
export function buildWordPattern(word: string, includeVariants: boolean): RegExp | null {
    const forms = wordForms(word, includeVariants);
    if (forms.length === 0) return null;
    // Longest first: an apostrophe is a word boundary, so "lord'" would otherwise win over "lord's"
    const alternatives = [...forms].sort((a, b) => b.length - a.length).map((f) => widenApostrophes(escapeRegex(f)));
    const body = alternatives.length === 1 ? alternatives[0] : `(?:${alternatives.join('|')})`;
    return new RegExp(`\\b${body}\\b`, 'gi');
}

const tokenize = MiniSearch.getDefault('tokenize') as (text: string) => string[];

/**
 * The `stems` lookup that finds every verse `buildWordPattern` can match:
 * one group of stems per allowed spelling, all of a group required in a
 * verse, any group sufficient. Each spelling goes through the tokenizer
 * and stemmer the index was built with ("lord's" is the terms "lord" and
 * "s" there too), so the candidates are a superset of the regex's verses
 * and the regex stays the judge of what is a hit.
 */
export function candidateStems(word: string, includeVariants: boolean): string[][] {
    const groups = new Map<string, string[]>();
    for (const form of wordForms(word, includeVariants)) {
        // U+02BC is a letter to the tokenizer; the corpus apostrophe (U+2019) splits
        const stems = [...new Set(tokenize(form.replace(/['‘’ʼ]/g, "'")).filter(Boolean).map(stemOf))];
        if (stems.length > 0) groups.set(stems.join(' '), stems);
    }
    return [...groups.values()];
}
