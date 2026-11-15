import { describe, it, expect } from 'vitest';
import { unresolved, staleDiscrepancies, completenessProblems } from './accept-catena-aurea.js';
import { findingFingerprint } from './verify-catena-oracle.js';

describe('Catena acceptance gate (issue #85)', () => {
    const text = { id: 'catena-matt-3-5-6#3', kind: 'text', detail: 'Jerome vs Jerome: similarity 0.9; extra [a] missing [b]' };
    const author = { id: 'catena-matt-3-5-6#3', kind: 'author', detail: 'ours Jerome | oracle Aug.' };
    const other = { id: 'catena-john-1-1#2', kind: 'text', detail: 'x' };
    const reviewed = [{ id: text.id, kind: 'text', findingFingerprint: findingFingerprint(text), note: 'oracle carries an editorial note the page lacks', reviewed: '2026-09-28' }];

    it('lets only the reviewed finding through, bound to its kind, id and disagreement', () => {
        expect(unresolved([text, author, other], reviewed)).toEqual([author, other]);
        expect(unresolved([], [])).toEqual([]);
    });

    it('fails a review whose finding has changed under the same id', () => {
        const changed = { ...text, detail: 'Jerome vs Jerome: similarity 0.5; extra [c] missing [d]' };
        expect(unresolved([changed], reviewed)).toEqual([changed]);
        expect(staleDiscrepancies([changed], reviewed)).toEqual(reviewed);
        expect(staleDiscrepancies([text], reviewed)).toEqual([]);
    });

    it('binds a review to the whole compared text and its page, not the shortened detail', () => {
        // The detail lists the first twelve differing words; a thirteenth change leaves it as it was
        const before = { ...text, compared: 'Jerome: w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12 w13\nJerome: v1 v2 v3 v4 v5 v6 v7 v8 v9 v10 v11 v12 v13', item: 'i', leaf: 4 };
        const after = { ...before, compared: before.compared.replace('w13', 'x13') };
        expect(findingFingerprint(after)).not.toBe(findingFingerprint(before));
        expect(findingFingerprint({ ...before, leaf: 5 })).not.toBe(findingFingerprint(before));
        const review = [{ ...reviewed[0], findingFingerprint: findingFingerprint(before) }];
        expect(unresolved([after], review)).toEqual([after]);
    });

    it('proves completeness from the scans: every chapter present, every uncovered verse explained', () => {
        const entry = (book: string, ch: number, from: number, to: number) => ({ id: `${book}.${ch}.${from}`, startRef: `${book}.${ch}.${from}`, endRef: `${book}.${ch}.${to}`, content: '', source: { item: 'x', leafStart: 1, leafEnd: 1 } }) as never;
        const all = (book: string, n: number) => Array.from({ length: n }, (_, i) => entry(book, i + 1, 1, 3));
        const entries = [...all('Matt', 28), ...all('Mark', 16), ...all('Luke', 23), entry('Luke', 24, 1, 2)];
        const counts = () => Object.fromEntries(Array.from({ length: 28 }, (_, i) => [i + 1, 3]));
        expect(completenessProblems([...entries, ...all('John', 21)], [], counts)).toEqual(['Luke 24: verse(s) 3 covered by no entry and explained by no versification note']);
        expect(completenessProblems([...entries, ...all('John', 21)], [{ gospel: 'Luke', chapter: 24, verses: [3], leaf: 77, item: 'x', note: 'edition prints no verse 3' }], counts)).toEqual([]);
        expect(completenessProblems([...entries, ...all('John', 20)], [], counts)).toEqual(['Luke 24: verse(s) 3 covered by no entry and explained by no versification note', 'John: no entries for chapter(s) 21']);
    });
});

describe('sequential tiers', () => {
    it('blocks on structure, then identity, then suspected omissions, and reports other lexical text without blocking', async () => {
        const { tiers } = await import('./accept-catena-aurea.js');
        expect(tiers([{ id: 'a', kind: 'missing-excerpt' }, { id: 'b', kind: 'author' }, { id: 'c', kind: 'text', review: 'lexical' }]).blocking).toBe('structural');
        expect(tiers([{ id: 'b', kind: 'author' }, { id: 'c', kind: 'text', review: 'lexical' }]).blocking).toBe('identity');
        expect(tiers([{ id: 'c', kind: 'text', review: 'lexical' }]).blocking).toBeNull();
        expect(tiers([{ id: 'c', kind: 'text', review: 'lexical' }], [{}])).toMatchObject({ blocking: 'omission', omissions: 1, lexical: 1 });
        expect(tiers([{ id: 'b', kind: 'author' }], [{}]).blocking).toBe('identity');
        expect(tiers([{ id: 'c', kind: 'text', review: 'benign-ocr' }]).blocking).toBeNull();
    });
});

describe('suspected omissions', () => {
    const f = { id: 'catena-mark-2-1-12#4', kind: 'text', detail: 'd', compared: 'Bede: a b\nBede: a w x y z b', omissions: ['w x y z'] };
    const record = { id: f.id, kind: 'text', findingFingerprint: findingFingerprint(f), note: 'the page does not print it', reviewed: '2026-11-15' };

    it('are cleared only by a review of that finding naming every omitted run', async () => {
        const { openOmissions } = await import('./accept-catena-aurea.js');
        expect(openOmissions([f, { ...f, id: 'other', omissions: undefined }], [])).toEqual([f]);
        // A review of the finding that does not speak to the omission clears nothing
        expect(openOmissions([f], [record])).toEqual([f]);
        expect(openOmissions([f], [{ ...record, omissions: ['w x y'] }])).toEqual([f]);
        expect(openOmissions([f], [{ ...record, omissions: ['w x y z'] }])).toEqual([]);
        const two = { ...f, omissions: ['w x y z', 'p q r s'] };
        expect(openOmissions([two], [{ ...record, omissions: ['w x y z'] }])).toEqual([two]);
    });

    it('open again when the finding changes under the review', async () => {
        const { openOmissions } = await import('./accept-catena-aurea.js');
        const changed = { ...f, compared: 'Bede: a c\nBede: a w x y z b' };
        expect(openOmissions([changed], [{ ...record, omissions: ['w x y z'] }])).toEqual([changed]);
    });

    it('count differences by shape over every finding', async () => {
        const { shapeCounts } = await import('./accept-catena-aurea.js');
        expect(shapeCounts([{ shapes: { word: 2, spacing: 1 } }, { shapes: { word: 1 } }, {}])).toEqual({ word: 3, spacing: 1 });
    });

    it('defers, by name, only an omission on a held-out benchmark page that an open question marks', async () => {
        const { deferredOmissions } = await import('./accept-catena-aurea.js');
        const open = [{ id: 'catena-matt-15-32-38#2', item: 'scan' }, { id: 'catena-matt-15-32-38#5', item: 'scan' }];
        const index = { 'catena-matt-15-32-38': { excerptLeaves: [176, 176, 177, 177, 178, 178] } };
        const question = { status: 'open', finding: 'catena-matt-15-32-38#2' };
        // Excerpt 2 runs from leaf 176 on to 177, which is held out; excerpt 5 does not touch it
        expect(deferredOmissions(open, index, new Set(['scan#177']), [question])).toEqual([open[0]]);
        expect(deferredOmissions(open, index, new Set(['scan#177']), [])).toEqual([]);
        expect(deferredOmissions(open, index, new Set(['scan#177']), [{ ...question, status: 'answered' }])).toEqual([]);
        expect(deferredOmissions(open, index, new Set(['other#177']), [question])).toEqual([]);
        expect(deferredOmissions(open, index, new Set(['scan#178']), [{ status: 'open', finding: 'catena-matt-15-32-38#5' }])).toEqual([open[1]]);
    });
});
