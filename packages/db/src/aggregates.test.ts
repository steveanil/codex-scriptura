import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import type { DatasetManifestEntry } from '@codex-scriptura/core';
import { db } from './database';
import { installDatasetStream, getDatasetState } from './datasets';
import { aggregatePlan, getBookConnectionMatrix, getVerseDegrees } from './aggregates';

const entry = (id: string, seed: string): DatasetManifestEntry =>
    ({ id, version: seed.padEnd(12, '0'), contentHash: seed.padEnd(64, '0'), recordCount: 0, files: [`${id}.json`], derivedFrom: { id: 'cross-references', contentHash: 'c'.repeat(64) } });

describe('aggregates (issue #38)', () => {
    it('reads an empty matrix and no degrees before the aggregates land', async () => {
        expect((await getBookConnectionMatrix()).size).toBe(0);
        expect((await getVerseDegrees()).size).toBe(0);
    });

    it('installs the book matrix whole across parts and serves it in the stored orientation', async () => {
        async function* parts() {
            yield { records: [{ from: 'John', to: 'Gen', count: 2 }, { from: 'Gen', to: 'Gen', count: 5 }], index: 0, count: 2 };
            yield { records: [{ from: 'Matt', to: 'Isa', count: 7 }], index: 1, count: 2 };
        }
        const e = entry('book-matrix', 'a1');
        const row = await installDatasetStream(e, aggregatePlan('book-matrix'), parts());
        expect(row.recordCount).toBe(3);
        expect(await getDatasetState(e)).toBe('current');
        const matrix = await getBookConnectionMatrix();
        expect(matrix.get('John')?.get('Gen')).toBe(2);
        expect(matrix.get('Gen')?.get('John')).toBeUndefined();
        expect(matrix.get('Matt')?.get('Isa')).toBe(7);
    });

    it('replaces the whole aggregate on reinstall rather than merging', async () => {
        async function* parts() { yield { records: [{ from: 'Rev', to: 'Gen', count: 1 }], index: 0, count: 1 }; }
        await installDatasetStream(entry('book-matrix', 'a2'), aggregatePlan('book-matrix'), parts());
        expect([...(await getBookConnectionMatrix()).keys()]).toEqual(['Rev']);
    });

    it('serves verse degrees as a map', async () => {
        async function* parts() { yield { records: [{ osisId: 'Gen.1.1', degree: 4 }, { osisId: 'John.3.16', degree: 9 }], index: 0, count: 1 }; }
        await installDatasetStream(entry('verse-degrees', 'd1'), aggregatePlan('verse-degrees'), parts());
        expect(await getVerseDegrees()).toEqual(new Map([['Gen.1.1', 4], ['John.3.16', 9]]));
    });
});
