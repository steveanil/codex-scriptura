import { describe, expect, it } from 'vitest';
import { darken, hexToRgb, lighten, withAlpha } from './color';

describe('hexToRgb', () => {
    it('parses 6-digit hex', () => {
        expect(hexToRgb('#5e9ed6')).toEqual([94, 158, 214]);
    });

    it('parses 3-digit hex', () => {
        expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
        expect(hexToRgb('#a3c')).toEqual([170, 51, 204]);
    });

    it('tolerates surrounding whitespace and uppercase', () => {
        expect(hexToRgb(' #5E9ED6 ')).toEqual([94, 158, 214]);
    });

    it('rejects non-hex input', () => {
        expect(hexToRgb('rebeccapurple')).toBeNull();
        expect(hexToRgb('rgb(1,2,3)')).toBeNull();
        expect(hexToRgb('#12345')).toBeNull();
        expect(hexToRgb('')).toBeNull();
    });
});

describe('withAlpha', () => {
    it('produces an rgba string', () => {
        expect(withAlpha('#5e9ed6', 0.14)).toBe('rgba(94, 158, 214, 0.14)');
    });

    it('falls back to the input when unparseable', () => {
        expect(withAlpha('nonsense', 0.5)).toBe('nonsense');
    });
});

describe('lighten / darken', () => {
    it('lighten mixes toward white', () => {
        expect(lighten('#000000', 1)).toBe('rgb(255, 255, 255)');
        expect(lighten('#5e9ed6', 0)).toBe('rgb(94, 158, 214)');
        expect(lighten('#5e9ed6', 0.35)).toBe('rgb(150, 192, 228)');
    });

    it('darken mixes toward black', () => {
        expect(darken('#ffffff', 1)).toBe('rgb(0, 0, 0)');
        expect(darken('#6b5ce7', 0.12)).toBe('rgb(94, 81, 203)');
    });

    it('both fall back to the input when unparseable', () => {
        expect(lighten('oops', 0.3)).toBe('oops');
        expect(darken('oops', 0.3)).toBe('oops');
    });
});
