import { describe, it, expect } from 'vitest';
import { parseGlossField, parseHebrewStrongs } from './import-hebrew-strongs.js';

describe('parseGlossField', () => {
    it('extracts the pronunciation from the first parenthesized group', () => {
        const parsed = parseGlossField("ab (awb) n-m.\n1. father");
        expect(parsed).toEqual({ transliteration: 'ab', pronunciation: 'awb', gloss: 'father' });
    });

    it('keeps multi-word pronunciations and ignores variant-form groups', () => {
        const parsed = parseGlossField("Abiygayil (ab-ee-gah'-yil) (or shorter Abiygal {ab-ee-gal'}) n/p.\n1. Abigail");
        expect(parsed.pronunciation).toBe("ab-ee-gah'-yil");
    });

    it('repairs line-wrap artifacts inside the pronunciation', () => {
        const parsed = parseGlossField("Abel Mayim (aw-bale' mah'- yim) n/l.\n1. Abel-Maim");
        expect(parsed.pronunciation).toBe("aw-bale' mah'-yim");
    });

    it('omits pronunciation when the first line has no parenthesized group', () => {
        const parsed = parseGlossField('חלם\n1. to dream');
        expect(parsed.pronunciation).toBeUndefined();
    });
});

describe('parseHebrewStrongs', () => {
    it('carries pronunciation onto the lexicon entry only when present', () => {
        const csv = [
            'strongs_number,word,gloss',
            '1,אב,"ab (awb) n-m.\n1. father"',
            '2492,חלם,"חלם\n1. to dream"',
        ].join('\n');

        const [ab, chalam] = parseHebrewStrongs(csv);
        expect(ab.pronunciation).toBe('awb');
        expect(ab.transliteration).toBe('ab');
        expect(chalam.pronunciation).toBeUndefined();
    });
});
