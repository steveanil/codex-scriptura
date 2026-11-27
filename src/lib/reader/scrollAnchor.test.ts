import { describe, expect, it } from 'vitest';
import { anchorAtTop, scrollTopForAnchor, type VerseBox } from './scrollAnchor';

// A pane whose content box starts 100px down the viewport, with verses
// stacked 40px tall below a 60px heading, scrolled by `scrolled`.
function boxes(scrolled: number, count = 5): VerseBox[] {
    return Array.from({ length: count }, (_, i) => {
        const top = 100 + 60 + i * 40 - scrolled;
        return { verse: i + 1, top, bottom: top + 40, height: 40 };
    });
}

describe('anchorAtTop', () => {
    it('is the first verse when the pane is at the top, progress clamped to 0', () => {
        expect(anchorAtTop(100, boxes(0))).toEqual({ verse: 1, progress: 0 });
    });

    it('is the verse at the top edge exactly, with no progress', () => {
        expect(anchorAtTop(100, boxes(60 + 40))).toEqual({ verse: 2, progress: 0 });
    });

    it('reports how far into the verse the top edge sits', () => {
        expect(anchorAtTop(100, boxes(60 + 2 * 40 + 10))).toEqual({ verse: 3, progress: 0.25 });
    });

    it('skips a verse that ends within a pixel of the top edge', () => {
        // Verse 1 ends at 100.5: not counted as on screen
        expect(anchorAtTop(100, boxes(60 + 39.5))).toEqual({ verse: 2, progress: 0 });
    });

    it('skips boxes with no height (hidden verses)', () => {
        const list = boxes(0);
        list[0] = { ...list[0], height: 0 };
        expect(anchorAtTop(100, list)?.verse).toBe(2);
    });

    it('is null when no verse is rendered below the top edge', () => {
        expect(anchorAtTop(100, [])).toBeNull();
        expect(anchorAtTop(100, boxes(1000))).toBeNull();
    });

    it('is null when the first visible verse number does not parse', () => {
        const list = boxes(0);
        list[0] = { ...list[0], verse: NaN };
        expect(anchorAtTop(100, list)).toBeNull();
    });

    it('stops reading boxes at the first hit', () => {
        let read = 0;
        function* lazy() {
            for (const b of boxes(0)) { read++; yield b; }
        }
        anchorAtTop(100, lazy());
        expect(read).toBe(1);
    });
});

describe('scrollTopForAnchor', () => {
    const metrics = { scrollTop: 0, scrollHeight: 2000, clientHeight: 500, containerTop: 100 };

    it('puts the verse top at the container top', () => {
        // Verse 3 sits 140px below the container top when unscrolled
        expect(scrollTopForAnchor({ ...metrics, verseTop: 240, verseHeight: 40, progress: 0 })).toBe(140);
    });

    it('adds the progress into the verse, relative to the current scroll', () => {
        expect(scrollTopForAnchor({ ...metrics, scrollTop: 50, verseTop: 190, verseHeight: 40, progress: 0.25 })).toBe(150);
    });

    it('clamps the target to the bottom of the scrollable range', () => {
        expect(scrollTopForAnchor({ ...metrics, verseTop: 1900, verseHeight: 40, progress: 0.5 })).toBe(1500);
    });

    it('never goes above the top', () => {
        expect(scrollTopForAnchor({ ...metrics, scrollTop: 10, verseTop: 20, verseHeight: 40, progress: 0 })).toBe(0);
    });

    it('is 0 when the content does not overflow', () => {
        expect(scrollTopForAnchor({ ...metrics, scrollHeight: 400, verseTop: 240, verseHeight: 40, progress: 0 })).toBe(0);
    });
});
