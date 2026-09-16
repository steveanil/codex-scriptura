/**
 * Chapter-pill overflow rule (issue #246). The passage bar keeps the pill
 * strip for short books and folds it into the book-and-chapter trigger
 * when it would not fit: one control, two presentations. Psalms (150)
 * never gets a strip; Genesis (50) gets one only when the bar is wide.
 */
export const PILL_THRESHOLD = 25;
export const PILL_WIDTH = 32;
export const PILL_GAP = 2;

export function chapterStripMode(chapterCount: number, availableWidth: number): 'pills' | 'collapsed' {
    if (chapterCount <= 0 || chapterCount > PILL_THRESHOLD) return 'collapsed';
    const needed = chapterCount * PILL_WIDTH + Math.max(0, chapterCount - 1) * PILL_GAP;
    return needed <= availableWidth ? 'pills' : 'collapsed';
}
