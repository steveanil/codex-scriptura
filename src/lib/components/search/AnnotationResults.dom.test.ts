// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Annotation } from '@codex-scriptura/core';
import { translationDatasetId } from '@codex-scriptura/core';

// The live query, driven by hand: each test pushes the table's contents
const live = vi.hoisted(() => ({
    listeners: new Set<(list: Annotation[]) => void>(),
    emit(list: Annotation[]) { for (const l of live.listeners) l(list); },
}));
vi.mock('@codex-scriptura/db', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@codex-scriptura/db')>()),
    observeAllAnnotations: () => ({
        subscribe: ({ next }: { next: (list: Annotation[]) => void }) => {
            live.listeners.add(next);
            return { unsubscribe: () => live.listeners.delete(next) };
        },
    }),
}));
vi.mock('$lib/stores/preferences.svelte', () => ({ preferences: { value: { activeTranslation: 'KJV' } } }));

import { db } from '@codex-scriptura/db';
import AnnotationResults from './AnnotationResults.svelte';

const ann = (id: string, type: Annotation['type'], verseStart: string, fields: Partial<Annotation> = {}): Annotation => ({
    id, type, book: verseStart.split('.')[0], verseStart, verseEnd: verseStart,
    data: '', tags: [], created: 1, modified: 1, synced: false, ...fields,
});

const note = ann('n1', 'note', 'John.3.16', { data: 'God loved the world', tags: ['gospel'], modified: 3 });
const highlight = ann('h1', 'highlight', 'Ps.23.1', { color: '#fde047', translation: 'KJV', modified: 2 });
const theme = ann('t1', 'theme', 'Gen.15.18', { data: 'Covenant', tags: ['covenant'], modified: 1 });

beforeAll(async () => {
    await db.verses.put({ id: 'KJV.Ps.23.1', translationId: 'KJV', book: 'Ps', chapter: 23, verse: 1, osisId: 'Ps.23.1', text: 'The LORD is my shepherd; I shall not want.' });
    await db.verses.put({ id: 'KJV.Gen.15.18', translationId: 'KJV', book: 'Gen', chapter: 15, verse: 18, osisId: 'Gen.15.18', text: 'In the same day the LORD made a covenant with Abram' });
    await db.translations.put({ id: 'KJV', name: 'King James Version', abbreviation: 'KJV' } as never);
    await db.datasets.put({ id: translationDatasetId('KJV') } as never);
});
afterEach(() => {
    cleanup();
    live.listeners.clear();
});

const refs = () => [...document.querySelectorAll('.result-card .result-book')].map((el) => el.textContent);

async function mount(query: string, list: Annotation[], seq = 0) {
    const view = render(AnnotationResults, { query, seq, testament: 'all' });
    await waitFor(() => expect(live.listeners.size).toBe(1));
    live.emit(list);
    return view;
}

describe('AnnotationResults (issue #47)', () => {
    it('lists every annotation for an empty query, in Bible order, linking to the verse', async () => {
        await mount('', [note, highlight, theme]);
        await waitFor(() => expect(refs()).toEqual(['Genesis', 'Psalms', 'John']));
        const link = document.querySelector('.result-card') as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe('/read?book=Gen&chapter=15#verse-18');
        expect(screen.getByText('Covenant', { selector: '.tag-chip' })).toBeTruthy();
    });

    it('finds a highlight by the words of its verse and marks them', async () => {
        await mount('shepherd', [note, highlight, theme]);
        await waitFor(() => expect(refs()).toEqual(['Psalms']));
        expect(document.querySelector('.result-text mark')?.textContent).toBe('shepherd');
    });

    it('filters by type with counts and reorders by most recent', async () => {
        await mount('', [note, highlight, theme]);
        await waitFor(() => expect(refs()).toHaveLength(3));
        await fireEvent.click(screen.getByRole('radio', { name: 'Notes 1' }));
        expect(refs()).toEqual(['John']);
        await fireEvent.click(screen.getByRole('radio', { name: 'All 3' }));
        await fireEvent.click(screen.getByRole('radio', { name: 'Recent' }));
        expect(refs()).toEqual(['John', 'Psalms', 'Genesis']);
    });

    // The harness re-notifies every prop on rerender, so it cannot show that
    // a keystroke before the debounced bump leaves the results alone
    it('applies a new query when the shell bumps seq', async () => {
        const view = await mount('', [note, highlight, theme]);
        await waitFor(() => expect(refs()).toHaveLength(3));
        await view.rerender({ query: '#covenant', seq: 1 });
        await waitFor(() => expect(refs()).toEqual(['Genesis']));
        await view.rerender({ query: '#gospel', seq: 2 });
        await waitFor(() => expect(refs()).toEqual(['John']));
    });

    it('follows the database: an edit or delete elsewhere updates the list', async () => {
        await mount('loved', [note, highlight, theme]);
        await waitFor(() => expect(refs()).toEqual(['John']));
        live.emit([{ ...note, data: 'God hated nothing' }, highlight, theme]);
        await waitFor(() => expect(screen.getByText(/No annotations match "loved"/)).toBeTruthy());
        live.emit([highlight, theme, { ...note, id: 'n2', verseStart: 'Rom.5.8', verseEnd: 'Rom.5.8', book: 'Rom', data: 'loved us first' }]);
        await waitFor(() => expect(refs()).toEqual(['Romans']));
    });

    it('pages a long list fifty at a time', async () => {
        const many = Array.from({ length: 60 }, (_, i) => ann(`m${i}`, 'note', `Gen.1.${i + 1}`, { data: `note ${i}` }));
        await mount('', many);
        await waitFor(() => expect(refs()).toHaveLength(50));
        await fireEvent.click(screen.getByRole('button', { name: /Show 10 more · 10 remaining/ }));
        expect(refs()).toHaveLength(60);
        expect(screen.queryByRole('button', { name: /more/ })).toBeNull();
    });

    it('teaches how to annotate when there is nothing at all', async () => {
        await mount('', [ann('b1', 'bookmark', 'Gen.1.1')]);
        await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Select verses in the reader/));
        expect(screen.getByRole('link', { name: 'Open the reader' }).getAttribute('href')).toBe('/read');
        expect(screen.queryByRole('radiogroup')).toBeNull();
    });

    it('says so when annotations exist but none match', async () => {
        await mount('pharaoh', [note, highlight, theme]);
        await waitFor(() => expect(screen.getByText('No annotations match "pharaoh"')).toBeTruthy());
        expect(screen.getByRole('radiogroup', { name: 'Annotation type' })).toBeTruthy();
    });
});
