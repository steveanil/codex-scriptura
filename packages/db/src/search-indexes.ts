import type { SearchIndexCache } from '@codex-scriptura/core';
import { db } from './database.js';

// ─── Search Index Cache ────────────────────────────────────

/** Retrieve a cached MiniSearch index by its id (e.g. "minisearch:KJV"). */
export async function getCachedSearchIndex(id: string): Promise<SearchIndexCache | undefined> {
    return db.searchIndexes.get(id);
}

/** Persist a serialized MiniSearch index, replacing every record cached for its translation. */
export async function saveCachedSearchIndex(entry: SearchIndexCache): Promise<void> {
    await db.transaction('rw', db.searchIndexes, async () => {
        await db.searchIndexes.where('translationId').equals(entry.translationId).delete();
        await db.searchIndexes.put(entry);
    });
}

/** Clear all cached search indexes (e.g. after re-seeding translation data). */
export async function clearCachedSearchIndexes(): Promise<void> {
    await db.searchIndexes.clear();
}
