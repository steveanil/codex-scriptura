import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '@codex-scriptura/core';

const db = vi.hoisted(() => ({ observeAnnotationsForBook: vi.fn() }));
vi.mock('@codex-scriptura/db', () => db);

import { BookAnnotations } from './bookAnnotations.svelte';

type Observer = { next: (a: Annotation[]) => void; error: (e: unknown) => void };

// Each subscription is captured so a test decides when (and whether) it emits.
let observers: Map<string, Observer>;
const unsubscribe = vi.fn();

function note(book: string): Annotation {
    return {
        id: `${book}-note`, type: 'note', book,
        verseStart: `${book}.1.1`, verseEnd: `${book}.1.1`,
        data: 'x', tags: [], created: 0, modified: 0, synced: false,
    };
}

/** Lets pending promise callbacks run, then reports whether `p` has settled. */
async function settled(p: Promise<void>): Promise<boolean> {
    let done = false;
    void p.then(() => { done = true; });
    await Promise.resolve();
    await Promise.resolve();
    return done;
}

beforeEach(() => {
    vi.clearAllMocks();
    observers = new Map();
    db.observeAnnotationsForBook.mockImplementation((book: string) => ({
        subscribe: (obs: Observer) => {
            observers.set(book, obs);
            return { unsubscribe };
        },
    }));
});

describe('BookAnnotations', () => {
    it('follow resolves on the first emission for the book, not before', async () => {
        const anns = new BookAnnotations();
        const first = anns.follow('Gen');
        expect(await settled(first)).toBe(false);
        observers.get('Gen')!.next([note('Gen')]);
        expect(await settled(first)).toBe(true);
        expect(anns.items.map((a) => a.book)).toEqual(['Gen']);
    });

    it('later emissions keep items current without another follow', async () => {
        const anns = new BookAnnotations();
        const first = anns.follow('Gen');
        observers.get('Gen')!.next([]);
        await first;
        observers.get('Gen')!.next([note('Gen')]);
        expect(anns.items).toHaveLength(1);
    });

    it('subscribes once per book: following the same book again is a no-op', async () => {
        const anns = new BookAnnotations();
        const first = anns.follow('Gen');
        observers.get('Gen')!.next([]);
        await first;
        await anns.follow('Gen');
        expect(db.observeAnnotationsForBook).toHaveBeenCalledTimes(1);

        const second = anns.follow('Exod');
        expect(db.observeAnnotationsForBook).toHaveBeenCalledTimes(2);
        expect(unsubscribe).toHaveBeenCalledTimes(1); // old book's sub torn down
        observers.get('Exod')!.next([]);
        await second;
    });

    it('a pending follow resolves when a newer book supersedes it', async () => {
        const anns = new BookAnnotations();
        const gen = anns.follow('Gen'); // never emits
        anns.follow('Exod');
        expect(await settled(gen)).toBe(true);
    });

    it('a subscription error still resolves the pending follow', async () => {
        const anns = new BookAnnotations();
        const first = anns.follow('Gen');
        observers.get('Gen')!.error(new Error('closed'));
        expect(await settled(first)).toBe(true);
    });

    it('dispose tears the subscription down and resolves a pending follow', async () => {
        const anns = new BookAnnotations();
        const pending = anns.follow('Gen');
        anns.dispose();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(await settled(pending)).toBe(true);
    });

    it('follow after dispose never subscribes (#186)', async () => {
        const anns = new BookAnnotations();
        anns.dispose();
        await anns.follow('Gen');
        expect(db.observeAnnotationsForBook).not.toHaveBeenCalled();
    });
});
