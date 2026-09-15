import { describe, expect, it } from 'vitest';
import { extractLemmas, normalizeStrongsToken } from './verse-wire.js';

describe('normalizeStrongsToken', () => {
    it('strips prefixes, uppercases, and drops zero padding', () => {
        expect(normalizeStrongsToken('strong:H7225')).toBe('H7225');
        expect(normalizeStrongsToken('lemma.G26')).toBe('G26');
        expect(normalizeStrongsToken('h0430')).toBe('H430');
        expect(normalizeStrongsToken('G0026')).toBe('G26');
        expect(normalizeStrongsToken(' H1254a ')).toBe('H1254A');
    });

    it('rejects non-Strong tokens', () => {
        expect(normalizeStrongsToken('b.7225')).toBe(null);
        expect(normalizeStrongsToken('H')).toBe(null);
        expect(normalizeStrongsToken('X99')).toBe(null);
        expect(normalizeStrongsToken('')).toBe(null);
    });
});

describe('extractLemmas', () => {
    it('extracts from OSIS lemma attributes, deduplicated', () => {
        const slice = '<w lemma="strong:H7225">beginning</w> <w lemma="strong:H430">God</w> <w lemma="strong:H430">God</w>';
        expect(extractLemmas(slice)).toBe('H7225 H430');
    });

    it('splits multi-token lemma attributes', () => {
        expect(extractLemmas('<w lemma="strong:H853 strong:H8064">the heavens</w>')).toBe('H853 H8064');
    });

    it('reads the USFX s= attribute only when asked', () => {
        const slice = '<w s="G2316">God</w>';
        expect(extractLemmas(slice)).toBe('');
        expect(extractLemmas(slice, ['lemma', 's'])).toBe('G2316');
    });

    it('normalizes zero padding regardless of attribute form', () => {
        expect(extractLemmas('<w s="H0430">God</w>', ['lemma', 's'])).toBe('H430');
    });

    it('returns empty for untagged text', () => {
        expect(extractLemmas('In the beginning God created')).toBe('');
    });
});
