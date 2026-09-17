import type { SavedSearch } from '@codex-scriptura/core';
import { db } from './database.js';

// ─── Saved Searches ───────────────────────────────────────

/** Get all saved searches, newest first. */
export async function getSavedSearches(): Promise<SavedSearch[]> {
    return db.savedSearches.orderBy('created').reverse().toArray();
}

/** Save or update a saved search. */
export async function saveSearch(search: SavedSearch): Promise<void> {
    await db.savedSearches.put(search);
}

/** Delete a saved search. */
export async function deleteSavedSearch(id: string): Promise<void> {
    await db.savedSearches.delete(id);
}
