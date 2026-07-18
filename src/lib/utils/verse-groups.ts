/**
 * Group a sorted array of verse numbers into contiguous runs.
 *
 * Annotations are created per contiguous group so that selecting
 * verses 10 and 14 never produces a highlight spanning 10–14.
 * Input MUST be sorted ascending - callers keep `selectedVerses`
 * sorted at every mutation.
 *
 *   [10, 11, 12, 14] → [[10, 11, 12], [14]]
 */
export function getContiguousGroups(verses: number[]): number[][] {
    const groups: number[][] = [];
    for (const v of verses) {
        const last = groups[groups.length - 1];
        if (last && v === last[last.length - 1] + 1) {
            last.push(v);
        } else {
            groups.push([v]);
        }
    }
    return groups;
}
