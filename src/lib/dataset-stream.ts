/**
 * Streamed reads of a dataset (issue #168).
 *
 * A dataset arrives as parts: the split JSON files the manifest lists
 * today, `.csdata` chunks later. `manifestSource` yields one part at a
 * time, prefetching the next while the caller inserts the current one, so
 * the whole dataset is never held in memory twice. The yielded shape is
 * the seam between transport and storage: `installDatasetStream` in the
 * db package consumes any `AsyncIterable<DatasetPart<T>>`.
 */

import type { DatasetManifestEntry, DatasetPart } from '@codex-scriptura/core';
import { fetchJsonAsset } from './data-manifest';

export class DatasetPartError extends Error {
    constructor(readonly datasetId: string, readonly file: string, reason: string) {
        super(`${datasetId}: ${file} ${reason}`);
        this.name = 'DatasetPartError';
    }
}

export type SourceOptions = {
    fetchFn?: typeof fetch;
    /** Keys every record must carry; the first record of each part is checked (a malformed deploy must not seed durable garbage). */
    shape?: readonly string[];
};

/** A record shape is plausible when it is an object carrying every required key. */
export function hasShape(record: unknown, shape: readonly string[]): boolean {
    if (!record || typeof record !== 'object') return false;
    return shape.every((key) => key in (record as Record<string, unknown>));
}

/**
 * Yield the parts of a manifest entry in order. A missing or malformed
 * part throws rather than yielding a shorter dataset, so the install it
 * feeds aborts before writing its receipt: the dataset reads as missing
 * and is reinstalled from scratch on the next boot. (The previous copy is
 * already cleared by then; see installDatasetStream.)
 */
export async function* manifestSource<T>(entry: DatasetManifestEntry, opts: SourceOptions = {}): AsyncGenerator<DatasetPart<T>> {
    const { fetchFn = fetch, shape } = opts;
    const count = entry.files.length;
    const load = async (i: number): Promise<T[]> => {
        const file = entry.files[i];
        const records = await fetchJsonAsset<unknown>(file, fetchFn);
        if (!records) throw new DatasetPartError(entry.id, file, `is missing or not JSON (${i + 1} of ${count})`);
        if (!Array.isArray(records)) throw new DatasetPartError(entry.id, file, 'is not a record array');
        if (shape && records.length > 0 && !hasShape(records[0], shape)) {
            throw new DatasetPartError(entry.id, file, `records lack the expected keys (${shape.join(', ')})`);
        }
        return records as T[];
    };

    // A prefetch may reject before anyone awaits it; the no-op catch keeps
    // Node from reporting that as unhandled while the real await still throws.
    const prefetch = (i: number) => {
        const p = load(i);
        p.catch(() => {});
        return p;
    };
    let next: Promise<T[]> | null = count > 0 ? prefetch(0) : null;
    let total = 0;
    for (let i = 0; i < count; i++) {
        const records = await next!;
        // Start the next download before handing this part to the inserter
        next = i + 1 < count ? prefetch(i + 1) : null;
        total += records.length;
        yield { records, index: i, count };
    }
    if (total !== entry.recordCount) {
        console.warn(`[seed] ${entry.id}: streamed ${total} records, manifest says ${entry.recordCount}`);
    }
}

/** Transform each part's records, keeping the part's position. */
export async function* mapParts<A, B>(parts: AsyncIterable<DatasetPart<A>>, fn: (record: A) => B): AsyncGenerator<DatasetPart<B>> {
    for await (const part of parts) {
        yield { ...part, records: part.records.map(fn) };
    }
}
