// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { PaneState } from '$lib/stores/splitPanes.svelte';

const library = vi.hoisted(() => {
    const catalog = [
        { id: 'KJV', abbreviation: 'KJV', name: 'King James Version' },
        { id: 'WEB', abbreviation: 'WEB', name: 'World English Bible' },
        { id: 'OEB', abbreviation: 'OEB', name: 'Open English Bible', coverage: 'NT and some OT books' },
    ];
    const books: Record<string, string[]> = { KJV: ['Gen', 'Ruth'], WEB: ['Gen', 'Ruth'], OEB: ['Matt'] };
    return {
        books,
        translationLibrary: {
            catalog,
            installedCoverage: async () => catalog.map((t) => ({ ...t, books: books[t.id] })),
        },
        requestPaneTranslation: vi.fn(),
    };
});
vi.mock('$lib/stores/translationLibrary.svelte', () => library);
vi.mock('$lib/stores/preferences.svelte', () => ({ preferences: { value: { activeTranslation: 'WEB' } } }));

import ReaderEmptyState from './ReaderEmptyState.svelte';

afterEach(() => {
    cleanup();
    library.requestPaneTranslation.mockClear();
});

const paneAt = (translation: string, availableBooks: string[]) =>
    ({ book: 'Ruth', chapter: 2, translation, availableBooks }) as unknown as PaneState;

describe('ReaderEmptyState', () => {
    it('names a coverage gap and offers the installed translations that have the book, preference first', async () => {
        const pane = paneAt('OEB', ['Matt']);
        render(ReaderEmptyState, { pane });
        expect(screen.getByRole('status').textContent).toContain('OEB does not include Ruth');
        expect(screen.getByText(/Open English Bible is a partial translation \(NT and some OT books\)/)).toBeTruthy();
        await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2));
        const labels = screen.getAllByRole('button').map((b) => b.textContent?.trim());
        expect(labels).toEqual(['Open in WEB', 'Open in KJV']);

        await fireEvent.click(screen.getByRole('button', { name: 'Open in KJV' }));
        expect(library.requestPaneTranslation).toHaveBeenCalledWith(pane, 'KJV');
    });

    it('sends the reader to Settings when no installed translation has the book', async () => {
        library.books.KJV = ['Gen'];
        library.books.WEB = ['Gen'];
        try {
            render(ReaderEmptyState, { pane: paneAt('OEB', ['Matt']) });
            await waitFor(() => expect(screen.getByText('No installed translation has Ruth.')).toBeTruthy());
            expect(screen.getByRole('link', { name: 'Download one in Settings' }).getAttribute('href')).toBe('/settings#library');
            expect(screen.queryByRole('button')).toBeNull();
        } finally {
            library.books.KJV = ['Gen', 'Ruth'];
            library.books.WEB = ['Gen', 'Ruth'];
        }
    });

    it('says the translation has no text when its book list is empty', () => {
        render(ReaderEmptyState, { pane: paneAt('KJV', []) });
        expect(screen.getByRole('status').textContent).toContain('KJV has no text on this device');
        expect(screen.getByRole('link', { name: 'Re-download KJV in Settings' })).toBeTruthy();
    });

    it('calls a missing chapter in a covered book damaged data', () => {
        render(ReaderEmptyState, { pane: paneAt('KJV', ['Gen', 'Ruth']) });
        expect(screen.getByRole('status').textContent).toContain('Ruth 2 has no verses in KJV on this device');
        expect(screen.getByText("KJV includes Ruth, so this chapter's data is damaged or incomplete.")).toBeTruthy();
    });
});
