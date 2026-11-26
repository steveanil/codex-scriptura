// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { BibleEvent, Person, Place } from '@codex-scriptura/core';

vi.mock('$lib/stores/translationLibrary.svelte', () => {
    const descriptor = (id: string, type: string, title: string, provenance: Array<[string, string]>) => ({
        id,
        type,
        title,
        provenance: provenance.map(([sourceId, name]) => ({ sourceId, name })),
    });
    return {
        translationLibrary: {
            resources: new Map([
                ['theographic', descriptor('theographic', 'entities', 'Theographic Bible Metadata', [['theographic', 'Theographic Bible Metadata'], ['bibledata', 'BibleData (Kaggle)'], ['openbible-geo', 'OpenBible Geocoding']])],
                ['eastons', descriptor('eastons', 'dictionary', "Easton's Bible Dictionary", [['theographic', 'Theographic Bible Metadata']])],
            ]),
        },
    };
});

import EntityDetailPanel from './EntityDetailPanel.svelte';

afterEach(cleanup);

// jsdom has no layout; the collapse calls scrollIntoView on the toggle.
Element.prototype.scrollIntoView = vi.fn();

const para = (n: number) =>
    `Paragraph ${n} tells how Pilate judged the case at length (Matt. 27:${n}). It goes on for a while so the entry runs long and the collapse has something to hide.`;
const longDescription = [1, 2, 3, 4, 5, 6, 7, 8].map(para).join('\n\n');

const pilate: Person = {
    id: 'pilate_2365',
    name: 'Pontius Pilate',
    verseRefs: ['Matt.27.2', 'Matt.27.13', 'Mark.15.1', 'John.18.29', 'John.19.1', 'Acts.3.13', '1Tim.6.13'],
    gender: 'Male',
    description: longDescription,
    nameMeaning: 'pilate the garrison [commander?]',
    nameMeaningSource: 'bibledata',
    sources: [
        { sourceId: 'theographic', fields: ['id', 'name', 'verseRefs', 'gender', 'description'] },
        { sourceId: 'bibledata', fields: ['nameMeaning', 'nameMeaningSource'] },
    ],
};

function mount(entity: { type: 'person'; data: Person } | { type: 'place'; data: Place } | { type: 'event'; data: BibleEvent }, extra: Record<string, unknown> = {}) {
    const onNavigateToRef = vi.fn();
    const onScrollToVerse = vi.fn();
    const result = render(EntityDetailPanel, {
        entity,
        bookId: 'Matt',
        chapter: 27,
        chapterVerseNums: [2, 13],
        dictEntry: null,
        onScrollToVerse,
        onNavigateToRef,
        ...extra,
    });
    return { ...result, onNavigateToRef, onScrollToVerse };
}

describe('EntityDetailPanel (issue #455)', () => {
    it('collapses a long description and expands it with Read more', async () => {
        const { getByRole, container } = mount({ type: 'person', data: pilate });
        const body = container.querySelector('.description')!;
        expect(body.textContent).toContain('Paragraph 1');
        expect(body.textContent).not.toContain('Paragraph 8');
        // Collapsed text is not rendered, so its references are not in the tab order either
        expect(body.querySelectorAll('button.dict-ref').length).toBeLessThan(8);

        const more = getByRole('button', { name: 'Read more' });
        expect(more.getAttribute('aria-expanded')).toBe('false');
        expect(more.getAttribute('aria-controls')).toBe(body.id);

        await fireEvent.click(more);
        expect(body.textContent).toContain('Paragraph 8');
        expect(body.querySelectorAll('p.dict-sense')).toHaveLength(8);
        const less = getByRole('button', { name: 'Show less' });
        expect(less).toBe(more);
        expect(less.getAttribute('aria-expanded')).toBe('true');

        await fireEvent.click(less);
        expect(body.textContent).not.toContain('Paragraph 8');
        expect(getByRole('button', { name: 'Read more' }).getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(more);
    });

    it('collapses again when a different entity opens', async () => {
        const { getByRole, rerender, container } = mount({ type: 'person', data: pilate });
        await fireEvent.click(getByRole('button', { name: 'Read more' }));
        await rerender({ entity: { type: 'person', data: { ...pilate, id: 'other', description: longDescription } } });
        expect(container.querySelector('.description')!.textContent).not.toContain('Paragraph 8');
        expect(getByRole('button', { name: 'Read more' })).toBeTruthy();
    });

    it('shows the facts with the name meaning source, and credits each part', () => {
        const { container, getByText } = mount({ type: 'person', data: pilate });
        const facts = [...container.querySelectorAll('.facts dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent?.replace(/\s+/g, ' ').trim()]);
        expect(facts).toEqual([
            ['Name meaning', '“Pilate the garrison [commander?]” BibleData (Kaggle)'],
            ['Appears in', '7 verses in 5 books'],
        ]);
        expect(getByText("Description: Easton's Bible Dictionary, via Theographic Bible Metadata")).toBeTruthy();
        expect(getByText('Verses: Theographic Bible Metadata')).toBeTruthy();
    });

    it('renders no empty sections for a person with no description or name meaning', () => {
        const bare: Person = { id: 'p', name: 'Someone', verseRefs: [] };
        const { container, queryByRole } = mount({ type: 'person', data: bare }, { chapterVerseNums: [] });
        const sections = container.querySelectorAll('section');
        expect(sections).toHaveLength(1);
        expect(sections[0].classList.contains('actions')).toBe(true);
        expect(container.querySelector('hr, dl, .description')).toBeNull();
        expect(queryByRole('button', { name: 'Read more' })).toBeNull();
        expect(queryByRole('button', { name: 'View in graph' })).toBeTruthy();
    });

    it('renders a place with coordinates and location certainty', () => {
        const golgotha: Place = {
            id: 'golgotha_487',
            name: 'Golgotha',
            verseRefs: ['Matt.27.33', 'Mark.15.22', 'John.19.17'],
            lat: 31.777444,
            lng: 35.234935,
            confidence: 0.426,
            description: 'The place of a skull (Matt. 27:33).',
            sources: [
                { sourceId: 'theographic', fields: ['id', 'name', 'verseRefs', 'lat', 'lng', 'precision', 'description'] },
                { sourceId: 'openbible-geo', fields: ['confidence'] },
            ],
        };
        const { container, getByText } = mount({ type: 'place', data: golgotha });
        const facts = Object.fromEntries([...container.querySelectorAll('.facts dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent?.trim()]));
        expect(facts).toEqual({ Coordinates: '31.7774, 35.2349', Location: 'Uncertain', 'Appears in': '3 verses in 3 books' });
        expect(getByText('Location certainty: OpenBible Geocoding')).toBeTruthy();
    });

    it('renders an event date and its notes', () => {
        const event: BibleEvent = {
            id: '443',
            name: 'Holy Week',
            date: '0030-03-31',
            verseRefs: ['Mark.11.1', 'Matt.21.1', 'Matt.21.2'],
            description: 'Kislev 25, Mon Dec 17th 29 AD',
            sources: [{ sourceId: 'theographic', fields: ['id', 'name', 'verseRefs', 'date', 'description'] }],
        };
        const { container, getByText } = mount({ type: 'event', data: event });
        const facts = Object.fromEntries([...container.querySelectorAll('.facts dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent?.trim()]));
        expect(facts).toEqual({ Date: 'AD 30', 'Appears in': '3 verses in 2 books' });
        expect(getByText('Notes')).toBeTruthy();
        expect(getByText('Date, verses, description: Theographic Bible Metadata')).toBeTruthy();
    });

    it('navigates to the first reference of a book from its appearance row', async () => {
        const { getByRole, onNavigateToRef } = mount({ type: 'person', data: pilate });
        await fireEvent.click(getByRole('button', { name: /^John, 2 verses/ }));
        expect(onNavigateToRef).toHaveBeenCalledWith('John', 18, 29);
        await fireEvent.click(getByRole('button', { name: /^Matthew, 2 verses/ }));
        expect(onNavigateToRef).toHaveBeenLastCalledWith('Matt', 27, 2);
    });

    it('caps a long book list behind Show all', async () => {
        const many = ['Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1Sam', '2Sam', '1Kgs', '2Kgs'].map((b) => `${b}.1.1`);
        const { container, getByRole } = mount({ type: 'person', data: { id: 'god', name: 'God', verseRefs: many } }, { chapterVerseNums: [] });
        expect(container.querySelectorAll('.book-row')).toHaveLength(8);
        const all = getByRole('button', { name: 'Show all 12 books' });
        expect(all.getAttribute('aria-expanded')).toBe('false');
        await fireEvent.click(all);
        expect(container.querySelectorAll('.book-row')).toHaveLength(12);
        expect(all.getAttribute('aria-expanded')).toBe('true');
    });

    it('keeps references inside the description clickable', async () => {
        const { getByRole, onNavigateToRef } = mount({ type: 'person', data: pilate });
        await fireEvent.click(getByRole('button', { name: 'Matt. 27:1' }));
        expect(onNavigateToRef).toHaveBeenCalledWith('Matt', 27, 1);
    });

    it('scrolls verse pills in this chapter', async () => {
        const { getByRole, onScrollToVerse } = mount({ type: 'person', data: pilate });
        await fireEvent.click(getByRole('button', { name: 'Verse 13' }));
        expect(onScrollToVerse).toHaveBeenCalledWith(13);
    });
});
