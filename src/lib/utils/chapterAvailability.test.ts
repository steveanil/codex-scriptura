import { describe, it, expect } from 'vitest';
import { emptyChapterReason, chapterFallbackOrder } from './chapterAvailability';

// OEB's real coverage: NT plus a partial OT, no Pentateuch.
const OEB_BOOKS = ['Ruth', 'Esth', 'Ps', 'Hos', 'Matt', 'Mark', 'Luke', 'John', 'Rev'];
const KJV_BOOKS = ['Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Ruth', 'Ps', 'Matt', 'Rev'];

describe('emptyChapterReason (issue #400)', () => {
    it('a topic reference into a book the partial canon lacks is a coverage gap, not damage', () => {
        expect(emptyChapterReason(OEB_BOOKS, 'Deut')).toBe('book-not-covered');
    });

    it('no books at all means the translation text is missing from the device', () => {
        expect(emptyChapterReason([], 'Deut')).toBe('translation-missing');
    });

    it('a covered book with an empty chapter is damaged data', () => {
        expect(emptyChapterReason(KJV_BOOKS, 'Deut')).toBe('chapter-missing');
    });
});

describe('chapterFallbackOrder', () => {
    it('tries later chapters ascending, then earlier chapters descending', () => {
        expect(chapterFallbackOrder([1, 2, 3, 4, 5], 3)).toEqual([4, 5, 2, 1]);
    });

    it('from the first chapter tries only later ones', () => {
        expect(chapterFallbackOrder([1, 2, 3], 1)).toEqual([2, 3]);
    });

    it('from the last chapter tries only earlier ones, nearest first', () => {
        expect(chapterFallbackOrder([1, 2, 3], 3)).toEqual([2, 1]);
    });

    it('a chapter missing from the list tries every chapter ascending and none descending', () => {
        expect(chapterFallbackOrder([1, 3, 5], 4)).toEqual([1, 3, 5]);
    });

    it('an empty list has nothing to try', () => {
        expect(chapterFallbackOrder([], 1)).toEqual([]);
    });
});
