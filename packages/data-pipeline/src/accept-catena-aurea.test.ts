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
    it('blocks on structure, then identity, then lexical text, and never on benign text', async () => {
        const { tiers } = await import('./accept-catena-aurea.js');
        expect(tiers([{ id: 'a', kind: 'missing-excerpt' }, { id: 'b', kind: 'author' }, { id: 'c', kind: 'text', review: 'lexical' }]).blocking).toBe('structural');
        expect(tiers([{ id: 'b', kind: 'author' }, { id: 'c', kind: 'text', review: 'lexical' }]).blocking).toBe('identity');
        expect(tiers([{ id: 'c', kind: 'text', review: 'lexical' }]).blocking).toBe('text');
        expect(tiers([{ id: 'c', kind: 'text', review: 'benign-ocr' }]).blocking).toBeNull();
    });
});
