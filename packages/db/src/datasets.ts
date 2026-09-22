/**
 * Installed-dataset identity (issue #310, decision D1).
 *
 * One `datasets` row per manifest id the profile holds. Identity is
 * id + version + contentHash; recordCount is a sanity check. The Dexie
 * schema version no longer decides when a dataset re-seeds: on every boot
 * each row is compared with the deploy manifest and only mismatches are
 * replaced. Schema versions move only when the storage shape changes.
 */

import { liveQuery, type EntityTable, type Observable, type Table } from 'dexie';
import type { DatasetManifestEntry, DatasetPart, InstalledDataset, StrongsPosting, Translation, VerseRecord } from '@codex-scriptura/core';
import { LEGACY_DATASET_VERSION, strongsIndexDatasetId } from '@codex-scriptura/core';
import { db } from './database.js';

export type DatasetState = 'missing' | 'current' | 'stale' | 'legacy';

/** Compare a profile's row with the deploy's entry. Pure, so the states are unit-testable. */
export function compareDataset(installed: InstalledDataset | undefined, entry: DatasetManifestEntry): DatasetState {
    if (!installed) return 'missing';
    if (installed.version === LEGACY_DATASET_VERSION || installed.contentHash === null) return 'legacy';
    if (installed.version !== entry.version || installed.contentHash !== entry.contentHash) return 'stale';
    return 'current';
}

/** A table a dataset installs into (string primary key `id`); the app names tables through this rather than importing dexie itself. */
export type DatasetTable<T extends { id: string }> = EntityTable<T, 'id'>;

/** Every identity row, re-emitted whenever one is written or removed, so the UI can light features up as datasets land. */
export function observeInstalledDatasets(): Observable<InstalledDataset[]> {
    return liveQuery(() => db.datasets.toArray());
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

/**
 * How one dataset's records land in the database. Transport-agnostic: the
 * parts come from any `AsyncIterable<DatasetPart<T>>` (split JSON today,
 * `.csdata` chunks later, one array in tests).
 */
export type StreamInstallPlan<T> = {
    /** Tables the install writes; locked for every transaction together with `datasets`. */
    tables: Table[];
    /** Remove the previous copy's rows. Runs in the first transaction with the identity row's removal. */
    clear: () => Promise<unknown>;
    /** Write one part's records in its own transaction; `report` takes the fraction of this part written. Returns how many were written. */
    insertPart: (records: T[], report: (fraction: number) => void) => Promise<number>;
    /** Runs in the last transaction with the identity row, e.g. to write a catalog record with the final count. */
    finish?: (recordCount: number) => Promise<unknown>;
};

/**
 * Install a dataset part by part (issue #168): the previous copy and its
 * identity row go in the first transaction, each part lands in its own,
 * and the identity row is written last. The whole dataset is never in
 * memory at once. An interruption at any point leaves no identity row, so
 * the dataset reads as `missing` and is reinstalled from scratch on the
 * next boot; a half-written table is never mistaken for a current one.
 */
export async function installDatasetStream<T>(
    entry: DatasetManifestEntry,
    plan: StreamInstallPlan<T>,
    parts: AsyncIterable<DatasetPart<T>>,
    onProgress?: (fraction: number) => void,
    resourceId?: string,
): Promise<InstalledDataset> {
    await db.transaction('rw', [...plan.tables, db.datasets], async () => {
        await plan.clear();
        await db.datasets.delete(entry.id);
    });

    let recordCount = 0;
    for await (const part of parts) {
        recordCount += await db.transaction('rw', plan.tables, () =>
            plan.insertPart(part.records, (fraction) => onProgress?.((part.index + fraction) / part.count)));
        onProgress?.((part.index + 1) / part.count);
    }

    const row: InstalledDataset = {
        id: entry.id,
        version: entry.version,
        contentHash: entry.contentHash,
        installedAt: Date.now(),
        recordCount,
        ...(resourceId ? { resourceId } : {}),
    };
    await db.transaction('rw', [...plan.tables, db.datasets], async () => {
        await plan.finish?.(recordCount);
        await db.datasets.put(row);
    });
    onProgress?.(1);
    return row;
}

/** One array as a single-part stream, for datasets that arrive whole and for tests. */
export async function* singlePart<T>(records: T[]): AsyncGenerator<DatasetPart<T>> {
    yield { records, index: 0, count: 1 };
}

/** Write `records` in batches, reporting the fraction written after each. */
async function bulkPutBatched<T>(table: { bulkPut(items: T[]): PromiseLike<unknown> }, records: T[], batch: number, report: (fraction: number) => void): Promise<number> {
    for (let i = 0; i < records.length; i += batch) {
        await table.bulkPut(records.slice(i, i + batch));
        report(Math.min(1, (i + batch) / records.length));
    }
    return records.length;
}

const TABLE_BATCH = 10_000;

/** A dataset that owns a whole table: clear it, then write every part. */
export function wholeTablePlan<T extends { id: string }>(table: DatasetTable<T>): StreamInstallPlan<T> {
    return {
        tables: [table],
        clear: () => table.clear(),
        insertPart: (records, report) => bulkPutBatched(table, records, TABLE_BATCH, report),
    };
}

export function installWholeTable<T extends { id: string }>(
    entry: DatasetManifestEntry,
    table: DatasetTable<T>,
    records: T[],
    onProgress?: (fraction: number) => void,
): Promise<InstalledDataset> {
    return installDatasetStream(entry, wholeTablePlan(table), singlePart(records), onProgress);
}

const VERSE_BATCH = 5_000;

/**
 * Replacement plan for one translation: its verses, its cached search
 * indexes (they snapshot the verse set, so a stale cache surviving a
 * replaced text would answer searches from the old contents), its catalog
 * verse count (zeroed with the clear, so a failed replacement cannot
 * advertise verses it no longer has) and, in the last transaction, the
 * catalog record with the final count. Other translations' caches are
 * never touched.
 *
 * Its Strong's postings go in the same first transaction, receipt
 * included: they were derived from the verses being removed, so there is
 * no moment when new verses can be searched through old postings. The
 * matching postings install separately afterwards.
 */
export function translationInstallPlan(translation: Translation): StreamInstallPlan<VerseRecord> {
    return {
        tables: [db.verses, db.translations, db.searchIndexes, db.strongsPostings],
        clear: async () => {
            await db.verses.where('translationId').equals(translation.id).delete();
            await db.searchIndexes.where('translationId').equals(translation.id).delete();
            await clearStrongsIndex(translation.id);
            await db.translations.update(translation.id, { verseCount: 0 });
        },
        insertPart: (records, report) => bulkPutBatched(db.verses, records, VERSE_BATCH, report),
        finish: (verseCount) => db.translations.put({ ...translation, verseCount }),
    };
}

/** Drop a translation's Strong's postings and their receipt. Call inside a transaction over `strongsPostings` and `datasets`. */
export async function clearStrongsIndex(translationId: string): Promise<void> {
    await db.strongsPostings.where('translationId').equals(translationId).delete();
    await db.datasets.delete(strongsIndexDatasetId(translationId));
}

/** Install plan for one translation's Strong's postings (issue #166): its own rows only. */
export function strongsIndexPlan(translationId: string): StreamInstallPlan<StrongsPosting> {
    return {
        tables: [db.strongsPostings],
        clear: () => db.strongsPostings.where('translationId').equals(translationId).delete(),
        insertPart: async (records) => {
            await db.strongsPostings.bulkPut(records.map((r) => ({ translationId, ...r })));
            return records.length;
        },
    };
}

export function installTranslationDataset(
    entry: DatasetManifestEntry,
    translation: Translation,
    verses: VerseRecord[],
    onProgress?: (fraction: number) => void,
): Promise<InstalledDataset> {
    return installDatasetStream(entry, translationInstallPlan(translation), singlePart(verses), onProgress);
}
