import { describe, it, expect } from 'vitest';
import { emptyChapterReason } from './chapterAvailability';

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
