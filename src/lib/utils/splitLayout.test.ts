import { describe, it, expect } from 'vitest';
import { scrollFraction, fractionToScrollTop, normalizeWeights, dragWeights, MIN_PANE_FRACTION } from './splitLayout';

describe('scrollFraction / fractionToScrollTop', () => {
    it('maps positions to fractions of the scrollable range, not raw pixels', () => {
        expect(scrollFraction(0, 2000, 500)).toBe(0);
        expect(scrollFraction(750, 2000, 500)).toBe(0.5);
        expect(scrollFraction(1500, 2000, 500)).toBe(1);
    });

    it('round-trips through panes of different content lengths', () => {
        // Halfway down a long pane lands halfway down a short one
        const f = scrollFraction(3000, 6500, 500);
        expect(fractionToScrollTop(f, 1500, 500)).toBe(500);
    });

    it('clamps out-of-range input and handles unscrollable panes', () => {
        expect(scrollFraction(9999, 2000, 500)).toBe(1);
        expect(scrollFraction(-5, 2000, 500)).toBe(0);
        expect(scrollFraction(100, 400, 500)).toBe(0); // content shorter than viewport
        expect(fractionToScrollTop(0.5, 400, 500)).toBe(0);
        expect(fractionToScrollTop(1.7, 2000, 500)).toBe(1500);
    });
});

describe('normalizeWeights', () => {
    it('passes through a matching array and pads a short one at the average', () => {
        expect(normalizeWeights([2, 1], 2)).toEqual([2, 1]);
        expect(normalizeWeights([2, 1], 3)).toEqual([2, 1, 1.5]);
        expect(normalizeWeights([], 2)).toEqual([1, 1]);
    });

    it('drops trailing weights when panes closed and discards junk values', () => {
        expect(normalizeWeights([1, 2, 3], 2)).toEqual([1, 2]);
        expect(normalizeWeights([NaN, -1, 2], 1)).toEqual([2]);
    });
});

describe('dragWeights', () => {
    it('trades weight between the two panes adjacent to the divider only', () => {
        const next = dragWeights([1, 1, 1], 0, 150, 900);
        // 150px of a 900px row with total weight 3 = 0.5 weight
        expect(next[0]).toBeCloseTo(1.5);
        expect(next[1]).toBeCloseTo(0.5);
        expect(next[2]).toBe(1);
    });

    it('never shrinks a pane below the minimum fraction', () => {
        const next = dragWeights([1, 1], 0, 10_000, 1000);
        const total = next[0] + next[1];
        expect(next[1] / total).toBeCloseTo(MIN_PANE_FRACTION);
        const back = dragWeights([1, 1], 0, -10_000, 1000);
        expect(back[0] / total).toBeCloseTo(MIN_PANE_FRACTION);
    });

    it('ignores invalid dividers and degenerate containers', () => {
        expect(dragWeights([1, 1], 1, 50, 800)).toEqual([1, 1]);
        expect(dragWeights([1, 1], -1, 50, 800)).toEqual([1, 1]);
        expect(dragWeights([1, 1], 0, 50, 0)).toEqual([1, 1]);
    });
});
