import type { Translation } from '@codex-scriptura/core';
import { translationDatasetId } from '@codex-scriptura/core';
import { db } from './database.js';

/** Get all available translations. */
export async function getTranslations(): Promise<Translation[]> {
    return db.translations.toArray();
}

/**
 * Ids of translations that are installed, as opposed to catalog-only
 * `translations` records (issue #238). The dataset receipt is the source
 * of truth (issues #310, #168): it is written only after the last part of
 * a translation lands, so a stale receipt still means a complete older
 * copy, and verse rows without a receipt (an interrupted replacement) do
 * not count as installed.
 */
export async function getInstalledTranslationIds(): Promise<string[]> {
    const [receipts, catalog] = await Promise.all([db.datasets.toArray(), db.translations.toArray()]);
    const ids = new Set(receipts.map((r) => r.id));
    return catalog.filter((t) => ids.has(translationDatasetId(t.id))).map((t) => t.id).sort();
}

/**
 * Remove an installed translation's data (issue #238): its verses, its
 * cached search indexes (they snapshot the verse set) and its dataset
 * identity row. The catalog record stays, with verseCount zeroed, so
 * pickers and the Translation Manager can still offer it for re-download.
 * Callers enforce the UX guards (last-installed, in-use-by-a-pane).
 */
export async function removeTranslationData(translationId: string): Promise<void> {
    await db.transaction('rw', [db.verses, db.searchIndexes, db.translations, db.datasets], async () => {
        await db.verses.where('translationId').equals(translationId).delete();
        await db.searchIndexes.where('translationId').equals(translationId).delete();
        await db.translations.update(translationId, { verseCount: 0 });
        await db.datasets.delete(translationDatasetId(translationId));
    });
}
