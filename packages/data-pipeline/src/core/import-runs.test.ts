import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordImportRun } from './import-runs.js';

const stats = { created: 1, updated: 0, skipped: 0, conflicts: 0 };

let dir: string;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-runs-'));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

function readRuns(): any[] {
    return JSON.parse(fs.readFileSync(path.join(dir, 'import-runs.json'), 'utf-8'));
}

describe('recordImportRun', () => {
    it('appends a record with all consumed sourceIds', () => {
        recordImportRun(dir, { sourceIds: ['theographic', 'bibledata'], inputFiles: [], stats });
        recordImportRun(dir, { sourceIds: ['openbible-xref'], inputFiles: [], stats });

        const runs = readRuns();
        expect(runs).toHaveLength(2);
        expect(runs[0].sourceIds).toEqual(['theographic', 'bibledata']);
        expect(runs[1].sourceIds).toEqual(['openbible-xref']);
        expect(runs[0].id).not.toBe(runs[1].id);
    });

    it('throws on a sourceId missing from the registry, writing nothing', () => {
        expect(() =>
            recordImportRun(dir, { sourceIds: ['genealogy'], inputFiles: [], stats }),
        ).toThrow(/Unknown source dataset/);
        expect(fs.existsSync(path.join(dir, 'import-runs.json'))).toBe(false);
    });

    it('starts fresh over a corrupt audit file instead of throwing', () => {
        fs.writeFileSync(path.join(dir, 'import-runs.json'), '{not json', 'utf-8');
        recordImportRun(dir, { sourceIds: ['bibledata'], inputFiles: [], stats });
        expect(readRuns()).toHaveLength(1);
    });
});
