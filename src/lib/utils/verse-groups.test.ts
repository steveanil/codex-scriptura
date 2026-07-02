import { describe, expect, it } from 'vitest';
import { getContiguousGroups } from './verse-groups';

describe('getContiguousGroups', () => {
    it('returns no groups for an empty selection', () => {
        expect(getContiguousGroups([])).toEqual([]);
    });

    it('keeps a single contiguous run as one group', () => {
        expect(getContiguousGroups([3, 4, 5])).toEqual([[3, 4, 5]]);
    });

    it('splits non-adjacent selections into separate groups', () => {
        // Regression: selecting verse 10 then 14 must never produce
        // one annotation spanning 10–14 (v0.3.2 bug).
        expect(getContiguousGroups([10, 14])).toEqual([[10], [14]]);
    });

    it('handles mixed runs and singletons', () => {
        expect(getContiguousGroups([1, 2, 3, 7, 9, 10])).toEqual([[1, 2, 3], [7], [9, 10]]);
    });

    it('handles a single verse', () => {
        expect(getContiguousGroups([12])).toEqual([[12]]);
    });
});
