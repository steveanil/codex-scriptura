import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastState } from './toast.svelte';

describe('ToastState', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('shows a toast and auto-dismisses it', () => {
        const t = new ToastState();
        t.show('Copied');
        expect(t.items.map((x) => x.message)).toEqual(['Copied']);
        vi.advanceTimersByTime(3999);
        expect(t.items).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(t.items).toHaveLength(0);
    });

    it('keeps an actionable toast up longer', () => {
        const t = new ToastState();
        t.show('Note deleted', { action: { label: 'Undo', run: () => {} } });
        vi.advanceTimersByTime(4000);
        expect(t.items).toHaveLength(1);
        vi.advanceTimersByTime(4000);
        expect(t.items).toHaveLength(0);
    });

    it('act runs the action once and removes the toast', async () => {
        const t = new ToastState();
        const run = vi.fn();
        const id = t.show('Note deleted', { action: { label: 'Undo', run } });
        await t.act(id);
        await t.act(id); // gone - must not run again
        expect(run).toHaveBeenCalledTimes(1);
        expect(t.items).toHaveLength(0);
    });

    it('dismiss cancels the timer so a reused id cannot be dismissed twice', () => {
        const t = new ToastState();
        const id = t.show('a');
        t.dismiss(id);
        t.show('b');
        vi.advanceTimersByTime(4000 - 1);
        // 'a' timer was cleared; only 'b' is pending and still visible
        expect(t.items.map((x) => x.message)).toEqual(['b']);
    });

    it('drops the oldest toast beyond the visible cap', () => {
        const t = new ToastState();
        for (const m of ['1', '2', '3', '4']) t.show(m);
        expect(t.items.map((x) => x.message)).toEqual(['2', '3', '4']);
    });
});
