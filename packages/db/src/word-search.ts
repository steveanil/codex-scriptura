import type { ConcordanceSearchResult } from '@codex-scriptura/core';
import { db } from './database.js';

// ─── Lexical / Concordance Search ─────────────────────────

/**
 * Lexical concordance search - every verse among the candidates that the
 * pattern matches, with exact occurrence counts and surface forms. The
 * caller builds the pattern and finds the candidates (the search index's
 * `stems` field, issue #166); which spellings count as one word is a
 * linguistic question this package does not answer.
 *
 * Unlike MiniSearch full-text search (top-N ranked), the result is
 * exhaustive and deterministic: every candidate is read and checked.
 */
export async function wordSearch(
    verseIds: string[],
    pattern: RegExp,
): Promise<ConcordanceSearchResult[]> {
    const candidates = await db.verses.bulkGet(verseIds);

    const results: ConcordanceSearchResult[] = [];

    for (const verse of candidates) {
        if (!verse) continue;
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
