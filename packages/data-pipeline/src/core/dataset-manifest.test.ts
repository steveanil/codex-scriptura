import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publishDatasets, readManifest, validateManifest, MANIFEST_FILE } from './dataset-manifest.js';
import { DATASETS, type DatasetDefinition } from './dataset-registry.js';

let tmp: string;
let srcDir: string;
let destDir: string;

const verses = (translation: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
        translation,
        book: i < 3 ? 'Gen' : 'Exod',
        chapter: 1,
        verse: i + 1,
        osisId: `${i < 3 ? 'Gen' : 'Exod'}.1.${i + 1}`,
        text: `verse ${i + 1} of ${translation}`,
    }));

const defs: DatasetDefinition[] = [
    {
        id: 'translation:kjv',
        file: 'kjv-verses.json',
        translation: { id: 'KJV', name: 'King James Version', abbreviation: 'KJV', language: 'en', license: 'Public Domain', description: 'test', strongs: true },
    },
    { id: 'persons', file: 'persons.json' },
];

function writeSrc(file: string, records: unknown[]) {
    fs.writeFileSync(path.join(srcDir, file), JSON.stringify(records), 'utf-8');
}

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dataset-manifest-'));
    srcDir = path.join(tmp, 'processed');
    destDir = path.join(tmp, 'static');
    fs.mkdirSync(srcDir);
    writeSrc('kjv-verses.json', verses('KJV', 5));
    writeSrc('persons.json', [{ id: 'aaron_1', name: 'Aaron' }, { id: 'abel_1', name: 'Abel' }]);
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

const publish = (extra: Partial<Parameters<typeof publishDatasets>[0]> = {}) =>
    publishDatasets({ srcDir, destDir, datasets: defs, log: () => {}, ...extra });

describe('publishDatasets', () => {
    it('writes one entry per dataset with identity, counts, files and translation metadata', () => {
        const { manifest, missing } = publish();
        expect(missing).toEqual([]);
        expect(manifest.format).toBe(1);
        expect(manifest.datasets.map((d) => d.id)).toEqual(['persons', 'translation:kjv']);

        const kjv = manifest.datasets[1];
        expect(kjv.contentHash).toMatch(/^[0-9a-f]{64}$/);
        expect(kjv.version).toBe(kjv.contentHash.slice(0, 12));
        expect(kjv.recordCount).toBe(5);
        expect(kjv.files).toEqual(['kjv-verses.json']);
        expect(kjv.books).toEqual({ Gen: 3, Exod: 2 });
        expect(kjv.translation).toMatchObject({ id: 'KJV', strongs: true });

        expect(manifest.datasets[0].books).toBeUndefined();
        expect(manifest.datasets[0].translation).toBeUndefined();
        expect(readManifest(destDir)).toEqual(manifest);
    });

    it('is deterministic: identical inputs give an identical manifest file', () => {
        publish();
        const first = fs.readFileSync(path.join(destDir, MANIFEST_FILE), 'utf-8');
        publish();
        expect(fs.readFileSync(path.join(destDir, MANIFEST_FILE), 'utf-8')).toBe(first);
    });

    it('hashes the logical dataset, so the hash does not depend on the part layout', () => {
        const whole = publish().manifest.datasets[1];
        const split = publish({ splitThreshold: 0, partBudget: 120 }).manifest.datasets[1];

        expect(split.files.length).toBeGreaterThan(1);
        expect(split.files).toEqual(split.files.map((_, i) => `kjv-verses-part${i + 1}.json`));
        expect(split.contentHash).toBe(whole.contentHash);
        expect(split.version).toBe(whole.version);

        const rejoined = split.files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(destDir, f), 'utf-8')));
        expect(rejoined).toEqual(verses('KJV', 5));
        expect(fs.existsSync(path.join(destDir, 'kjv-verses.json'))).toBe(false);
    });

    it('changes version and hash when the content changes', () => {
        const before = publish().manifest.datasets[1];
        writeSrc('kjv-verses.json', verses('KJV', 6));
        const after = publish().manifest.datasets[1];
        expect(after.contentHash).not.toBe(before.contentHash);
        expect(after.version).not.toBe(before.version);
        expect(after.recordCount).toBe(6);
    });

    it('skips datasets whose processed file is missing and reports them', () => {
        fs.rmSync(path.join(srcDir, 'persons.json'));
        const { manifest, missing } = publish();
        expect(missing).toEqual(['persons']);
        expect(manifest.datasets.map((d) => d.id)).toEqual(['translation:kjv']);
    });

    it('removes stale outputs from an earlier layout so the directory matches the manifest', () => {
        publish({ splitThreshold: 0, partBudget: 120 });
        fs.writeFileSync(path.join(destDir, 'kjv-verses.parts.json'), '{"parts":2}');
        publish();
        const files = fs.readdirSync(destDir).sort();
        expect(files).toEqual(['kjv-verses.json', MANIFEST_FILE, 'persons.json']);
    });

    it('rejects a processed file that is not a record array', () => {
        writeSrc('persons.json', { not: 'an array' } as unknown as unknown[]);
        expect(() => publish()).toThrow(/not a JSON array/);
    });
});

describe('validateManifest', () => {
    it('accepts a freshly published directory', () => {
        const { manifest } = publish();
        expect(validateManifest(manifest, destDir)).toEqual([]);
    });

    it('names missing files, orphans, duplicate ids and doubly claimed files', () => {
        const { manifest } = publish();
        fs.rmSync(path.join(destDir, 'persons.json'));
        fs.writeFileSync(path.join(destDir, 'orphan.json'), '[]');
        const broken = {
            ...manifest,
            datasets: [...manifest.datasets, { ...manifest.datasets[1], id: 'translation:kjv' }],
        };
        const problems = validateManifest(broken, destDir);
        expect(problems).toContain('"persons" refers to missing file "persons.json"');
        expect(problems).toContain('"orphan.json" is not described by any manifest entry');
        expect(problems).toContain('duplicate dataset id "translation:kjv"');
        expect(problems).toContain('"kjv-verses.json" belongs to both "translation:kjv" and "translation:kjv"');
    });
});

describe('DATASETS registry', () => {
    it('has unique ids and files', () => {
        const ids = DATASETS.map((d) => d.id);
        const files = DATASETS.map((d) => d.file);
        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(files).size).toBe(files.length);
    });

    it('names translation datasets after their catalog id', () => {
        for (const def of DATASETS.filter((d) => d.translation)) {
            const lower = def.translation!.id.toLowerCase();
            expect(def.id).toBe(`translation:${lower}`);
            expect(def.file).toBe(`${lower}-verses.json`);
            expect(def.translation!.abbreviation).toBe(def.translation!.id);
        }
    });
});
