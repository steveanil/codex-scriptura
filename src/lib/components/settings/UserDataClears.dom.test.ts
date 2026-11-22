// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import type { Annotation } from '@codex-scriptura/core';
import { db, deleteKv, setKv } from '@codex-scriptura/db';
import { toast } from '$lib/stores/toast.svelte';
import { LAST_EXPORT_KEY } from '$lib/utils/backup';
import UserDataClears from './UserDataClears.svelte';

function rec(id: string, type: Annotation['type'], over: Partial<Annotation> = {}): Annotation {
    return {
        id, type, book: 'Ruth', verseStart: 'Ruth.1.16', verseEnd: 'Ruth.1.17',
        data: 'x', tags: type === 'note' ? ['loyalty'] : [], created: 5, modified: 9, synced: false, ...over,
    };
}

const SEED = [
    rec('h1', 'highlight', { data: '#ffff00' }), rec('h2', 'highlight', { data: '#00ff00', modified: 12 }), rec('h3', 'highlight'),
    rec('n1', 'note'), rec('n2', 'note'),
    rec('t1', 'theme', { data: 'Loyalty', tags: ['loyalty'] }),
];

beforeEach(async () => {
    await db.annotations.clear();
    await db.annotations.bulkPut(SEED);
    await setKv(LAST_EXPORT_KEY, 1);
    for (const t of toast.items) toast.dismiss(t.id);
});
afterEach(cleanup);

const trigger = (c: HTMLElement, type: string) => c.querySelector<HTMLButtonElement>(`[data-clear="${type}"]`)!;
const hints = (c: HTMLElement) => [...c.querySelectorAll('.hint')].map((h) => h.textContent);

describe('UserDataClears', () => {
    it('shows a live count per kind and disables the button at zero', async () => {
        const { container } = render(UserDataClears);
        await vi.waitFor(() => expect(hints(container)).toEqual([
            '3 highlights.',
            '2 notes. Your tag list is kept.',
            '1 theme tag. The Themes page will be empty.',
        ]));
        expect(trigger(container, 'theme').disabled).toBe(false);

        await db.annotations.delete('t1');
        await vi.waitFor(() => expect(trigger(container, 'theme').disabled).toBe(true));
        expect(hints(container)[2]).toBe('No theme tags. The Themes page will be empty.');
    });

    it('asks first, naming the count and what stays, and backs out with Escape', async () => {
        const { container, getByRole } = render(UserDataClears);
        await vi.waitFor(() => expect(trigger(container, 'highlight').disabled).toBe(false));

        await fireEvent.click(trigger(container, 'highlight'));
        await vi.waitFor(() => expect(getByRole('alert').textContent).toContain('Delete 3 highlights? Notes and theme tags stay.'));
        expect(getByRole('alert').textContent).not.toContain('backup');
        const cancel = getByRole('button', { name: 'Cancel' });
        expect(document.activeElement).toBe(cancel);
        expect(trigger(container, 'highlight').getAttribute('aria-expanded')).toBe('true');

        await fireEvent.keyDown(cancel, { key: 'Escape' });
        await vi.waitFor(() => expect(container.querySelector('.confirm')).toBeNull());
        expect(document.activeElement).toBe(trigger(container, 'highlight'));
        expect(await db.annotations.count()).toBe(SEED.length);
    });

    it('keeps only one row in confirm state and Cancel returns focus to its row', async () => {
        const { container, getByRole } = render(UserDataClears);
        await vi.waitFor(() => expect(trigger(container, 'note').disabled).toBe(false));

        await fireEvent.click(trigger(container, 'highlight'));
        await vi.waitFor(() => expect(container.querySelectorAll('.confirm')).toHaveLength(1));
        await fireEvent.click(trigger(container, 'note'));
        await vi.waitFor(() => expect(getByRole('alert').textContent).toContain('Delete 2 notes?'));
        expect(container.querySelectorAll('.confirm')).toHaveLength(1);

        await fireEvent.click(getByRole('button', { name: 'Cancel' }));
        await vi.waitFor(() => expect(container.querySelector('.confirm')).toBeNull());
        expect(document.activeElement).toBe(trigger(container, 'note'));
    });

    it('says so when no backup has ever been exported', async () => {
        await deleteKv(LAST_EXPORT_KEY);
        const { container, getByRole } = render(UserDataClears);
        await vi.waitFor(() => expect(trigger(container, 'note').disabled).toBe(false));
        await fireEvent.click(trigger(container, 'note'));
        await vi.waitFor(() => expect(getByRole('alert').textContent).toContain('You have not exported a backup yet.'));
    });

    it('deletes one kind only, then Undo puts the same records back', async () => {
        const onChange = vi.fn();
        const { container, getByRole } = render(UserDataClears, { onChange });
        await vi.waitFor(() => expect(trigger(container, 'highlight').disabled).toBe(false));

        await fireEvent.click(trigger(container, 'highlight'));
        await vi.waitFor(() => getByRole('button', { name: 'Delete 3 highlights' }));
        await fireEvent.click(getByRole('button', { name: 'Delete 3 highlights' }));

        await vi.waitFor(() => expect(toast.items.map((t) => t.message)).toContain('3 highlights deleted'));
        expect((await db.annotations.toArray()).map((a) => a.id).sort()).toEqual(['n1', 'n2', 't1']);
        expect(onChange).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(trigger(container, 'highlight').disabled).toBe(true));
        expect(container.querySelector('.confirm')).toBeNull();
        expect(document.activeElement?.id).toBe('clears-heading');

        const t =toast.items.find((t) => t.message === '3 highlights deleted')!;
        expect(t.action?.label).toBe('Undo');
        await toast.act(t.id);
        expect(await db.annotations.orderBy('id').toArray()).toEqual([...SEED].sort((a, b) => a.id.localeCompare(b.id)));
        expect(onChange).toHaveBeenCalledTimes(2);
        await vi.waitFor(() => expect(hints(container)[0]).toBe('3 highlights.'));
    });
});
