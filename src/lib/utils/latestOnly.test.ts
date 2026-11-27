import { describe, expect, it } from 'vitest';
import { LatestOnly } from './latestOnly';

describe('LatestOnly', () => {
    it('a run stays current until a newer one begins', () => {
        const guard = new LatestOnly();
        const first = guard.begin();
        expect(first()).toBe(true);
        const second = guard.begin();
        expect(first()).toBe(false);
        expect(second()).toBe(true);
    });

    it('current() binds to the run in progress without superseding it', () => {
        const guard = new LatestOnly();
        const run = guard.begin();
        const bound = guard.current();
        expect(run()).toBe(true);
        expect(bound()).toBe(true);
        guard.begin();
        expect(bound()).toBe(false);
    });

    it('cancel() invalidates every outstanding check', () => {
        const guard = new LatestOnly();
        const run = guard.begin();
        const bound = guard.current();
        guard.cancel();
        expect(run()).toBe(false);
        expect(bound()).toBe(false);
    });

    it('a run begun after cancel() is current again', () => {
        const guard = new LatestOnly();
        guard.cancel();
        expect(guard.begin()()).toBe(true);
    });
});
