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

describe('validateTranslation - clean data', () => {
    // Single-chapter books (2John: 13 verses, Obad: 21) keep these fixtures
    // free of missing-chapter warnings, and running to the chapter's full
    // reference count keeps them free of trailing-verse warnings.
    it('passes contiguous verses with no findings', () => {
        const verses = Array.from({ length: 13 }, (_, i) => v('2John', 1, i + 1));
        const r = validateTranslation('T', verses);
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual([]);
        expect(r.expectedOmissions).toEqual([]);
        expect(r.verseCount).toBe(13);
        expect(r.bookCount).toBe(1);
    });

    it('treats a bridge as covering its full range', () => {
        const r = validateTranslation('T', [
            v('Obad', 1, 1),
            v('Obad', 1, 2, { verseEnd: 20 }),
            v('Obad', 1, 21),
        ]);
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual([]);
    });
});

describe('validateTranslation - hard errors', () => {
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

    it('flags an empty dataset instead of passing it', () => {
        const r = validateTranslation('T', []);
        expect(r.errors.some((e) => e.includes('no verse records'))).toBe(true);
    });

    it('flags chapter 0, negative, and non-integer chapter numbers', () => {
        for (const chapter of [0, -3, 1.5]) {
            const r = validateTranslation('T', [v('Gen', chapter, 1)]);
            expect(r.errors.some((e) => e.includes('invalid chapter number'))).toBe(true);
            expect(r.warnings).toEqual([]);
        }
    });
});

describe('validateTranslation - warnings vs expected omissions', () => {
    it('warns on an unexpected verse gap', () => {
        // 2 John 1–13 with verse 2 missing: exactly one interior gap
        const verses = Array.from({ length: 13 }, (_, i) => v('2John', 1, i + 1))
            .filter((x) => x.verse !== 2);
        const r = validateTranslation('T', verses);
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual(['T: verse gap at 2John.1.2']);
    });

    it('classifies known critical-text omissions as expected, not warnings', () => {
        // Acts 8:37 is a classic critical-text omission. The fixture's other
        // gaps (verses 1–35) correctly warn - the point is that 8:37 doesn't.
        const r = validateTranslation('OEB', [v('Acts', 8, 36), v('Acts', 8, 38)]);
        expect(r.warnings.some((w) => w.includes('Acts.8.37'))).toBe(false);
        expect(r.expectedOmissions).toEqual(['Acts.8.37']);
    });

    it('keys expected omissions per translation - the same gap warns in the KJV', () => {
        // The KJV contains Acts 8:37, so a gap there is an importer bug.
        const r = validateTranslation('KJV', [v('Acts', 8, 36), v('Acts', 8, 38)]);
        expect(r.warnings).toContain('KJV: verse gap at Acts.8.37');
        expect(r.expectedOmissions).toEqual([]);
    });

    it('does not excuse NT omissions the WEB retains', () => {
        // WEB omits only 4 NT disputed verses; Matt 17:21 is kept in place,
        // so a gap there must warn even though the OEB legitimately omits it.
        const r = validateTranslation('WEB', [v('Matt', 17, 20), v('Matt', 17, 22)]);
        expect(r.warnings).toContain('WEB: verse gap at Matt.17.21');
        const r2 = validateTranslation('WEB', [v('Acts', 8, 36), v('Acts', 8, 38)]);
        expect(r2.expectedOmissions).toEqual(['Acts.8.37']);
    });

    it('treats every gap as a warning for translations with no known-gaps entry', () => {
        const r = validateTranslation('NEW', [v('Acts', 8, 36), v('Acts', 8, 38)]);
        expect(r.warnings).toContain('NEW: verse gap at Acts.8.37');
        expect(r.expectedOmissions).toEqual([]);
    });

    it('warns on missing chapters for normal books (partial translations)', () => {
        const r = validateTranslation('T', [v('Ps', 1, 1), v('Ps', 3, 1)]);
        expect(r.errors).toEqual([]);
        expect(r.warnings.some((w) => w.includes('Ps missing'))).toBe(true);
    });
});

describe('validateTranslation - trailing-verse check (known-issues #24)', () => {
    // 2 John has 13 verses in the KJV reference table.
    const twoJohn = (last: number) =>
        Array.from({ length: last }, (_, i) => v('2John', 1, i + 1));

    it('warns when a chapter ends short of the reference count', () => {
        const r = validateTranslation('T', twoJohn(12));
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual([
            'T: trailing verse gap at 2John.1.13 (chapter ends at 12, reference versification has 13)',
        ]);
    });

    it('passes a chapter that reaches the reference count', () => {
        const r = validateTranslation('T', twoJohn(13));
        expect(r.warnings).toEqual([]);
    });

    it('classifies known trailing omissions as expected (WEB Romans doxology)', () => {
        const rom16 = Array.from({ length: 24 }, (_, i) => v('Rom', 16, i + 1));
        const r = validateTranslation('WEB', rom16);
        expect(r.expectedOmissions).toEqual(['Rom.16.25', 'Rom.16.26', 'Rom.16.27']);
        expect(r.warnings.some((w) => w.includes('trailing'))).toBe(false);
    });

    it('warns when a chapter runs past the reference count', () => {
        const rev12 = Array.from({ length: 18 }, (_, i) => v('Rev', 12, i + 1));
        const r = validateTranslation('KJV', rev12);
        expect(r.warnings.some((w) => w.includes('Rev.12 runs to verse 18'))).toBe(true);
    });

    it('accepts per-translation verse-count variants (OEB Rev 12:18)', () => {
        const rev12 = Array.from({ length: 18 }, (_, i) => v('Rev', 12, i + 1));
        const r = validateTranslation('OEB', rev12);
        expect(r.warnings.some((w) => w.includes('Rev.12'))).toBe(false);
    });

    it('skips books absent from the reference table', () => {
        // 3Macc is WEB-only - no KJV reference counts exist for it
        const r = validateTranslation('WEB', [v('3Macc', 1, 1)]);
        expect(r.warnings.some((w) => w.includes('trailing'))).toBe(false);
    });
});

describe('validateTranslation - versification variants', () => {
    it('accepts EpJer numbered as Baruch 6', () => {
        // Full chapter (73 verses in the reference table) so the trailing
        // check stays quiet - the point here is the chapter numbering
        const verses = Array.from({ length: 73 }, (_, i) => v('EpJer', 6, i + 1));
        const r = validateTranslation('T', verses);
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual([]);
    });

    it('accepts AddPs numbered as Psalm 151', () => {
        const r = validateTranslation('T', [v('AddPs', 151, 1)]);
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual([]);
    });

    it('suppresses missing-chapter warnings for sparse-numbered books', () => {
        // KJV Greek Esther spans chapters 10–16 only, starting at 10:4;
        // chapter 10 runs to its full reference count (13)
        const verses = Array.from({ length: 10 }, (_, i) => v('EsthGr', 10, i + 4));
        const r = validateTranslation('KJV', verses);
        expect(r.warnings).toEqual([]);
        expect(r.expectedOmissions).toEqual(['EsthGr.10.1', 'EsthGr.10.2', 'EsthGr.10.3']);
    });
});
