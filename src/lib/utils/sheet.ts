/**
 * Bottom-sheet stops for the Study Rail on phones (issue #253). Two stops:
 * peek (about 45vh) and full. A swipe on the handle moves between them
 * once it passes a small threshold; a tap toggles.
 */
export type SheetStop = 'peek' | 'full';

export const SWIPE_THRESHOLD = 40;

export function nextSheetStop(current: SheetStop, deltaY: number): SheetStop {
    if (deltaY <= -SWIPE_THRESHOLD) return 'full';
    if (deltaY >= SWIPE_THRESHOLD) return 'peek';
    return current;
}

export function toggleSheetStop(current: SheetStop): SheetStop {
    return current === 'peek' ? 'full' : 'peek';
}
