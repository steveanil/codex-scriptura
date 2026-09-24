import { describe, it, expect } from 'vitest';
import { emptyChapterReason, translationsCovering } from './chapterAvailability';

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

describe('translationsCovering', () => {
    const installed = [
        { id: 'OEB', books: OEB_BOOKS },
        { id: 'KJV', books: KJV_BOOKS },
        { id: 'WEB', books: KJV_BOOKS },
    ];

    it('offers every other installed translation that has the book, in catalog order', () => {
        expect(translationsCovering('Deut', installed, 'OEB').map((t) => t.id)).toEqual(['KJV', 'WEB']);
    });

    it('offers nothing when no other installed translation has the book', () => {
        expect(translationsCovering('Deut', [installed[0]], 'OEB')).toEqual([]);
        expect(translationsCovering('Tob', installed, 'OEB')).toEqual([]);
    });
});
