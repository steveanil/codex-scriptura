import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { db, getBookList, getChapterList } from './index';

beforeAll(async () => {
    await db.verses.bulkPut([
        { id: 'KJV.Gen.1.1', translationId: 'KJV', book: 'Gen', chapter: 1, verse: 1, osisId: 'Gen.1.1', text: 'a' },
        { id: 'KJV.Gen.1.2', translationId: 'KJV', book: 'Gen', chapter: 1, verse: 2, osisId: 'Gen.1.2', text: 'b' },
        { id: 'KJV.Gen.2.1', translationId: 'KJV', book: 'Gen', chapter: 2, verse: 1, osisId: 'Gen.2.1', text: 'c' },
        { id: 'KJV.Matt.1.1', translationId: 'KJV', book: 'Matt', chapter: 1, verse: 1, osisId: 'Matt.1.1', text: 'd' },
        // Different translation — must never bleed into KJV results
        { id: 'WEB.Exod.1.1', translationId: 'WEB', book: 'Exod', chapter: 1, verse: 1, osisId: 'Exod.1.1', text: 'e' },
    ]);
});

describe('getBookList (index-only scan)', () => {
    it('returns canonical-ordered books for the given translation only', async () => {
        expect(await getBookList('KJV')).toEqual(['Gen', 'Matt']);
        expect(await getBookList('WEB')).toEqual(['Exod']);
    });

    it('returns empty for an unseeded translation', async () => {
        expect(await getBookList('OEB')).toEqual([]);
    });
});

describe('getChapterList (index-only scan)', () => {
    it('returns sorted chapters for a book, scoped to the translation', async () => {
        expect(await getChapterList('KJV', 'Gen')).toEqual([1, 2]);
        expect(await getChapterList('KJV', 'Matt')).toEqual([1]);
        expect(await getChapterList('WEB', 'Gen')).toEqual([]);
    });
});
