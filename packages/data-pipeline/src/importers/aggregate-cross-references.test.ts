import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bookMatrix, verseDegrees, aggregateCrossReferences } from './aggregate-cross-references.js';

const pairs = [
    { sourceVerse: 'John.1.3', targetVerse: 'Gen.1.1' },
    { sourceVerse: 'Jer.10.12', targetVerse: 'Gen.1.1' },
    { sourceVerse: 'Gen.1.2', targetVerse: 'Gen.1.1' },
    { sourceVerse: 'Gen.2.4', targetVerse: 'Gen.1.1' },
    { sourceVerse: 'Matt.1.23', targetVerse: 'Isa.7.14' },
    { sourceVerse: 'John.3.16', targetVerse: 'Gen.22.2' },
];

describe('bookMatrix', () => {
    it('counts each pair once under its stored orientation, in canon order', () => {
        expect(bookMatrix(pairs)).toEqual([
            { from: 'Gen', to: 'Gen', count: 2 },
            { from: 'Jer', to: 'Gen', count: 1 },
            { from: 'Matt', to: 'Isa', count: 1 },
            { from: 'John', to: 'Gen', count: 2 },
        ]);
    });

    it('is deterministic regardless of input order', () => {
        expect(bookMatrix([...pairs].reverse())).toEqual(bookMatrix(pairs));
    });
});

describe('verseDegrees', () => {
    it('counts pairs at either end and sorts canonically', () => {
        const d = verseDegrees(pairs);
        expect(d[0]).toEqual({ osisId: 'Gen.1.1', degree: 4 });
        expect(d.map((x) => x.osisId)).toEqual(['Gen.1.1', 'Gen.1.2', 'Gen.2.4', 'Gen.22.2', 'Isa.7.14', 'Jer.10.12', 'Matt.1.23', 'John.1.3', 'John.3.16']);
        expect(d.find((x) => x.osisId === 'John.3.16')?.degree).toBe(1);
    });
});

describe('aggregateCrossReferences', () => {
    let tmp: string;
    beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aggregate-')); });
    afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

    it('writes both aggregates beside the source', () => {
        const input = path.join(tmp, 'cross-references.json');
        fs.writeFileSync(input, JSON.stringify(pairs.map((p, i) => ({ id: `x${i}`, ...p, type: 'theme', votes: 1 }))));
        const out = path.join(tmp, 'processed');
        expect(aggregateCrossReferences(input, out)).toEqual({ matrixCells: 4, versesWithDegree: 9 });
        expect(JSON.parse(fs.readFileSync(path.join(out, 'book-matrix.json'), 'utf-8'))).toEqual(bookMatrix(pairs));
        expect(JSON.parse(fs.readFileSync(path.join(out, 'verse-degrees.json'), 'utf-8'))).toHaveLength(9);
    });
});
