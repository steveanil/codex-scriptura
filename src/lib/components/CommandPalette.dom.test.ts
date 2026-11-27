// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Annotation } from '@codex-scriptura/core';

const prefs = vi.hoisted(() => ({ value: { activeTranslation: 'KJV' } }));
const manager = vi.hoisted(() => ({
    getOrBuildIndex: vi.fn(async () => ({ search: () => [] })),
    releaseIndex: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/stores/preferences.svelte', () => ({ preferences: prefs }));
vi.mock('$lib/search/index-manager', () => manager);
// Just the query chain the note lookup uses
const notes = vi.hoisted(() => ({ rows: [] as Annotation[] }));
const fakeDb = vi.hoisted(() => ({
    verses: { bulkGet: async () => [] },
    annotations: {
        where: () => ({
            equals: (type: string) => ({
                filter: (keep: (a: Annotation) => boolean) => ({
                    limit: (n: number) => ({ toArray: async () => notes.rows.filter((a) => a.type === type && keep(a)).slice(0, n) }),
                }),
            }),
        }),
    },
}));
vi.mock('@codex-scriptura/db', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@codex-scriptura/db')>()),
    db: fakeDb,
}));

import CommandPalette from './CommandPalette.svelte';

beforeEach(() => {
    prefs.value.activeTranslation = 'KJV';
    manager.getOrBuildIndex.mockClear();
    manager.releaseIndex.mockClear();
});
afterEach(cleanup);

const toggle = () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

describe('CommandPalette index ownership (issue #164)', () => {
    it('releases the previous translation\'s index when the active translation changes', async () => {
        render(CommandPalette);

        await toggle(); // open on KJV
        await waitFor(() => expect(manager.getOrBuildIndex).toHaveBeenCalledWith('KJV'));
        await toggle(); // close

        prefs.value.activeTranslation = 'WEB';
        await toggle();
        await waitFor(() => expect(manager.getOrBuildIndex).toHaveBeenCalledWith('WEB'));

        expect(manager.releaseIndex).toHaveBeenCalledTimes(1);
        expect(manager.releaseIndex).toHaveBeenCalledWith('KJV');
    });

    it('releases nothing when it reopens on the same translation', async () => {
        render(CommandPalette);

        await toggle();
        await waitFor(() => expect(manager.getOrBuildIndex).toHaveBeenCalledTimes(1));
        await toggle();
        await toggle();
        await waitFor(() => expect(manager.getOrBuildIndex).toHaveBeenCalledTimes(2));

        expect(manager.releaseIndex).not.toHaveBeenCalled();
    });
});

describe('CommandPalette note search (issue #47)', () => {
    const note = (id: string, verseStart: string, data: string, tags: string[] = []): Annotation => ({
        id, type: 'note', book: verseStart.split('.')[0], verseStart, verseEnd: verseStart, data, tags, created: 1, modified: 1, synced: false,
    });

    it('uses the Annotations search matcher: tag names, every word, at most three', async () => {
        notes.rows = [
            note('1', 'John.3.16', 'loved the world', ['Gospel']),
            note('2', 'Rom.5.8', 'loved us first'),
            note('3', 'Gen.1.1', 'in the beginning', ['gospel']),
            note('4', 'Eph.2.8', 'grace, gospel'),
            note('5', 'Ps.23.1', 'the gospel shepherd'),
        ];
        render(CommandPalette);
        await toggle();
        const input = await screen.findByPlaceholderText(/Search verses, books, or notes/);

        await fireEvent.input(input, { target: { value: 'gospel' } });
        await waitFor(() => expect(document.querySelectorAll('.note-icon')).toHaveLength(3));

        await fireEvent.input(input, { target: { value: 'loved world' } });
        await waitFor(() => expect(document.querySelectorAll('.note-icon')).toHaveLength(1));
        expect(screen.getByText('loved the world')).toBeTruthy();
    });
});
