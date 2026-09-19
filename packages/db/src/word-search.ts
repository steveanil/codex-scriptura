import type { ConcordanceSearchResult } from '@codex-scriptura/core';
import { db } from './database.js';

// ─── Lexical / Concordance Search ─────────────────────────

/**
 * Lexical concordance search - exhaustively finds every verse in a translation
 * that the pattern matches. The caller builds the pattern; which spellings
 * count as one word is a linguistic question this package does not answer.
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
