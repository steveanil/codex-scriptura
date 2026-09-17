import type { Translation } from '@codex-scriptura/core';
import { translationDatasetId } from '@codex-scriptura/core';
import { db } from './database.js';

/** Get all available translations. */
export async function getTranslations(): Promise<Translation[]> {
    return db.translations.toArray();
}

/**
 * Ids of translations whose verses are actually present (installed), as
 * opposed to catalog-only `translations` records (issue #238). Index-only
 * scan on the translationId index.
 */
export async function getInstalledTranslationIds(): Promise<string[]> {
    const keys = await db.verses.orderBy('translationId').uniqueKeys();
    return keys.map(String);
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
