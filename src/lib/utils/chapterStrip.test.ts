import { describe, expect, it } from 'vitest';
import { PILL_THRESHOLD, chapterStripMode } from './chapterStrip';

describe('chapterStripMode', () => {
    it('shows pills for a short book that fits', () => {
        expect(chapterStripMode(5, 600)).toBe('pills');
        expect(chapterStripMode(PILL_THRESHOLD, 2000)).toBe('pills');
    });
    it('collapses above the threshold regardless of width', () => {
        expect(chapterStripMode(PILL_THRESHOLD + 1, 5000)).toBe('collapsed');
        expect(chapterStripMode(150, 5000)).toBe('collapsed');
    });
    it('collapses when the pills would not fit the bar', () => {
        expect(chapterStripMode(20, 300)).toBe('collapsed');
        expect(chapterStripMode(20, 20 * 32 + 19 * 2)).toBe('pills');
        expect(chapterStripMode(20, 20 * 32 + 19 * 2 - 1)).toBe('collapsed');
    });
    it('collapses with no chapters', () => {
        expect(chapterStripMode(0, 1000)).toBe('collapsed');
    });
});
