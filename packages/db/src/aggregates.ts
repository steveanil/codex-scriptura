import type { AggregateRecord, BookConnectionMatrix, BookMatrixEntry, VerseDegree } from '@codex-scriptura/core';
import { db } from './database.js';
import type { StreamInstallPlan } from './datasets.js';

/**
 * Precomputed aggregates (issue #38): facts the pipeline derives from
 * immutable seeded data and ships as small datasets, stored whole, one row
 * per manifest id. The browser reads them; it never re-derives them from
 * the tables they summarize.
 */

/** Install plan for an aggregate: replace its one row, records accumulated across parts. */
export function aggregatePlan<T>(id: string): StreamInstallPlan<T> {
    let records: T[] = [];
    return {
        tables: [db.aggregates],
        clear: async () => {
            records = [];
            await db.aggregates.delete(id);
        },
        insertPart: async (part) => {
            records = records.concat(part);
            return part.length;
        },
        finish: () => db.aggregates.put({ id, records }),
    };
}

async function aggregateRecords<T>(id: string): Promise<T[]> {
    const row = (await db.aggregates.get(id)) as AggregateRecord | undefined;
    return (row?.records ?? []) as T[];
}

/**
 * The book-to-book cross-reference density matrix, from the shipped
 * `book-matrix` aggregate. Each pair is counted once under its source book
 * (later in canon order) against its target book, so
 * `matrix.get('John')?.get('Gen')` holds every Genesis/John link and
 * `matrix.get('Gen')?.get('John')` is empty; consumers fold the two
 * triangles together. Empty until the aggregate is installed.
 */
export async function getBookConnectionMatrix(): Promise<BookConnectionMatrix> {
    const matrix: BookConnectionMatrix = new Map();
    for (const { from, to, count } of await aggregateRecords<BookMatrixEntry>('book-matrix')) {
        let row = matrix.get(from);
        if (!row) { row = new Map(); matrix.set(from, row); }
        row.set(to, count);
    }
    return matrix;
}

/** Cross-reference pair counts per verse, from the shipped `verse-degrees` aggregate. Empty until installed. */
export async function getVerseDegrees(): Promise<Map<string, number>> {
    return new Map((await aggregateRecords<VerseDegree>('verse-degrees')).map((d) => [d.osisId, d.degree]));
}
