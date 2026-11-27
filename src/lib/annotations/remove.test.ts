import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '@codex-scriptura/core';

const db = vi.hoisted(() => ({
    saveAnnotation: vi.fn(async () => {}),
    deleteAnnotation: vi.fn(async () => {}),
}));
vi.mock('@codex-scriptura/db', () => db);

import { deleteWithUndo } from './remove.svelte';
import { toast } from '$lib/stores/toast.svelte';

function ann(id: string, type: Annotation['type']): Annotation {
    return { id, type, book: 'Gen', verseStart: 'Gen.1.1', verseEnd: 'Gen.1.1', data: '', tags: [], created: 1, modified: 1, synced: false };
}

afterEach(() => {
    for (const t of toast.items) toast.dismiss(t.id);
    db.saveAnnotation.mockClear();
    db.deleteAnnotation.mockClear();
});

describe('deleteWithUndo', () => {
    it('deletes every id and offers an Undo that re-saves the known records', async () => {
        const known = [ann('a', 'highlight'), ann('b', 'highlight'), ann('c', 'note')];
        await deleteWithUndo(['a', 'b'], known);
        expect(db.deleteAnnotation.mock.calls).toEqual([['a'], ['b']]);
        expect(toast.items.map((t) => t.message)).toEqual(['2 highlights deleted']);

        await toast.act(toast.items[0].id);
        expect(db.saveAnnotation.mock.calls).toEqual([[known[0]], [known[1]]]);
        expect(toast.items).toEqual([]);
    });

    it('names one record by its type', async () => {
        await deleteWithUndo(['t'], [ann('t', 'theme')]);
        expect(toast.items.map((t) => t.message)).toEqual(['Theme tag deleted']);
    });

    it('deletes ids the pane does not know without a toast', async () => {
        await deleteWithUndo(['x'], [ann('a', 'note')]);
        expect(db.deleteAnnotation).toHaveBeenCalledWith('x');
        expect(toast.items).toEqual([]);
    });
});
