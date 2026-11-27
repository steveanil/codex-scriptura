// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Annotation, VerseRecord } from '@codex-scriptura/core';

const db = vi.hoisted(() => ({
    getThemes: vi.fn(async () => [{ slug: 'covenant', label: 'Covenant', count: 4 }]),
}));
vi.mock('@codex-scriptura/db', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@codex-scriptura/db')>()),
    ...db,
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import SelectionToolbar from './SelectionToolbar.svelte';
import { PaneState } from '$lib/stores/splitPanes.svelte';

afterEach(cleanup);

const COLORS = [
    { name: 'Yellow', id: 'yellow', value: 'rgba(250, 204, 21, 0.35)' },
    { name: 'Green', id: 'green', value: 'rgba(34, 197, 94, 0.3)' },
];

function setup(selected: number[]) {
    const pane = new PaneState({ book: 'Gen', chapter: 1, translation: 'KJV' });
    pane.verses = [1, 2, 3, 4].map((verse) => ({ osisId: `Gen.1.${verse}`, book: 'Gen', chapter: 1, verse, text: `Verse ${verse}.` }) as VerseRecord);
    pane.selectedVerses = selected;
    const saved: Annotation[] = [];
    const onSaveAnnotation = vi.fn(async (a: Annotation) => { saved.push(a); });
    const onDeleteAnnotations = vi.fn(async () => {});
    const onOpenAnnotationSidebar = vi.fn();
    render(SelectionToolbar, {
        pane,
        highlightColors: COLORS,
        paneAnnotations: [],
        onSaveAnnotation,
        onDeleteAnnotations,
        onOpenAnnotationSidebar,
    });
    return { pane, saved, onSaveAnnotation };
}

const toolbar = () => document.querySelector('.selection-toolbar');

describe('SelectionToolbar', () => {
    it('renders nothing without a selection, and the count with one', async () => {
        const { pane } = setup([]);
        expect(toolbar()).toBeNull();
        pane.selectedVerses = [1, 2, 4];
        await waitFor(() => expect(toolbar()).not.toBeNull());
        expect(screen.getByText('3 verses selected')).toBeTruthy();
        expect(document.querySelector('#scratch-pad-send')).toBeNull();
        expect(document.querySelector('.selection-toolbar .action-btn:last-child')?.textContent?.trim()).toBe('Clear');
    });

    it('saves one highlight per contiguous run through the callback and clears the selection', async () => {
        const { pane, saved } = setup([1, 2, 4]);
        await fireEvent.click(screen.getByRole('button', { name: 'Highlight Green' }));
        await waitFor(() => expect(pane.selectedVerses).toEqual([]));
        expect(saved.map((a) => [a.type, a.verseStart, a.verseEnd, a.color, a.translation])).toEqual([
            ['highlight', 'Gen.1.1', 'Gen.1.2', COLORS[1].value, 'KJV'],
            ['highlight', 'Gen.1.4', 'Gen.1.4', COLORS[1].value, 'KJV'],
        ]);
        await waitFor(() => expect(toolbar()).toBeNull());
    });

    it('Clear empties the selection without saving anything', async () => {
        const { pane, onSaveAnnotation } = setup([2]);
        await fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(pane.selectedVerses).toEqual([]);
        expect(onSaveAnnotation).not.toHaveBeenCalled();
        await waitFor(() => expect(toolbar()).toBeNull());
    });

    it('opens the theme popover with known themes and tags the selection', async () => {
        const { pane, saved } = setup([3]);
        expect(document.querySelector('.theme-popover')).toBeNull();
        await fireEvent.click(screen.getByRole('button', { name: /Theme/ }));
        const input = await waitFor(() => screen.getByPlaceholderText('Theme, e.g. covenant') as HTMLInputElement);
        await waitFor(() => expect(document.querySelector('#theme-suggestions option')?.getAttribute('value')).toBe('Covenant'));
        expect((screen.getByRole('button', { name: 'Tag' }) as HTMLButtonElement).disabled).toBe(true);

        await fireEvent.input(input, { target: { value: 'Covenant' } });
        await fireEvent.click(screen.getByRole('button', { name: 'Tag' }));
        await waitFor(() => expect(saved).toHaveLength(1));
        expect(saved[0]).toMatchObject({ type: 'theme', book: 'Gen', verseStart: 'Gen.1.3', verseEnd: 'Gen.1.3', data: 'Covenant', tags: ['covenant'] });
        expect(pane.selectedVerses).toEqual([]);
        await waitFor(() => expect(document.querySelector('.theme-popover')).toBeNull());
    });
});
