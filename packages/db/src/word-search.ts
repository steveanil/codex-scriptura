import type { ConcordanceSearchResult } from '@codex-scriptura/core';
import { escapeRegex } from '@codex-scriptura/core';
import { db } from './database.js';

// ─── Lexical / Concordance Search ─────────────────────────

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

/**
 * Lexical concordance search - exhaustively finds every verse in a translation
 * where a word (or its inflected variants) appears as a complete word token.
 *
 * Unlike MiniSearch full-text search (top-N ranked), this scan is:
 * - Deterministic: returns ALL matching verses, not just top results
 * - Ordered by insertion (canonical Bible) order from the DB
 * - Precise: counts exact occurrences per verse and records surface forms
 *
 * This is the foundation for Strong's-number-based search once a tagged
 * source (e.g. OpenScriptures morphhb/morphgnt) is integrated.
 */
export async function wordSearch(
    translationId: string,
    word: string,
    includeVariants = false
): Promise<ConcordanceSearchResult[]> {
    const pattern = buildWordPattern(word, includeVariants);
    if (!pattern) return [];

    const allVerses = await db.verses
        .where('translationId')
        .equals(translationId)
        .toArray();

    const results: ConcordanceSearchResult[] = [];

    for (const verse of allVerses) {
        // Create a fresh regex per verse to reset lastIndex
        const re = new RegExp(pattern.source, pattern.flags);
        const found = verse.text.match(re);
        if (!found || found.length === 0) continue;

        const surfaceMap = new Map<string, number>();
        for (const m of found) {
            const lc = m.toLowerCase();
            surfaceMap.set(lc, (surfaceMap.get(lc) ?? 0) + 1);
        }

        results.push({
            verse,
            matches: Array.from(surfaceMap.entries()).map(([surface, count]) => ({
                surface,
                count,
            })),
            hitCount: found.length,
        });
    }

    return results;
}
