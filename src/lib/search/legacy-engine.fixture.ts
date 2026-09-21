/**
 * TEMPORARY (issue #166): the search engine as it stood on develop before
 * the indexed concordance, kept only so equivalence.test.ts can prove the
 * new engine returns the same results. Delete both once that is
 * established. Copied verbatim apart from imports.
 */

import type { VerseRecord, ConcordanceSearchResult, AlignedSpan, LemmaGroup, LemmaSearchResult } from '@codex-scriptura/core';
import { findBook, compareCanonical, escapeRegex } from '@codex-scriptura/core';
import { db, parseStrongsQuery, parseAlignment } from '@codex-scriptura/db';

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
export function legacyBuildWordPattern(word: string, includeVariants: boolean): RegExp | null {
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

export async function legacyWordSearch(
    translationId: string,
    pattern: RegExp,
): Promise<ConcordanceSearchResult[]> {
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

export async function legacyStrongsSearch(
    translationId: string,
    strongsId: string
): Promise<ConcordanceSearchResult[]> {
    const id = parseStrongsQuery(strongsId);
    if (!id) return [];

    const allVerses = await db.verses
        .where('translationId')
        .equals(translationId)
        .toArray();

    const results: ConcordanceSearchResult[] = [];
    for (const verse of allVerses) {
        if (!verse.lemmas) continue;
        let count = 0;
        for (const token of verse.lemmas.split(' ')) {
            if (token === id) count++;
        }
        if (count === 0) continue;

        // With word alignment, report the actual English renderings and the
        // true occurrence count (the verse-level lemma bag is deduplicated,
        // so `count` under-reports repeats within a verse).
        const spans = parseAlignment(verse.align).filter(s => s.strongs.includes(id));
        if (spans.length > 0) {
            const surfaceMap = new Map<string, number>();
            for (const s of spans) {
                const surface = verse.text.slice(s.start, s.end).toLowerCase();
                surfaceMap.set(surface, (surfaceMap.get(surface) ?? 0) + 1);
            }
            results.push({
                verse,
                matches: Array.from(surfaceMap.entries()).map(([surface, c]) => ({ surface, count: c })),
                hitCount: spans.length,
            });
        } else {
            // No alignment for this verse (untagged rendering such as an
            // unexpressed particle, or alignment dropped by the importer's
            // verification) - the ID itself stands in as the surface.
            results.push({
                verse,
                matches: [{ surface: id, count }],
                hitCount: count,
            });
        }
    }
    return results;
}

export async function legacyLemmaGroupSearch(
    translationId: string,
    pattern: RegExp,
    testament: 'all' | 'OT' | 'NT' | 'AP' = 'all'
): Promise<LemmaSearchResult> {

    const allVerses = await db.verses
        .where('translationId')
        .equals(translationId)
        .toArray();

    type Acc = {
        hitCount: number;
        surfaces: Map<string, number>;
        verses: Map<string, { verse: VerseRecord; surfaces: Map<string, number> }>;
    };
    const groups = new Map<string | null, Acc>();
    const bump = (key: string | null, verse: VerseRecord, surface: string) => {
        let acc = groups.get(key);
        if (!acc) {
            acc = { hitCount: 0, surfaces: new Map(), verses: new Map() };
            groups.set(key, acc);
        }
        acc.hitCount++;
        acc.surfaces.set(surface, (acc.surfaces.get(surface) ?? 0) + 1);
        let entry = acc.verses.get(verse.id);
        if (!entry) {
            entry = { verse, surfaces: new Map() };
            acc.verses.set(verse.id, entry);
        }
        entry.surfaces.set(surface, (entry.surfaces.get(surface) ?? 0) + 1);
    };

    let totalHits = 0;
    let totalVerses = 0;

    for (const verse of allVerses) {
        if (testament !== 'all' && findBook(verse.book)?.testament !== testament) continue;
        const re = new RegExp(pattern.source, pattern.flags);
        let spans: AlignedSpan[] | null = null;
        let verseHit = false;
        for (const m of verse.text.matchAll(re)) {
            const start = m.index ?? 0;
            const end = start + m[0].length;
            const surface = m[0].toLowerCase();
            totalHits++;
            verseHit = true;
            if (spans === null) spans = parseAlignment(verse.align);
            const covering = spans.filter(s => s.start < end && s.end > start);
            if (covering.length === 0) {
                bump(null, verse, surface);
            } else {
                const ids = new Set<string>();
                for (const s of covering) for (const sid of s.strongs) ids.add(sid);
                for (const sid of ids) bump(sid, verse, surface);
            }
        }
        if (verseHit) totalVerses++;
    }

    const ids = Array.from(groups.keys()).filter((k): k is string => k !== null);
    const entries = await db.lexicon.bulkGet(ids);
    const entryMap = new Map(ids.map((sid, i) => [sid, entries[i] ?? null]));

    const result: LemmaGroup[] = Array.from(groups.entries()).map(([key, acc]) => ({
        strongsId: key,
        entry: key ? entryMap.get(key) ?? null : null,
        hitCount: acc.hitCount,
        surfaces: Array.from(acc.surfaces.entries())
            .map(([surface, count]) => ({ surface, count }))
            .sort((a, b) => b.count - a.count),
        results: Array.from(acc.verses.values())
            .map(({ verse, surfaces }) => ({
                verse,
                matches: Array.from(surfaces.entries()).map(([surface, count]) => ({ surface, count })),
                hitCount: Array.from(surfaces.values()).reduce((s, c) => s + c, 0),
            }))
            .sort((a, b) => compareCanonical(a.verse, b.verse)),
    }));

    // Largest groups first; the untagged bucket always sinks to the end.
    result.sort((a, b) =>
        (a.strongsId === null ? 1 : 0) - (b.strongsId === null ? 1 : 0) ||
        b.hitCount - a.hitCount
    );

    return { groups: result, totalHits, totalVerses };
}
