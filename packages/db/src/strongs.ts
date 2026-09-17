import type { VerseRecord, Translation, ConcordanceSearchResult, LexiconEntry, AlignedSpan, LemmaGroup, LemmaSearchResult } from '@codex-scriptura/core';
import { findBook, compareCanonical } from '@codex-scriptura/core';
import { db } from './database.js';
import { getVerse } from './verses.js';
import { buildWordPattern } from './word-search.js';

/**
 * Normalize a query that looks like a Strong's number to its canonical ID
 * ("h7225" → "H7225"), or return null when the query isn't one.
 * Leading zeros are stripped: sources write both G0026 and G26.
 */
export function parseStrongsQuery(query: string): string | null {
    const m = query.trim().match(/^([HGhg])0*(\d{1,5})$/);
    if (!m) return null;
    return `${m[1].toUpperCase()}${m[2]}`;
}

/**
 * Strong's-number concordance search - finds every verse in a translation
 * whose lemma tokens include the given Strong's ID, in canonical order.
 *
 * Only translations imported from morphologically tagged sources carry
 * VerseRecord.lemmas (Translation.strongs is true for them); an untagged
 * translation simply yields no results. Like wordSearch this is a full
 * scan of the translation's verses, so it's suited to interactive use,
 * not tight loops.
 */
export async function strongsSearch(
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

// ─── Word-Aligned Lemma Search (issue #27) ─────────────────

/**
 * Parse a VerseRecord.align JSON string into typed spans.
 * Returns an empty array for absent or malformed alignment.
 */
export function parseAlignment(align: string | undefined): AlignedSpan[] {
    if (!align) return [];
    try {
        const raw = JSON.parse(align) as [number, number, string][];
        return raw.map(([start, end, strongs]) => ({ start, end, strongs: strongs.split(' ') }));
    } catch {
        return [];
    }
}

/**
 * Lemma-grouped word study search - the Strong's Exhaustive Concordance
 * workflow. Finds every occurrence of an English word (or its inflected
 * variants), then uses word-aligned Strong's spans to attribute each
 * occurrence to its underlying lemma: "love" groups into agapao (G25),
 * phileo (G5368), ahab (H157)…, each carrying its lexicon entry.
 *
 * Occurrences not covered by any span (translator-supplied words, untagged
 * stretches) collect in a trailing group with strongsId null. An occurrence
 * whose span carries several Strong's IDs (e.g. an H853 particle riding on
 * the noun) is attributed to each ID, but totalHits counts it once.
 *
 * Like wordSearch this is a full scan of the translation's verses - suited
 * to interactive use. Untagged translations yield only the null group.
 */
export async function lemmaGroupSearch(
    translationId: string,
    word: string,
    includeVariants = false,
    testament: 'all' | 'OT' | 'NT' | 'AP' = 'all'
): Promise<LemmaSearchResult> {
    const empty: LemmaSearchResult = { groups: [], totalHits: 0, totalVerses: 0 };
    const pattern = buildWordPattern(word, includeVariants);
    if (!pattern) return empty;

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

/**
 * Get all lexicon entries whose Strong's numbers appear in a given verse.
 * Returns an empty array for verses of untagged translations.
 */
export async function getStrongsForVerse(
    translationId: string,
    osisId: string
): Promise<LexiconEntry[]> {
    const verse = await getVerse(translationId, osisId);
    if (!verse?.lemmas) return [];
    const ids = [...new Set(verse.lemmas.split(' ').filter(Boolean))];
    const entries = await db.lexicon.bulkGet(ids);
    return entries.filter((e): e is LexiconEntry => Boolean(e));
}
