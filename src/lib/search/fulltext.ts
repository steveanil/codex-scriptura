/**
 * Full Text mode: best-matching verses for a phrase, ranked by MiniSearch
 * with an exact-phrase boost, merged across translations.
 */

import { findBook } from '@codex-scriptura/core';
import type { VerseRecord } from '@codex-scriptura/core';
import { db } from '@codex-scriptura/db';
import { FULLTEXT_SEARCH_OPTIONS, STOP_WORDS } from './config';
import type { SearchIndex } from './index-manager';

export type FullTextHit = VerseRecord & { score: number };
export type Testament = 'all' | 'OT' | 'NT' | 'AP';

const PHRASE_BOOST = 50;
const ALL_WORDS_BOOST = 15;
// A long phrase matches 10K+ verses on its individual words. Only the best
// of them are read back for the phrase check: a verse that holds the whole
// phrase already scores near the top on those words.
const RERANK_CANDIDATES = 500;

/** Verse ids are `${translationId}.${osisId}`, so the book is readable without the record. */
export function bookOfVerseId(id: string): string {
    return id.split('.')[1];
}

async function hydrate(ids: string[]): Promise<Map<string, VerseRecord>> {
    const records = await db.verses.bulkGet(ids);
    const byId = new Map<string, VerseRecord>();
    for (const record of records) if (record) byId.set(record.id, record);
    return byId;
}

/**
 * Search every given index and return the top `limit` verses overall.
 * Indexes store ids only, so the text a multi-word query is re-ranked by,
 * and the records returned, are read from the verses table.
 */
export async function searchFullText(
    indexes: SearchIndex[],
    query: string,
    { limit = 50, testament = 'all' }: { limit?: number; testament?: Testament } = {},
): Promise<FullTextHit[]> {
    const q = query.trim();
    if (!q) return [];

    let scored: { id: string; score: number }[] = [];
    for (const index of indexes) {
        for (const r of index.search(q, FULLTEXT_SEARCH_OPTIONS)) scored.push({ id: r.id as string, score: r.score });
    }
    if (testament !== 'all') {
        scored = scored.filter((r) => findBook(bookOfVerseId(r.id))?.testament === testament);
    }

    scored.sort((a, b) => b.score - a.score);

    const qlc = q.toLowerCase();
    let records: Map<string, VerseRecord> | null = null;
    if (qlc.includes(' ')) {
        // A verse holding the exact phrase outranks one that merely scores well on its words
        scored = scored.slice(0, Math.max(RERANK_CANDIDATES, limit));
        records = await hydrate(scored.map((r) => r.id));
        const words = qlc.split(/\s+/).filter((w) => !STOP_WORDS.has(w));
        for (const r of scored) {
            const textLc = records.get(r.id)?.text.toLowerCase() ?? '';
            if (textLc.includes(qlc)) r.score += PHRASE_BOOST;
            else if (words.length > 1 && words.every((w) => textLc.includes(w))) r.score += ALL_WORDS_BOOST;
        }
        scored.sort((a, b) => b.score - a.score);
    }

    const top = scored.slice(0, limit);
    records ??= await hydrate(top.map((r) => r.id));

    const hits: FullTextHit[] = [];
    for (const { id, score } of top) {
        const record = records.get(id);
        if (record) hits.push({ ...record, score });
    }
    return hits;
}
