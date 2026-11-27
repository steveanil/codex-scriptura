import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACCENT_PRESETS } from '../accent-presets';
import {
    AA_TEXT, DARK_BG, LIGHT_BG, LIGHT_HOVER_BG, contrastRatio, darkenUntil, formatRatio, isHex,
    lightAccentSurface, resolveAccent, themeBackground,
} from './contrast';

const appCss = readFileSync(join(__dirname, '..', '..', 'app.css'), 'utf8');
const lightBlock = appCss.match(/\[data-theme="light"\]\s*{([\s\S]*?)\n}/)![1];
const darkBlock = appCss.match(/:root\s*{([\s\S]*?)\n}/)![1];
const token = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))![1].toLowerCase();
/** Every plain surface the light theme declares; accent text can sit on any of them. */
const lightSurfaces = [...lightBlock.matchAll(/(--color-bg[\w-]*):\s*(#[0-9a-fA-F]{6})/g)].map((m) => ({ name: m[1], hex: m[2] }));

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

describe('fallback constants', () => {
    it('match the tokens app.css declares', () => {
        expect(DARK_BG).toBe(token(darkBlock, '--color-bg'));
        expect(LIGHT_BG).toBe(token(lightBlock, '--color-bg'));
        expect(LIGHT_HOVER_BG).toBe(token(lightBlock, '--color-bg-hover'));
    });
    it('the hover surface is the darkest light surface, so AA there is AA everywhere', () => {
        expect(lightSurfaces.length).toBeGreaterThan(3);
        for (const s of lightSurfaces) {
            expect(contrastRatio('#000000', s.hex), s.name).toBeGreaterThanOrEqual(contrastRatio('#000000', LIGHT_HOVER_BG));
        }
    });
    it('lightAccentSurface falls back to the constant without a document', () => {
        expect(lightAccentSurface()).toBe(LIGHT_HOVER_BG);
    });
});

describe('resolveAccent', () => {
    const DEFAULT = '#5e9ed6';

    it('leaves the stored hue alone in the dark theme', () => {
        expect(resolveAccent({ accentColor: DEFAULT }, 'dark')).toBe(DEFAULT);
        expect(resolveAccent({ accentColor: DEFAULT, accentColorLight: '#123456' }, 'dark')).toBe(DEFAULT);
    });

    it('a default profile gets AA accent text in the light theme (#456)', () => {
        const out = resolveAccent({ accentColor: DEFAULT }, 'light');
        expect(out).not.toBe(DEFAULT);
        for (const s of lightSurfaces) expect(contrastRatio(out, s.hex), s.name).toBeGreaterThanOrEqual(AA_TEXT);
        // Same hue family: blue stays the largest channel
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16));
        expect(b).toBeGreaterThan(g);
        expect(g).toBeGreaterThan(r);
    });

    it('every preset holds AA on every light surface without the user doing anything', () => {
        for (const p of ACCENT_PRESETS) {
            const out = resolveAccent({ accentColor: p.hex }, 'light');
            for (const s of lightSurfaces) {
                expect(contrastRatio(out, s.hex), `${p.name} on ${s.name}`).toBeGreaterThanOrEqual(AA_TEXT);
            }
        }
    });

    it('does not touch a hue that already passes', () => {
        expect(resolveAccent({ accentColor: '#1d3f8a' }, 'light')).toBe('#1d3f8a');
    });

    it('an explicit light accent wins, including the stored hue itself (one hue for both themes)', () => {
        expect(resolveAccent({ accentColor: DEFAULT, accentColorLight: '#2a5d8f' }, 'light')).toBe('#2a5d8f');
        expect(resolveAccent({ accentColor: DEFAULT, accentColorLight: DEFAULT }, 'light')).toBe(DEFAULT);
    });
});
