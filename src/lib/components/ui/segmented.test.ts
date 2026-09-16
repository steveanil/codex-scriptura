import { describe, expect, it } from 'vitest';
import { SEGMENT_MAX, segmentedPresentation, stepValue } from './segmented';

describe('segmentedPresentation', () => {
    it('keeps a row up to four options', () => {
        for (let n = 1; n <= SEGMENT_MAX; n++) expect(segmentedPresentation(n)).toBe('segments');
    });
    it('becomes a dropdown at five or more', () => {
        expect(segmentedPresentation(5)).toBe('dropdown');
        expect(segmentedPresentation(9)).toBe('dropdown');
    });
});

describe('stepValue', () => {
    const opts = [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B', disabled: true },
        { value: 'c', label: 'C' },
    ];
    it('steps forward and wraps', () => {
        expect(stepValue(opts, 'a', 1)).toBe('c');
        expect(stepValue(opts, 'c', 1)).toBe('a');
    });
    it('steps backward and wraps', () => {
        expect(stepValue(opts, 'a', -1)).toBe('c');
    });
    it('skips disabled options', () => {
        expect(stepValue(opts, 'a', 1)).not.toBe('b');
    });
    it('lands on the first enabled option when current is unknown', () => {
        expect(stepValue(opts, 'zzz', 1)).toBe('a');
    });
    it('returns current when nothing is enabled', () => {
        expect(stepValue([{ value: 'x', label: 'X', disabled: true }], 'x', 1)).toBe('x');
    });
});
