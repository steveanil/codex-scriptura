import { describe, it, expect } from 'vitest';
import { validateTranslation, type ValidationVerse } from './validate-texts.js';

function v(
    book: string,
    chapter: number,
    verse: number,
    extra: Partial<ValidationVerse> = {},
): ValidationVerse {
    return {
        book,
        chapter,
        verse,
        osisId: `${book}.${chapter}.${verse}`,
        text: 'text',
        ...extra,
    };
}

describe('validateTranslation — clean data', () => {
    // Single-chapter books (Jude, Obad) keep these fixtures free of the
    // by-design missing-chapter warnings a partial multi-chapter book emits.
    it('passes contiguous verses with no findings', () => {
        const r = validateTranslation('T', [v('Jude', 1, 1), v('Jude', 1, 2), v('Jude', 1, 3)]);
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual([]);
        expect(r.expectedOmissions).toEqual([]);
        expect(r.verseCount).toBe(3);
        expect(r.bookCount).toBe(1);
    });

    it('treats a bridge as covering its full range', () => {
        const r = validateTranslation('T', [
            v('Obad', 1, 1),
            v('Obad', 1, 2, { verseEnd: 4 }),
            v('Obad', 1, 5),
        ]);
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual([]);
    });
});

describe('validateTranslation — hard errors', () => {
    it('flags duplicate osisIds', () => {
        const r = validateTranslation('T', [v('Gen', 1, 1), v('Gen', 1, 1)]);
        expect(r.errors.some((e) => e.includes('duplicate'))).toBe(true);
    });

    it('flags unknown book IDs', () => {
        const r = validateTranslation('T', [v('Nope', 1, 1)]);
        expect(r.errors.some((e) => e.includes("unknown book 'Nope'"))).toBe(true);
    });

    it('flags empty text', () => {
        const r = validateTranslation('T', [v('Gen', 1, 1, { text: '  ' })]);
        expect(r.errors.some((e) => e.includes('empty text'))).toBe(true);
    });

    it('flags inverted bridges', () => {
        const r = validateTranslation('T', [v('Gen', 1, 5, { verseEnd: 5 })]);
        expect(r.errors.some((e) => e.includes('inverted bridge'))).toBe(true);
    });

    it('flags a bridge overlapping an explicit verse', () => {
        const r = validateTranslation('T', [
            v('Gen', 1, 1, { verseEnd: 3 }),
            v('Gen', 1, 2),
        ]);
        expect(r.errors.some((e) => e.includes('overlaps'))).toBe(true);
    });

    it('flags chapter numbers beyond the canon', () => {
        const r = validateTranslation('T', [v('Jude', 2, 1)]);
        expect(r.errors.some((e) => e.includes('has chapter 2'))).toBe(true);
    });
});

describe('validateTranslation — warnings vs expected omissions', () => {
    it('warns on an unexpected verse gap', () => {
        const r = validateTranslation('T', [v('Jude', 1, 1), v('Jude', 1, 3)]);
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual(['T: verse gap at Jude.1.2']);
    });

    it('classifies known critical-text omissions as expected, not warnings', () => {
        // Acts 8:37 is a classic critical-text omission. The fixture's other
        // gaps (verses 1–35) correctly warn — the point is that 8:37 doesn't.
        const r = validateTranslation('T', [v('Acts', 8, 36), v('Acts', 8, 38)]);
        expect(r.warnings.some((w) => w.includes('Acts.8.37'))).toBe(false);
        expect(r.expectedOmissions).toEqual(['Acts.8.37']);
    });

    it('warns on missing chapters for normal books (partial translations)', () => {
        const r = validateTranslation('T', [v('Ps', 1, 1), v('Ps', 3, 1)]);
        expect(r.errors).toEqual([]);
        expect(r.warnings.some((w) => w.includes('Ps missing'))).toBe(true);
    });
});

describe('validateTranslation — versification variants', () => {
    it('accepts EpJer numbered as Baruch 6', () => {
        const r = validateTranslation('T', [v('EpJer', 6, 1), v('EpJer', 6, 2)]);
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual([]);
    });

    it('accepts AddPs numbered as Psalm 151', () => {
        const r = validateTranslation('T', [v('AddPs', 151, 1)]);
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual([]);
    });

    it('suppresses missing-chapter warnings for sparse-numbered books', () => {
        // KJV Greek Esther spans chapters 10–16 only
        const r = validateTranslation('T', [v('EsthGr', 10, 4), v('EsthGr', 11, 1)]);
        expect(r.warnings).toEqual([]);
    });
});
