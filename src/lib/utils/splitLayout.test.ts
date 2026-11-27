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
    const sum = (ws: number[]) => ws.reduce((a, b) => a + b, 0);

    it('passes through a matching array and pads a short one at the average', () => {
        expect(normalizeWeights([1.5, 0.5], 2)).toEqual([1.5, 0.5]);
        expect(normalizeWeights([], 2)).toEqual([1, 1]);
        // The new pane joins at the average (1.5), then the trio is rescaled to sum 3
        const grown = normalizeWeights([2, 1], 3);
        expect(grown[0] / grown[1]).toBeCloseTo(2);
        expect(grown[2] / grown[1]).toBeCloseTo(1.5);
        expect(sum(grown)).toBeCloseTo(3);
    });

    it('drops trailing weights when panes closed and discards junk values', () => {
        const shrunk = normalizeWeights([1, 2, 3], 2);
        expect(shrunk[1] / shrunk[0]).toBeCloseTo(2);
        expect(sum(shrunk)).toBeCloseTo(2);
        expect(normalizeWeights([NaN, -1, 2], 1)).toEqual([1]);
        expect(normalizeWeights([1], 0)).toEqual([]);
    });

    // Issue #398: flex only hands out (sum of grow factors) of the free space
    // when that sum is below 1, so weights that never get rescaled leave a
    // lone pane at its dragged width.
    it('always sums to the pane count so the row fills', () => {
        expect(normalizeWeights([0.45], 1)).toEqual([1]);
        expect(sum(normalizeWeights([0.45, 0.45], 2))).toBeCloseTo(2);
        expect(sum(normalizeWeights([0.3, 0.3, 0.3], 3))).toBeCloseTo(3);
    });

    it('3 -> 2 -> 1 after dragging a pane narrow leaves the last pane full width', () => {
        // Three equal panes in a 900px row; drag the first divider hard left
        // so pane 0 lands at the minimum share
        const three = dragWeights([1, 1, 1], 0, -10_000, 900);
        expect(three[0] / sum(three)).toBeCloseTo(MIN_PANE_FRACTION);

        // Close pane 2 (the wide neighbour): survivors keep their ratio, sum to 2
        const two = normalizeWeights(three.filter((_, i) => i !== 2), 2);
        expect(sum(two)).toBeCloseTo(2);
        expect(two[0] / two[1]).toBeCloseTo(three[0] / three[1]);
        expect(two[0] / sum(two)).toBeGreaterThanOrEqual(MIN_PANE_FRACTION);

        // Close pane 1: the narrow pane 0 is alone and takes the whole row
        expect(normalizeWeights(two.filter((_, i) => i !== 1), 1)).toEqual([1]);

        // Same sequence closing the other pane first, and closing pane 0's
        // neighbours in the opposite order, ends the same way
        const twoB = normalizeWeights(three.filter((_, i) => i !== 1), 2);
        expect(sum(twoB)).toBeCloseTo(2);
        expect(normalizeWeights(twoB.filter((_, i) => i !== 1), 1)).toEqual([1]);
        expect(normalizeWeights(twoB.filter((_, i) => i !== 0), 1)).toEqual([1]);
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
