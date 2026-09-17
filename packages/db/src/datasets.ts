/**
 * Installed-dataset identity (issue #310, decision D1).
 *
 * One `datasets` row per manifest id the profile holds. Identity is
 * id + version + contentHash; recordCount is a sanity check. The Dexie
 * schema version no longer decides when a dataset re-seeds: on every boot
 * each row is compared with the deploy manifest and only mismatches are
 * replaced. Schema versions move only when the storage shape changes.
 */

import type { Table, Transaction } from 'dexie';
import type { DatasetManifestEntry, InstalledDataset, Translation, VerseRecord } from '@codex-scriptura/core';
import { LEGACY_DATASET_VERSION, translationDatasetId } from '@codex-scriptura/core';
import { db } from './index.js';

export type DatasetState = 'missing' | 'current' | 'stale' | 'legacy';

/** Compare a profile's row with the deploy's entry. Pure, so the states are unit-testable. */
export function compareDataset(installed: InstalledDataset | undefined, entry: DatasetManifestEntry): DatasetState {
    if (!installed) return 'missing';
    if (installed.version === LEGACY_DATASET_VERSION || installed.contentHash === null) return 'legacy';
    if (installed.version !== entry.version || installed.contentHash !== entry.contentHash) return 'stale';
    return 'current';
}

export async function getInstalledDataset(id: string): Promise<InstalledDataset | undefined> {
    return db.datasets.get(id);
}

export async function listInstalledDatasets(): Promise<InstalledDataset[]> {
    return db.datasets.toArray();
}

export async function getDatasetState(entry: DatasetManifestEntry): Promise<DatasetState> {
    return compareDataset(await db.datasets.get(entry.id), entry);
}

/** Drop a dataset's identity row (its records are the caller's business, e.g. removeTranslationData). */
export async function forgetDataset(id: string): Promise<void> {
    await db.datasets.delete(id);
}

export type InstallPlan = {
    /** Tables the replacement writes; locked for the transaction together with `datasets`. */
    tables: Table[];
    /** Remove the previous copy's rows. Runs first, inside the transaction. */
    clear: () => Promise<unknown>;
    /** Write the new rows and return how many were written. */
    insert: () => Promise<number>;
};

/**
 * Replace a dataset's rows and record its manifest identity in one
 * transaction. If any step throws, the transaction aborts and the previous
 * copy survives, rows and identity row alike, so a failed or partial
 * install is retried on the next boot rather than half-trusted.
 */
export async function installDataset(entry: DatasetManifestEntry, plan: InstallPlan, resourceId?: string): Promise<InstalledDataset> {
    return db.transaction('rw', [...plan.tables, db.datasets], async () => {
        await plan.clear();
        const recordCount = await plan.insert();
        const row: InstalledDataset = {
            id: entry.id,
            version: entry.version,
            contentHash: entry.contentHash,
            installedAt: Date.now(),
            recordCount,
            ...(resourceId ? { resourceId } : {}),
        };
        await db.datasets.put(row);
        return row;
    });
}

const INSTALL_BATCH = 10_000;

/** Install a dataset that owns a whole table: clear it, then write the records in batches. */
export function installWholeTable<T>(
    entry: DatasetManifestEntry,
    table: Table<T, string>,
    records: T[],
    onProgress?: (fraction: number) => void,
): Promise<InstalledDataset> {
    return installDataset(entry, {
        tables: [table],
        clear: () => table.clear(),
        insert: async () => {
            for (let i = 0; i < records.length; i += INSTALL_BATCH) {
                const batch = records.slice(i, i + INSTALL_BATCH);
                await table.bulkPut(batch);
                onProgress?.((i + batch.length) / records.length);
            }
            return records.length;
        },
    });
}

const VERSE_BATCH = 5_000;

/**
 * Replacement plan for one translation: its verses, its catalog record and
 * its cached search indexes (they snapshot the verse set, so a stale cache
 * surviving a replaced text would answer searches from the old contents).
 * All of it commits with the identity row or not at all; other
 * translations' caches are never touched.
 */
export function translationInstallPlan(
    translation: Translation,
    verses: VerseRecord[],
    onProgress?: (fraction: number) => void,
): InstallPlan {
    return {
        tables: [db.verses, db.translations, db.searchIndexes],
        clear: async () => {
            await db.verses.where('translationId').equals(translation.id).delete();
            await db.searchIndexes.where('translationId').equals(translation.id).delete();
        },
        insert: async () => {
            await db.translations.put(translation);
            for (let i = 0; i < verses.length; i += VERSE_BATCH) {
                await db.verses.bulkPut(verses.slice(i, i + VERSE_BATCH));
                onProgress?.(Math.min(1, (i + VERSE_BATCH) / verses.length));
            }
            return verses.length;
        },
    };
}

export function installTranslationDataset(
    entry: DatasetManifestEntry,
    translation: Translation,
    verses: VerseRecord[],
    onProgress?: (fraction: number) => void,
): Promise<InstalledDataset> {
    return installDataset(entry, translationInstallPlan(translation, verses, onProgress));
}

/** Datasets that own a whole table, by manifest id. */
const WHOLE_TABLE_DATASETS: Array<[id: string, table: string]> = [
    ['persons', 'persons'],
    ['places', 'places'],
    ['events', 'events'],
    ['dictionary', 'dictionary'],
    ['cross-references', 'crossReferences'],
    ['genealogy', 'relationships'],
    ['naves-topics', 'topics'],
];

/**
 * v30 upgrade: one legacy row per dataset the profile already holds.
 * Every legacy row mismatches the manifest on the next boot and is
 * replaced exactly once; after that no legacy row remains. Nothing else is
 * touched: user tables are not read, and no dataset rows are cleared here.
 */
export async function backfillLegacyDatasets(tx: Transaction): Promise<void> {
    const installedAt = Date.now();
    const rows: InstalledDataset[] = [];
    const legacy = (id: string, recordCount: number) => {
        if (recordCount > 0) rows.push({ id, version: LEGACY_DATASET_VERSION, contentHash: null, installedAt, recordCount });
    };

    const verses = tx.table('verses');
    for (const key of await verses.orderBy('translationId').uniqueKeys()) {
        const translationId = String(key);
        legacy(translationDatasetId(translationId), await verses.where('translationId').equals(translationId).count());
    }

    for (const [id, table] of WHOLE_TABLE_DATASETS) {
        legacy(id, await tx.table(table).count());
    }

    for (const language of ['hebrew', 'greek']) {
        legacy(`lexicon-${language}`, await tx.table('lexicon').where('language').equals(language).count());
    }

    await tx.table('datasets').bulkPut(rows);
}
