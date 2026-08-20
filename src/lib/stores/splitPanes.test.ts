import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerseRecord } from '@codex-scriptura/core';

// PaneState talks to Dexie through @codex-scriptura/db - mock the whole
// module so the store logic runs against an in-memory canon fixture.
const db = vi.hoisted(() => ({
    getChapter: vi.fn(),
    getBookList: vi.fn(),
    getChapterList: vi.fn(),
    observeAnnotationsForBook: vi.fn(),
    getEntitiesForChapter: vi.fn(),
    getKv: vi.fn(),
    setKv: vi.fn(),
}));
vi.mock('@codex-scriptura/db', () => db);

import { PaneState, persistSplitPanes, restoreSplitLayout, getSplitToggles, updateSplitToggles, type PaneLocation } from './splitPanes.svelte';

// loadChapter schedules a chapter-pill scroll; the pane has no DOM here.
globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(0); return 0; }) as typeof requestAnimationFrame;

// node has no localStorage; restoreSplitLayout's legacy migration needs one.
const backing = new Map<string, string>();
globalThis.localStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
} as unknown as Storage;

function verse(translation: string, book: string, chapter: number): VerseRecord {
    return {
        id: `${translation}:${book}.${chapter}.1`,
        translationId: translation,
        book,
        chapter,
        verse: 1,
        osisId: `${book}.${chapter}.1`,
        text: `${book} ${chapter}:1`,
    };
}

/** translation → book → chapter list. Ps skips even chapters (sparse list). */
const CANON: Record<string, Record<string, number[]>> = {
    KJV: { Gen: [1, 2, 3], Ps: [1, 3, 5], Exod: [1, 2] },
    OEB: { Exod: [1, 2] },            // partial canon: no Gen
    ASV: { Gen: [2, 3], Exod: [1] },  // Gen exists but chapter 1 does not
};

const unsubscribe = vi.fn();

function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

beforeEach(() => {
    vi.clearAllMocks();
    backing.clear();
    db.getBookList.mockImplementation(async (t: string) => Object.keys(CANON[t] ?? {}));
    db.getChapterList.mockImplementation(async (t: string, b: string) => CANON[t]?.[b] ?? []);
    db.getChapter.mockImplementation(async (t: string, b: string, c: number) =>
        (CANON[t]?.[b] ?? []).includes(c) ? [verse(t, b, c)] : []);
    db.getEntitiesForChapter.mockResolvedValue({ persons: [], places: [], events: [] });
    db.observeAnnotationsForBook.mockImplementation(() => ({
        subscribe: (obs: { next: (a: unknown[]) => void }) => {
            obs.next([]);
            return { unsubscribe };
        },
    }));
    db.getKv.mockResolvedValue(undefined);
    db.setKv.mockResolvedValue(undefined);
});

async function makePane(loc: Partial<PaneLocation> = {}): Promise<PaneState> {
    const pane = new PaneState(loc);
    await pane.loadNavigation();
    await pane.loadChapter();
    return pane;
}

function trackHooks(pane: PaneState): string[] {
    const events: string[] = [];
    pane.onBeforeNavigate = () => events.push(`before:${pane.book}.${pane.chapter}`);
    pane.onAfterNavigate = () => events.push(`after:${pane.book}.${pane.chapter}`);
    return events;
}

describe('PaneState chapter navigation', () => {
    it('nextChapter moves within the book', async () => {
        const pane = await makePane({ book: 'Gen', chapter: 1 });
        await pane.nextChapter();
        expect([pane.book, pane.chapter]).toEqual(['Gen', 2]);
        expect(pane.verses[0]?.osisId).toBe('Gen.2.1');
    });

    it('nextChapter at the last chapter falls into the next book at chapter 1', async () => {
        const pane = await makePane({ book: 'Gen', chapter: 3 });
        await pane.nextChapter();
        expect([pane.book, pane.chapter]).toEqual(['Ps', 1]);
    });

    it('prevChapter at chapter 1 falls into the previous book at its LAST chapter', async () => {
        const pane = await makePane({ book: 'Ps', chapter: 1 });
        await pane.prevChapter();
        expect([pane.book, pane.chapter]).toEqual(['Gen', 3]);
    });

    it('no-ops at the canon edges without firing hooks', async () => {
        const first = await makePane({ book: 'Gen', chapter: 1 });
        const firstEvents = trackHooks(first);
        await first.prevChapter();
        expect([first.book, first.chapter]).toEqual(['Gen', 1]);
        expect(firstEvents).toEqual([]);

        const last = await makePane({ book: 'Exod', chapter: 2 });
        const lastEvents = trackHooks(last);
        await last.nextChapter();
        expect([last.book, last.chapter]).toEqual(['Exod', 2]);
        expect(lastEvents).toEqual([]);
    });

    it('skips chapters missing from the translation (sparse chapter list)', async () => {
        const pane = await makePane({ book: 'Ps', chapter: 3 });
        await pane.nextChapter();
        expect(pane.chapter).toBe(5);
        await pane.prevChapter();
        expect(pane.chapter).toBe(3);
    });

    it('recovers when the current chapter is not in the list at all', async () => {
        const pane = await makePane({ book: 'Ps', chapter: 3 });
        pane.chapter = 4; // e.g. arrived via a stale deep link
        await pane.prevChapter();
        expect(pane.chapter).toBe(3);
        pane.chapter = 4;
        await pane.nextChapter();
        expect(pane.chapter).toBe(5);
    });

    it('fires before/after hooks around a navigation, in order', async () => {
        const pane = await makePane({ book: 'Gen', chapter: 1 });
        const events = trackHooks(pane);
        await pane.nextChapter();
        expect(events).toEqual(['before:Gen.1', 'after:Gen.2']);
    });

    it('jumpTo fires no hooks and reloads navigation across books', async () => {
        const pane = await makePane({ book: 'Gen', chapter: 1 });
        const events = trackHooks(pane);
        await pane.jumpTo('Exod', 2);
        expect([pane.book, pane.chapter]).toEqual(['Exod', 2]);
        expect(pane.availableChapters).toEqual([1, 2]);
        expect(events).toEqual([]);
    });
});

describe('PaneState empty-chapter fallback', () => {
    it('falls forward to the next non-empty chapter', async () => {
        db.getChapter.mockImplementation(async (t: string, b: string, c: number) =>
            c === 3 ? [verse(t, b, c)] : []);
        const pane = await makePane({ book: 'Gen', chapter: 1 });
        expect(pane.chapter).toBe(3);
        expect(pane.verses[0]?.osisId).toBe('Gen.3.1');
    });

    it('falls backward when nothing later has verses', async () => {
        db.getChapter.mockImplementation(async (t: string, b: string, c: number) =>
            c === 1 ? [verse(t, b, c)] : []);
        const pane = await makePane({ book: 'Gen', chapter: 3 });
        expect(pane.chapter).toBe(1);
    });
});

describe('PaneState switchTranslation', () => {
    it('same id is a no-op', async () => {
        const pane = await makePane({ book: 'Gen', chapter: 2 });
        const events = trackHooks(pane);
        await pane.switchTranslation('KJV');
        expect(events).toEqual([]);
    });

    it('falls back to the first available book when the canon lacks the current one', async () => {
        const pane = await makePane({ book: 'Gen', chapter: 2 });
        await pane.switchTranslation('OEB');
        expect([pane.translation, pane.book, pane.chapter]).toEqual(['OEB', 'Exod', 1]);
        expect(pane.verses[0]?.id).toBe('OEB:Exod.1.1');
        expect(pane.availableChapters).toEqual([1, 2]);
    });

    it('falls back to the first available chapter when the book keeps fewer chapters', async () => {
        const pane = await makePane({ book: 'Gen', chapter: 1 });
        await pane.switchTranslation('ASV'); // ASV Gen starts at chapter 2
        expect([pane.translation, pane.book, pane.chapter]).toEqual(['ASV', 'Gen', 2]);
    });
});

describe('PaneState load-generation race guard', () => {
    it('a slower older load must not overwrite a newer one', async () => {
        const pane = await makePane({ book: 'Gen', chapter: 1 });
        const slow = deferred<VerseRecord[]>();
        const fast = deferred<VerseRecord[]>();
        db.getChapter.mockImplementationOnce(() => slow.promise).mockImplementationOnce(() => fast.promise);

        const nav2 = pane.navigateToChapter(2);
        const nav3 = pane.navigateToChapter(3);

        fast.resolve([verse('KJV', 'Gen', 3)]);
        await nav3;
        slow.resolve([verse('KJV', 'Gen', 2)]); // stale response arrives late
        await nav2;

        expect(pane.chapter).toBe(3);
        expect(pane.verses[0]?.osisId).toBe('Gen.3.1');
        expect(pane.loading).toBe(false);
    });
});

describe('PaneState annotation subscription', () => {
    it('subscribes once per book, not per chapter', async () => {
        const pane = await makePane({ book: 'Gen', chapter: 1 });
        await pane.navigateToChapter(2);
        await pane.navigateToChapter(3);
        expect(db.observeAnnotationsForBook).toHaveBeenCalledTimes(1);
        await pane.navigateToBook('Exod');
        expect(db.observeAnnotationsForBook).toHaveBeenCalledTimes(2);
        expect(unsubscribe).toHaveBeenCalledTimes(1); // old book's sub torn down
    });

    it('dispose tears the subscription down', async () => {
        const pane = await makePane();
        unsubscribe.mockClear();
        pane.dispose();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
});

describe('restoreSplitLayout migration matrix', () => {
    const loc = (book: string): PaneLocation => ({ book, chapter: 1, translation: 'KJV' });

    it('returns defaults when nothing is persisted anywhere', async () => {
        expect(await restoreSplitLayout()).toEqual({
            extraLocations: [], weights: [], syncScroll: false, scrolls: [],
            showRefs: true, showDivergence: true, mapOpen: false,
        });
    });

    it('reads a full modern payload, excluding pane 0 from extraLocations', async () => {
        db.getKv.mockResolvedValue({
            count: 3,
            locations: [loc('Gen'), loc('Exod'), loc('Ps')],
            weights: [1, 2, 1], syncScroll: true, scrolls: [0, 0.5, 1],
            showRefs: false, showDivergence: false, mapOpen: true,
        });
        const r = await restoreSplitLayout();
        expect(r.extraLocations.map((l) => l.book)).toEqual(['Exod', 'Ps']);
        expect(r.weights).toEqual([1, 2, 1]);
        expect(r.syncScroll).toBe(true);
        expect(r.scrolls).toEqual([0, 0.5, 1]);
        expect(r.showRefs).toBe(false);
        expect(r.showDivergence).toBe(false);
        expect(r.mapOpen).toBe(true);
    });

    it('caps restored panes at 3 even if the payload claims more', async () => {
        db.getKv.mockResolvedValue({
            count: 5,
            locations: [loc('Gen'), loc('Exod'), loc('Ps'), loc('Isa'), loc('Mal')],
        });
        const r = await restoreSplitLayout();
        expect(r.extraLocations.map((l) => l.book)).toEqual(['Exod', 'Ps']);
    });

    it('fills defaults for pre-split-completion payloads (no weights/toggles)', async () => {
        db.getKv.mockResolvedValue({ count: 2, locations: [loc('Gen'), loc('Exod')] });
        const r = await restoreSplitLayout();
        expect(r.extraLocations.map((l) => l.book)).toEqual(['Exod']);
        expect(r.weights).toEqual([]);
        expect(r.syncScroll).toBe(false);
        expect(r.showRefs).toBe(true);
        expect(r.showDivergence).toBe(true);
        expect(r.mapOpen).toBe(false);
    });

    it('migrates the pre-v18 localStorage payload into kv exactly once', async () => {
        const legacy = { count: 2, locations: [loc('Gen'), loc('Ps')] };
        backing.set('codex:splitPanes', JSON.stringify(legacy));
        const r = await restoreSplitLayout();
        expect(r.extraLocations.map((l) => l.book)).toEqual(['Ps']);
        expect(db.setKv).toHaveBeenCalledWith('splitPanes', legacy);
        expect(backing.has('codex:splitPanes')).toBe(false);
    });

    it('kv wins over a lingering legacy payload', async () => {
        db.getKv.mockResolvedValue({ count: 1, locations: [loc('Gen')] });
        backing.set('codex:splitPanes', JSON.stringify({ count: 2, locations: [loc('Gen'), loc('Ps')] }));
        const r = await restoreSplitLayout();
        expect(r.extraLocations).toEqual([]);
        expect(backing.has('codex:splitPanes')).toBe(true); // untouched
    });

    it('a corrupt legacy payload degrades to defaults instead of throwing', async () => {
        backing.set('codex:splitPanes', '{not json');
        expect((await restoreSplitLayout()).extraLocations).toEqual([]);
    });

    it('a rejecting kv read degrades to defaults instead of throwing', async () => {
        db.getKv.mockRejectedValue(new Error('quota'));
        expect((await restoreSplitLayout()).extraLocations).toEqual([]);
    });

    it('persistSplitPanes derives count and swallows write failures', async () => {
        db.setKv.mockRejectedValue(new Error('quota'));
        persistSplitPanes({
            locations: [loc('Gen'), loc('Exod')], weights: [1, 1], syncScroll: false,
            scrolls: [0, 0], showRefs: true, showDivergence: true, mapOpen: false,
        });
        expect(db.setKv).toHaveBeenCalledWith('splitPanes', expect.objectContaining({ count: 2 }));
        await Promise.resolve(); // the rejection must be handled, not unhandled
    });
});

describe('split toggles (Settings surface)', () => {
    const loc = (book: string): PaneLocation => ({ book, chapter: 1, translation: 'KJV' });

    it('getSplitToggles returns just the three toggles, with defaults', async () => {
        expect(await getSplitToggles()).toEqual({ syncScroll: false, showRefs: true, showDivergence: true });
    });

    it('updateSplitToggles merges into an existing payload without touching layout', async () => {
        const existing = {
            count: 2, locations: [loc('Gen'), loc('Exod')],
            weights: [1, 2], syncScroll: false, scrolls: [0, 0.5],
            showRefs: true, showDivergence: true, mapOpen: true,
        };
        db.getKv.mockResolvedValue(existing);
        await updateSplitToggles({ showRefs: false });
        expect(db.setKv).toHaveBeenCalledWith('splitPanes', { ...existing, showRefs: false });
    });

    it('updateSplitToggles writes a locations-free stub when nothing is persisted yet', async () => {
        await updateSplitToggles({ syncScroll: true });
        expect(db.setKv).toHaveBeenCalledWith('splitPanes', { count: 1, locations: [], syncScroll: true });
    });

    it('a stub payload restores as an empty layout with the saved toggle', async () => {
        db.getKv.mockResolvedValue({ count: 1, locations: [], syncScroll: true });
        const r = await restoreSplitLayout();
        expect(r.extraLocations).toEqual([]);
        expect(r.syncScroll).toBe(true);
    });

    it('updateSplitToggles swallows read and write failures', async () => {
        db.getKv.mockRejectedValue(new Error('quota'));
        await expect(updateSplitToggles({ showDivergence: false })).resolves.toBeUndefined();
        db.getKv.mockResolvedValue(undefined);
        db.setKv.mockRejectedValue(new Error('quota'));
        await expect(updateSplitToggles({ showDivergence: false })).resolves.toBeUndefined();
    });
});
