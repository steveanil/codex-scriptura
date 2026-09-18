import type { CrossReference, BookConnectionMatrix } from '@codex-scriptura/core';
import { db } from './database.js';

// ─── Cross-Reference Queries ──────────────────────────────

/** Get all cross-references FROM a given verse (outbound edges). */
export async function getCrossReferencesFrom(osisId: string): Promise<CrossReference[]> {
    return db.crossReferences
        .where('sourceVerse')
        .equals(osisId)
        .toArray();
}

/** Get all cross-references TO a given verse (inbound edges). */
export async function getCrossReferencesTo(osisId: string): Promise<CrossReference[]> {
    return db.crossReferences
        .where('targetVerse')
        .equals(osisId)
        .toArray();
}

/**
 * Get all cross-references touching a verse, whichever end it is on.
 * Each pair is stored once, oriented later verse -> earlier verse (issue
 * #183), so the two index scans are disjoint; the id dedup is a guard.
 */
export async function getCrossReferencesForVerse(osisId: string): Promise<CrossReference[]> {
    const [from, to] = await Promise.all([
        getCrossReferencesFrom(osisId),
        getCrossReferencesTo(osisId),
    ]);

    // Deduplicate by ID
    const seen = new Set<string>();
    const result: CrossReference[] = [];
    for (const ref of [...from, ...to]) {
        if (!seen.has(ref.id)) {
            seen.add(ref.id);
            result.push(ref);
        }
    }
    return result;
}

/** Get all cross-references where the source verse is in the given book. */
export async function getCrossReferencesFromBook(book: string): Promise<CrossReference[]> {
    return db.crossReferences
        .where('sourceVerse')
        .startsWith(`${book}.`)
        .toArray();
}

/** Get all cross-references where the target verse is in the given book. */
export async function getCrossReferencesToBook(book: string): Promise<CrossReference[]> {
    return db.crossReferences
        .where('targetVerse')
        .startsWith(`${book}.`)
        .toArray();
}

/**
 * Get every cross-reference touching a chapter, keyed by the verse in
 * that chapter. A pair is stored once (later verse -> earlier verse,
 * issue #183), so both indexes are prefix-scanned and each record is
 * filed under whichever endpoint lies in the chapter - under both when
 * the link is intra-chapter. The caller reads the other endpoint as
 * `ref.sourceVerse === osisId ? ref.targetVerse : ref.sourceVerse`.
 *
 * Sorted by descending votes within each verse group so the UI can
 * slice the top-N without re-sorting.
 */
export async function getCrossReferencesForChapter(
    book: string,
    chapter: number,
): Promise<Map<string, CrossReference[]>> {
    const prefix = `${book}.${chapter}.`;
    const [asSource, asTarget] = await Promise.all([
        db.crossReferences.where('sourceVerse').startsWith(prefix).toArray(),
        db.crossReferences.where('targetVerse').startsWith(prefix).toArray(),
    ]);

    const map = new Map<string, CrossReference[]>();
    const file = (osisId: string, ref: CrossReference) => {
        let arr = map.get(osisId);
        if (!arr) { arr = []; map.set(osisId, arr); }
        arr.push(ref);
    };
    for (const ref of asSource) file(ref.sourceVerse, ref);
    for (const ref of asTarget) file(ref.targetVerse, ref);

    // Sort each group by votes descending (highest-confidence first)
    for (const arr of map.values()) {
        arr.sort((a, b) => b.votes - a.votes);
    }

    return map;
}

/**
 * Get all cross-references between two books (both directions).
 *
 * When bookA === bookB, returns intra-book cross-references only.
 * Otherwise returns all edges where one endpoint is in bookA and
 * the other is in bookB.
 *
 * Uses the `sourceVerse` index to range-scan each book, then filters
 * the target in memory - fast because each book has O(1K–20K) source refs.
 */
export async function getCrossReferencesBetweenBooks(
    bookA: string,
    bookB: string,
): Promise<CrossReference[]> {
    if (bookA === bookB) {
        return db.crossReferences
            .where('sourceVerse').startsWith(`${bookA}.`)
            .filter(r => r.targetVerse.startsWith(`${bookA}.`))
            .toArray();
    }

    const [aToB, bToA] = await Promise.all([
        db.crossReferences
            .where('sourceVerse').startsWith(`${bookA}.`)
            .filter(r => r.targetVerse.startsWith(`${bookB}.`))
            .toArray(),
        db.crossReferences
            .where('sourceVerse').startsWith(`${bookB}.`)
            .filter(r => r.targetVerse.startsWith(`${bookA}.`))
            .toArray(),
    ]);

    return [...aToB, ...bToA];
}
