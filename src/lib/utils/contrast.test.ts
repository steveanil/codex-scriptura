import { describe, expect, it } from 'vitest';
import { AA_TEXT, DARK_BG, LIGHT_BG, contrastRatio, darkenUntil, formatRatio, isHex, themeBackground } from './contrast';

describe('contrastRatio', () => {
    it('is symmetric and 21:1 for black on white', () => {
        expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
        expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
    });
    it('the default accent passes on dark and fails on light', () => {
        expect(contrastRatio('#5e9ed6', DARK_BG)).toBeGreaterThan(AA_TEXT);
        expect(contrastRatio('#5e9ed6', LIGHT_BG)).toBeLessThan(AA_TEXT);
    });
    it('formats to one decimal', () => {
        expect(formatRatio(6.41)).toBe('6.4:1');
    });
    it('isHex accepts 3 and 6 digit forms only', () => {
        expect(isHex('#abc')).toBe(true);
        expect(isHex('#5e9ed6')).toBe(true);
        expect(isHex('5e9ed6')).toBe(false);
        expect(isHex('#xyz')).toBe(false);
    });
});

describe('darkenUntil', () => {
    it('returns the input when it already passes', () => {
        expect(darkenUntil('#000000', LIGHT_BG)).toBe('#000000');
    });
    it('finds a darker shade that passes AA on the light background', () => {
        const out = darkenUntil('#5e9ed6', LIGHT_BG);
        expect(out).not.toBe('#5e9ed6');
        expect(contrastRatio(out, LIGHT_BG)).toBeGreaterThanOrEqual(AA_TEXT);
        // Same hue family: blue channel stays the largest
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16));
        expect(b).toBeGreaterThan(r);
        expect(b).toBeGreaterThan(g);
    });
});

describe('themeBackground', () => {
    it('falls back to the constants without a document', () => {
        expect(themeBackground('dark')).toBe(DARK_BG);
        expect(themeBackground('light')).toBe(LIGHT_BG);
    });
});
