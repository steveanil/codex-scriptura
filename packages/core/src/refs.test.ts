import { describe, expect, it } from 'vitest';
import { resolveBook, parseReference, formatReference, toOsisId, parseOsisId, compareCanonical } from './refs.js';

describe('resolveBook', () => {
    it('resolves OSIS IDs directly', () => {
        expect(resolveBook('Gen')).toBe('Gen');
        expect(resolveBook('Rev')).toBe('Rev');
    });

    it('resolves full names case-insensitively', () => {
        expect(resolveBook('Genesis')).toBe('Gen');
        expect(resolveBook('genesis')).toBe('Gen');
        expect(resolveBook('REVELATION')).toBe('Rev');
    });

    it('resolves common abbreviations', () => {
        expect(resolveBook('ge')).toBe('Gen');
        expect(resolveBook('Ps')).toBe('Ps');
        expect(resolveBook('psalm')).toBe('Ps');
        expect(resolveBook('mt')).toBe('Matt');
    });

    it('resolves numbered books with and without spaces', () => {
        expect(resolveBook('1 Corinthians')).toBe('1Cor');
        expect(resolveBook('1cor')).toBe('1Cor');
        expect(resolveBook('2 Sam')).toBe('2Sam');
        expect(resolveBook('1 jn')).toBe('1John');
    });

    it('returns undefined for unknown input', () => {
        expect(resolveBook('Hezekiah')).toBeUndefined();
        expect(resolveBook('')).toBeUndefined();
    });
});

describe('parseReference', () => {
    it('parses "Book chapter:verse"', () => {
        expect(parseReference('John 3:16')).toEqual({
            book: 'John', chapter: 3, verse: 16, verseEnd: undefined,
        });
    });

    it('parses verse ranges', () => {
        expect(parseReference('Gen 1:1-3')).toEqual({
            book: 'Gen', chapter: 1, verse: 1, verseEnd: 3,
        });
        expect(parseReference('1 Cor 13:4-7')).toEqual({
            book: '1Cor', chapter: 13, verse: 4, verseEnd: 7,
        });
    });

    it('parses chapter-only references', () => {
        expect(parseReference('Gen 1')).toEqual({
            book: 'Gen', chapter: 1, verse: undefined, verseEnd: undefined,
        });
        expect(parseReference('Ps 119')).toEqual({
            book: 'Ps', chapter: 119, verse: undefined, verseEnd: undefined,
        });
    });

    it('parses full book names', () => {
        expect(parseReference('Genesis 1:1')).toEqual({
            book: 'Gen', chapter: 1, verse: 1, verseEnd: undefined,
        });
    });

    it('parses OSIS format', () => {
        expect(parseReference('Gen.1.1')).toEqual({ book: 'Gen', chapter: 1, verse: 1 });
        expect(parseReference('Gen.1')).toEqual({ book: 'Gen', chapter: 1, verse: undefined });
    });

    it('tolerates surrounding whitespace', () => {
        expect(parseReference('  John 3:16  ')).toEqual({
            book: 'John', chapter: 3, verse: 16, verseEnd: undefined,
        });
    });

    it('returns undefined for garbage input', () => {
        expect(parseReference('')).toBeUndefined();
        expect(parseReference('not a reference')).toBeUndefined();
        expect(parseReference('Hezekiah 3:16')).toBeUndefined();
        expect(parseReference('3:16')).toBeUndefined();
    });
});

describe('formatReference', () => {
    it('formats book + chapter + verse', () => {
        expect(formatReference({ book: 'Gen', chapter: 1, verse: 1 })).toBe('Genesis 1:1');
    });

    it('formats chapter-only references', () => {
        expect(formatReference({ book: 'Gen', chapter: 1 })).toBe('Genesis 1');
    });

    it('formats verse ranges, collapsing degenerate ranges', () => {
        expect(formatReference({ book: 'Gen', chapter: 1, verse: 1, verseEnd: 3 })).toBe('Genesis 1:1-3');
        expect(formatReference({ book: 'Gen', chapter: 1, verse: 1, verseEnd: 1 })).toBe('Genesis 1:1');
    });

    it('falls back to the raw book ID when unknown', () => {
        expect(formatReference({ book: 'Zzz', chapter: 2, verse: 5 })).toBe('Zzz 2:5');
    });
});

describe('toOsisId', () => {
    it('builds verse and chapter IDs', () => {
        expect(toOsisId({ book: 'Gen', chapter: 1, verse: 1 })).toBe('Gen.1.1');
        expect(toOsisId({ book: 'Gen', chapter: 1 })).toBe('Gen.1');
    });

    it('round-trips through parseReference', () => {
        const ref = parseReference('1 Cor 13:4')!;
        expect(parseReference(toOsisId(ref))).toEqual({ book: '1Cor', chapter: 13, verse: 4 });
    });
});

describe('parseOsisId', () => {
    it('parses a strict three-part verse id', () => {
        expect(parseOsisId('Gen.1.1')).toEqual({ book: 'Gen', chapter: 1, verse: 1 });
        expect(parseOsisId('1Cor.13.4')).toEqual({ book: '1Cor', chapter: 13, verse: 4 });
    });

    it('rejects chapter-level ids, sub-verse suffixes, and malformed input', () => {
        expect(parseOsisId('Gen.1')).toBeUndefined();
        expect(parseOsisId('Gen.1.1a')).toBeUndefined();
        expect(parseOsisId('Gen.x.1')).toBeUndefined();
        expect(parseOsisId('Gen..1')).toBeUndefined();
        expect(parseOsisId('Gen.1.1.2')).toBeUndefined();
        expect(parseOsisId('')).toBeUndefined();
    });
});

describe('compareCanonical', () => {
    const v = (book: string, chapter: number, verse: number) => ({ book, chapter, verse });

    it('orders by book position, then chapter, then verse', () => {
        expect(compareCanonical(v('Gen', 1, 1), v('Exod', 1, 1))).toBeLessThan(0);
        expect(compareCanonical(v('Matt', 1, 1), v('Mal', 4, 6))).toBeGreaterThan(0);
        expect(compareCanonical(v('Gen', 2, 1), v('Gen', 1, 31))).toBeGreaterThan(0);
        expect(compareCanonical(v('Gen', 1, 2), v('Gen', 1, 1))).toBeGreaterThan(0);
        expect(compareCanonical(v('Gen', 1, 1), v('Gen', 1, 1))).toBe(0);
    });

    it('sorts unknown books after every canonical book', () => {
        expect(compareCanonical(v('NotABook', 1, 1), v('Rev', 22, 21))).toBeGreaterThan(0);
    });
});
