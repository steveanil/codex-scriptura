import { describe, expect, it } from 'vitest';
import { SWIPE_THRESHOLD, nextSheetStop, toggleSheetStop } from './sheet';

describe('bottom sheet stops', () => {
    it('a swipe up past the threshold goes full, a swipe down goes to peek', () => {
        expect(nextSheetStop('peek', -SWIPE_THRESHOLD)).toBe('full');
        expect(nextSheetStop('full', SWIPE_THRESHOLD)).toBe('peek');
    });
    it('a short drag keeps the current stop', () => {
        expect(nextSheetStop('peek', -10)).toBe('peek');
        expect(nextSheetStop('full', 10)).toBe('full');
    });
    it('a tap toggles', () => {
        expect(toggleSheetStop('peek')).toBe('full');
        expect(toggleSheetStop('full')).toBe('peek');
    });
});
