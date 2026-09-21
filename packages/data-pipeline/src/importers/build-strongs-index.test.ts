import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strongsPostings, buildStrongsIndex } from './build-strongs-index.js';
import { DATASETS } from '../core/dataset-registry.js';

const verses = [
    { osisId: 'Gen.1.1', lemmas: 'H7225 H1254 H430' },
    // A repeated id is one posting entry, not two
    { osisId: 'Gen.2.4', lemmas: 'H1254 H8064 H1254' },
    { osisId: 'Gen.2.5' },
    { osisId: 'John.1.1', lemmas: 'G746 G3056  G2316' },
    { osisId: 'John.1.2', lemmas: 'G746 G2316' },
];

describe('strongsPostings', () => {
    it('lists each id once per verse, verses in the order given', () => {
        const byId = Object.fromEntries(strongsPostings(verses).map((p) => [p.strongsId, p.osisIds]));
        expect(byId.H1254).toEqual(['Gen.1.1', 'Gen.2.4']);
        expect(byId.G746).toEqual(['John.1.1', 'John.1.2']);
        expect(byId.H8064).toEqual(['Gen.2.4']);
    });

    it('orders ids by letter then number, whatever the input order', () => {
        const ids = strongsPostings([...verses].reverse()).map((p) => p.strongsId);
        expect(ids).toEqual(['G746', 'G2316', 'G3056', 'H430', 'H1254', 'H7225', 'H8064']);
    });

    it('holds exactly the verse-level lemma tokens, so it answers what a scan of `lemmas` would', () => {
        const postings = strongsPostings(verses);
        for (const v of verses) {
            const tokens = new Set((v.lemmas ?? '').split(' ').filter(Boolean));
            for (const p of postings) expect(p.osisIds.includes(v.osisId)).toBe(tokens.has(p.strongsId));
        }
    });
});

describe('buildStrongsIndex', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strongs-index-'));
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('writes the postings and reports the largest one', () => {
        fs.writeFileSync(path.join(dir, 'verses.json'), JSON.stringify(verses));
        const out = path.join(dir, 'strongs-index.json');
        const report = buildStrongsIndex(path.join(dir, 'verses.json'), out);
        expect(JSON.parse(fs.readFileSync(out, 'utf-8'))).toEqual(strongsPostings(verses));
        expect(report.postings).toBe(7);
        expect(report.largest?.osisIds).toHaveLength(2);
    });
});

describe('registry', () => {
    it('ships one postings dataset per tagged translation, derived from it, and none for the rest', () => {
        const tagged = DATASETS.filter((d) => d.translation?.strongs);
        const indexes = DATASETS.filter((d) => d.id.startsWith('strongs-index:'));
        expect(indexes.map((d) => d.derivedFrom).sort()).toEqual(tagged.map((d) => d.id).sort());
        expect(indexes.map((d) => d.id)).not.toContain('strongs-index:ylt');
    });
});
