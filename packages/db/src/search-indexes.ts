import type { SearchIndexCache } from '@codex-scriptura/core';
import { db } from './database.js';

// ─── Search Index Cache ────────────────────────────────────

/** Retrieve a cached MiniSearch index by its id key (e.g. "minisearch:KJV", "palette:KJV"). */
export async function getCachedSearchIndex(id: string): Promise<SearchIndexCache | undefined> {
    return db.searchIndexes.get(id);
}

/** Persist a serialized MiniSearch index for a translation. */
export async function saveCachedSearchIndex(entry: SearchIndexCache): Promise<void> {
    await db.searchIndexes.put(entry);
}

/** Clear all cached search indexes (e.g. after re-seeding translation data). */
export async function clearCachedSearchIndexes(): Promise<void> {
    await db.searchIndexes.clear();
}
