// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { VerseRecord } from '@codex-scriptura/core';

// Pins how the workspace routes "go to this passage" (issue #362): which
// moves record history, which persist settings and the URL, which pane
// moves and which verse flashes. ReaderPane, the sidebar and the preview
// card are stubs that only raise the callbacks; PaneState and navHistory
// are real.

const CANON: Record<string, Record<string, number[]>> = {
    KJV: { Gen: [1, 2, 3], Exod: [1, 2], Ps: [1, 2, 3, 4, 5] },
    WEB: { Gen: [1, 2, 3], Exod: [1, 2], Ps: [1, 2, 3, 4, 5] },
};

const kv = vi.hoisted(() => new Map<string, unknown>());
const db = vi.hoisted(() => ({
    getChapter: vi.fn(),
    getBookList: vi.fn(),
    getChapterList: vi.fn(),
    observeAnnotationsForBook: vi.fn(),
    getEntitiesForChapter: vi.fn(),
    getKv: vi.fn(),
    setKv: vi.fn(),
    saveAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
}));
vi.mock('@codex-scriptura/db', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@codex-scriptura/db')>()),
    ...db,
}));

const routing = vi.hoisted(() => ({
    afterNavigate: undefined as undefined | ((nav: { to: { url: URL } | null }) => Promise<void>),
}));
vi.mock('$app/navigation', () => ({
    goto: vi.fn(),
    afterNavigate: (fn: (nav: { to: { url: URL } | null }) => Promise<void>) => { routing.afterNavigate = fn; },
}));

const prefs = vi.hoisted(() => ({
    value: { activeTranslation: 'KJV', lastBook: 'Gen', lastChapter: 1, reader: {}, highlightPresets: [] } as Record<string, unknown>,
    update: vi.fn(),
}));
vi.mock('$lib/stores/preferences.svelte', () => ({ preferences: prefs }));

const library = vi.hoisted(() => {
    const catalog = [
        { id: 'KJV', abbreviation: 'KJV', name: 'King James Version' },
        { id: 'WEB', abbreviation: 'WEB', name: 'World English Bible' },
    ];
    return {
        translationLibrary: {
            catalog,
            isInstalled: () => true,
            state: () => ({}),
            refresh: async () => {},
            installedCoverage: async () => catalog.map((t) => ({ ...t, books: ['Gen', 'Exod', 'Ps'] })),
        },
        requestPaneTranslation: vi.fn(),
    };
});
vi.mock('$lib/stores/translationLibrary.svelte', () => library);

vi.mock('$lib/components/ReaderPane.svelte', async () => ({ default: (await import('../../../tests/stubs/reader/ReaderPaneStub.svelte')).default }));
vi.mock('$lib/components/AnnotationSidebar.svelte', async () => ({ default: (await import('../../../tests/stubs/reader/AnnotationSidebarStub.svelte')).default }));
vi.mock('$lib/components/VersePreviewCard.svelte', async () => ({ default: (await import('../../../tests/stubs/reader/VersePreviewCardStub.svelte')).default }));
vi.mock('$lib/components/PaneHeader.svelte', async () => ({ default: (await import('../../../tests/stubs/reader/EmptyStub.svelte')).default }));
vi.mock('$lib/components/PassagePicker.svelte', async () => ({ default: (await import('../../../tests/stubs/reader/EmptyStub.svelte')).default }));
vi.mock('$lib/components/ScratchPad.svelte', async () => ({ default: (await import('../../../tests/stubs/reader/EmptyStub.svelte')).default }));

import ReaderWorkspace from './ReaderWorkspace.svelte';
import { navHistory } from '$lib/stores/navHistory.svelte';
import { ui } from '$lib/stores/ui.svelte';
import { stubLog } from '../../../tests/stubs/reader/log';

// bind:clientWidth needs one; jsdom has none.
globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

function verse(t: string, b: string, c: number): VerseRecord {
    return { id: `${t}:${b}.${c}.1`, translationId: t, book: b, chapter: c, verse: 1, osisId: `${b}.${c}.1`, text: 'x' };
}

beforeEach(() => {
    vi.clearAllMocks();
    kv.clear();
    stubLog.flashes = [];
    navHistory.clear();
    ui.annotationSidebarOpen = false;
    window.history.replaceState(null, '', '/read?book=Gen&chapter=1');
    db.getBookList.mockImplementation(async (t: string) => Object.keys(CANON[t] ?? {}));
    db.getChapterList.mockImplementation(async (t: string, b: string) => CANON[t]?.[b] ?? []);
    db.getChapter.mockImplementation(async (t: string, b: string, c: number) =>
        (CANON[t]?.[b] ?? []).includes(c) ? [verse(t, b, c)] : []);
    db.getEntitiesForChapter.mockResolvedValue({ persons: [], places: [], events: [] });
    db.observeAnnotationsForBook.mockImplementation(() => ({
        subscribe: (obs: { next: (a: unknown[]) => void }) => {
            obs.next([]);
            return { unsubscribe: () => {} };
        },
    }));
    db.getKv.mockImplementation(async (k: string) => kv.get(k));
    db.setKv.mockResolvedValue(undefined);
});
afterEach(cleanup);

const panes = () => screen.getAllByTestId('pane');
const locations = () => panes().map((p) => p.dataset.loc);
const visited = () => navHistory.entries.map((e) => `${e.book}.${e.chapter}`);
const splitWrites = () => db.setKv.mock.calls.filter(([k]) => k === 'splitPanes').map(([, v]) => v);

/** Wait until pane 0 has fully loaded Genesis 1 again, hooks and all. */
async function backAtGenesis1() {
    await waitFor(() => expect(db.getChapter).toHaveBeenCalledWith('KJV', 'Gen', 1));
    await waitFor(() => expect(panes()[0].dataset.loading).toBe('false'));
    await new Promise((r) => setTimeout(r, 0));
    expect(locations()).toEqual(['KJV:Gen.1']);
}

/** Mount the workspace and wait for boot (pane 0 and any restored panes) to finish. */
async function boot(expected: string[]) {
    render(ReaderWorkspace);
    await waitFor(() => expect(db.getKv).toHaveBeenCalledWith('splitPanes'));
    await waitFor(() => expect(locations()).toEqual(expected));
    await waitFor(() => expect(panes().map((p) => p.dataset.loading)).toEqual(expected.map(() => 'false')));
    // Boot persists nothing it navigates to; start counting from here.
    db.setKv.mockClear();
    prefs.update.mockClear();
}

describe('ReaderWorkspace navigation (issue #362)', () => {
    it('a cross-reference in pane 0 records both ends, persists settings and the URL, and flashes the verse', async () => {
        await boot(['KJV:Gen.1']);
        await fireEvent.click(within(panes()[0]).getByText('xref'));
        await waitFor(() => expect(stubLog.flashes).toEqual(['KJV:Exod.2:3']));
        expect(locations()).toEqual(['KJV:Exod.2']);
        expect(visited()).toEqual(['Gen.1', 'Exod.2']);
        expect(prefs.update).toHaveBeenCalledTimes(1);
        expect(prefs.update).toHaveBeenCalledWith({ activeTranslation: 'KJV', lastBook: 'Exod', lastChapter: 2 });
        expect(window.location.search).toBe('?book=Exod&chapter=2');
        expect(splitWrites()).toHaveLength(1);
    });

    it('a cross-reference in an extra pane moves that pane and persists only the split layout, byte for byte', async () => {
        kv.set('splitPanes', {
            count: 2,
            locations: [{ book: 'Gen', chapter: 1, translation: 'KJV' }, { book: 'Ps', chapter: 1, translation: 'WEB' }],
        });
        await boot(['KJV:Gen.1', 'WEB:Ps.1']);
        await fireEvent.click(within(panes()[1]).getByText('xref'));
        await waitFor(() => expect(stubLog.flashes).toEqual(['WEB:Exod.2:3']));
        expect(locations()).toEqual(['KJV:Gen.1', 'WEB:Exod.2']);
        expect(visited()).toEqual([]);
        expect(prefs.update).not.toHaveBeenCalled();
        expect(splitWrites().map((v) => JSON.stringify(v))).toEqual([JSON.stringify({
            count: 2,
            locations: [{ book: 'Gen', chapter: 1, translation: 'KJV' }, { book: 'Exod', chapter: 2, translation: 'WEB' }],
            weights: [1, 1],
            syncScroll: false,
            scrolls: [0, 0],
            showRefs: false,
            showDivergence: true,
            mapOpen: false,
            showEntities: false,
        })]);
    });

    it('going back records nothing and persists neither settings nor the URL', async () => {
        await boot(['KJV:Gen.1']);
        await fireEvent.click(within(panes()[0]).getByText('xref'));
        await waitFor(() => expect(visited()).toEqual(['Gen.1', 'Exod.2']));
        prefs.update.mockClear();
        db.setKv.mockClear();
        db.getChapter.mockClear();

        await fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
        await backAtGenesis1();
        expect(visited()).toEqual(['Gen.1', 'Exod.2']);
        expect(prefs.update).not.toHaveBeenCalled();
        expect(splitWrites()).toEqual([]);
        expect(window.location.search).toBe('?book=Exod&chapter=2');
    });

    it('a breadcrumb jump records both ends but persists neither settings nor the URL', async () => {
        await boot(['KJV:Gen.1']);
        await fireEvent.click(within(panes()[0]).getByText('xref'));
        await waitFor(() => expect(visited()).toEqual(['Gen.1', 'Exod.2']));
        prefs.update.mockClear();
        db.setKv.mockClear();
        db.getChapter.mockClear();

        await fireEvent.click(screen.getByRole('button', { name: 'Genesis 1' }));
        await backAtGenesis1();
        expect(prefs.update).not.toHaveBeenCalled();
        expect(splitWrites()).toEqual([]);
        expect(window.location.search).toBe('?book=Exod&chapter=2');
        // Both ends were visited: going back from here lands on Exodus 2
        expect(navHistory.goBack()).toMatchObject({ book: 'Exod', chapter: 2 });
    });

    it('a URL change moves pane 0 without recording or persisting, and flashes the #verse- anchor', async () => {
        await boot(['KJV:Gen.1']);
        await routing.afterNavigate!({ to: { url: new URL('http://localhost/read?book=Ps&chapter=3#verse-7') } });
        expect(locations()).toEqual(['KJV:Ps.3']);
        expect(visited()).toEqual([]);
        expect(prefs.update).not.toHaveBeenCalled();
        expect(splitWrites()).toEqual([]);
        await waitFor(() => expect(stubLog.flashes).toEqual(['KJV:Ps.3:7']));
    });

    it('a sidebar link moves the pane the sidebar is bound to, closes the sidebar and flashes there', async () => {
        kv.set('splitPanes', {
            count: 2,
            locations: [{ book: 'Gen', chapter: 1, translation: 'KJV' }, { book: 'Exod', chapter: 1, translation: 'WEB' }],
        });
        await boot(['KJV:Gen.1', 'WEB:Exod.1']);
        await fireEvent.click(within(panes()[1]).getByText('notes'));
        expect(ui.annotationSidebarOpen).toBe(true);

        await fireEvent.click(screen.getByText('sidebar note'));
        await waitFor(() => expect(stubLog.flashes).toEqual(['WEB:Ps.5:2']));
        expect(locations()).toEqual(['KJV:Gen.1', 'WEB:Ps.5']);
        expect(ui.annotationSidebarOpen).toBe(false);
        expect(visited()).toEqual([]);
        expect(prefs.update).not.toHaveBeenCalled();
    });

    it('a verse-preview link moves pane 0 like a cross-reference and closes the sidebar', async () => {
        await boot(['KJV:Gen.1']);
        ui.annotationSidebarOpen = true;
        await fireEvent.click(screen.getByText('preview link'));
        await waitFor(() => expect(stubLog.flashes).toEqual(['KJV:Exod.1:4']));
        expect(ui.annotationSidebarOpen).toBe(false);
        expect(visited()).toEqual(['Gen.1', 'Exod.1']);
        expect(prefs.update).toHaveBeenCalledWith({ activeTranslation: 'KJV', lastBook: 'Exod', lastChapter: 1 });
    });

    it('"open in split" adds a pane at the passage without moving or recording pane 0', async () => {
        await boot(['KJV:Gen.1']);
        await fireEvent.click(within(panes()[0]).getByText('open in split'));
        await waitFor(() => expect(locations()).toEqual(['KJV:Gen.1', 'KJV:Ps.3']));
        expect(visited()).toEqual([]);
        expect(prefs.update).not.toHaveBeenCalled();
        expect(stubLog.flashes).toEqual([]);
    });
});
