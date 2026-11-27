// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import type { Annotation } from '@codex-scriptura/core';
import { db, saveTag } from '@codex-scriptura/db';
import TagsSection from './TagsSection.svelte';

let seq = 0;
function ann(over: Partial<Annotation>): Annotation {
    return {
        id: `a${++seq}`, type: 'note', book: 'Gen', verseStart: 'Gen.1.1', verseEnd: 'Gen.1.1',
        data: 'note', tags: [], created: 1, modified: 1, synced: false, ...over,
    };
}

beforeEach(async () => {
    await Promise.all([db.annotations.clear(), db.tags.clear()]);
    await saveTag({ id: 't1', name: 'grace', color: '#3f3f46' });
    await saveTag({ id: 't2', name: 'mercy', color: '#3f3f46' });
    await db.annotations.bulkPut([
        ann({ id: 'n1', tags: ['grace'] }),
        ann({ id: 'n2', tags: ['grace', 'law'] }),
        ann({ id: 'n3', tags: ['mercy'] }),
        ann({ id: 'th1', type: 'theme', data: 'Covenant', tags: ['covenant'] }),
        ann({ id: 'th2', type: 'theme', data: 'Promise', tags: ['promise'], verseStart: 'Gen.12.1', verseEnd: 'Gen.12.1' }),
    ]);
});
afterEach(cleanup);

async function mount() {
    const view = render(TagsSection);
    const tagList = await view.findByRole('list', { name: 'Note tags' });
    const themeList = await view.findByRole('list', { name: 'Theme threads' });
    return { ...view, tagList, themeList };
}

describe('TagsSection (issue #323)', () => {
    it('lists tags with counts and theme threads with links', async () => {
        const { tagList, themeList } = await mount();
        await waitFor(() => expect(within(tagList).getAllByRole('listitem').map((li) => li.textContent?.replace(/\s+/g, ' ').trim()))
            .toEqual(['#grace 2 annotations Rename Delete', '#law 1 annotation Rename Delete', '#mercy 1 annotation Rename Delete']));
        expect(within(themeList).getByRole('link', { name: 'Covenant' }).getAttribute('href')).toBe('/themes?t=covenant');
    });

    it('renames inline: Enter saves, Escape cancels', async () => {
        const { tagList, getByRole, queryByRole } = await mount();
        await fireEvent.click(within(tagList).getByRole('button', { name: 'Rename #law' }));
        const input = getByRole('textbox', { name: 'New name for #law' }) as HTMLInputElement;
        expect(document.activeElement).toBe(input);
        await fireEvent.input(input, { target: { value: 'torah' } });
        await fireEvent.keyDown(input, { key: 'Escape' });
        expect(queryByRole('textbox', { name: 'New name for #law' })).toBeNull();
        expect((await db.annotations.get('n2'))!.tags).toEqual(['grace', 'law']);

        await fireEvent.click(within(tagList).getByRole('button', { name: 'Rename #law' }));
        const again = getByRole('textbox', { name: 'New name for #law' });
        await fireEvent.input(again, { target: { value: ' Torah ' } });
        await fireEvent.keyDown(again, { key: 'Enter' });
        await waitFor(() => expect(within(tagList).getByText('#torah')).toBeTruthy());
        expect((await db.annotations.get('n2'))!.tags).toEqual(['grace', 'torah']);
        // Focus lands on the renamed row once the live list catches up
        await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Rename #torah'));
    });

    it('asks before merging when a rename hits an existing name, stating both counts', async () => {
        const { tagList, getByRole, findByRole } = await mount();
        await fireEvent.click(within(tagList).getByRole('button', { name: 'Rename #grace' }));
        const input = getByRole('textbox', { name: 'New name for #grace' });
        await fireEvent.input(input, { target: { value: 'Mercy' } });
        await fireEvent.keyDown(input, { key: 'Enter' });
        const prompt = await findByRole('alert');
        expect(prompt.textContent?.replace(/\s+/g, ' ')).toMatch(/#mercy already exists on 1 annotation\. Merge #grace \(2 annotations\) into it\?/);
        expect((await db.annotations.get('n1'))!.tags).toEqual(['grace']);

        await fireEvent.click(within(prompt).getByRole('button', { name: 'Merge' }));
        await waitFor(() => expect(within(tagList).getByText('#mercy').parentElement?.textContent).toContain('3 annotations'));
        expect(within(tagList).queryByText('#grace')).toBeNull();
        expect((await db.annotations.get('n1'))!.tags).toEqual(['mercy']);
    });

    it('deletes only after a two-step confirm that says the annotations stay', async () => {
        const { tagList, findByRole, queryByRole } = await mount();
        await fireEvent.click(within(tagList).getByRole('button', { name: 'Delete #grace' }));
        const prompt = await findByRole('alert');
        expect(prompt.textContent?.replace(/\s+/g, ' ')).toMatch(/Remove #grace from 2 annotations\? The annotations stay/);
        // Focus moves into the prompt onto the safe choice, so Escape reaches it
        expect(document.activeElement).toBe(within(prompt).getByRole('button', { name: 'Cancel' }));
        await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
        expect(queryByRole('alert')).toBeNull();
        expect(await db.tags.count()).toBe(2);

        await fireEvent.click(within(tagList).getByRole('button', { name: 'Delete #grace' }));
        await fireEvent.click(within(await findByRole('alert')).getByRole('button', { name: 'Delete tag' }));
        await waitFor(() => expect(within(tagList).getAllByRole('listitem')).toHaveLength(2));
        expect(within(tagList).queryByText('#grace')).toBeNull();
        expect(await db.annotations.count()).toBe(5);
        expect((await db.annotations.get('n2'))!.tags).toEqual(['law']);
    });

    it('renames a theme thread and offers a merge on a slug collision', async () => {
        const { themeList, getByRole, findByRole } = await mount();
        await fireEvent.click(within(themeList).getByRole('button', { name: 'Rename Covenant' }));
        const input = getByRole('textbox', { name: 'New name for Covenant' });
        await fireEvent.input(input, { target: { value: 'The Covenant' } });
        await fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(within(themeList).getByRole('link', { name: 'The Covenant' }).getAttribute('href')).toBe('/themes?t=the-covenant'));

        await fireEvent.click(within(themeList).getByRole('button', { name: 'Rename Promise' }));
        const next = getByRole('textbox', { name: 'New name for Promise' });
        await fireEvent.input(next, { target: { value: 'the covenant' } });
        await fireEvent.keyDown(next, { key: 'Enter' });
        const prompt = await findByRole('alert');
        expect(prompt.textContent?.replace(/\s+/g, ' ')).toMatch(/The Covenant already exists on 1 passage\. Merge Promise \(1 passage\) into it, named the covenant\?/);
        await fireEvent.click(within(prompt).getByRole('button', { name: 'Merge' }));
        await waitFor(() => expect(within(themeList).getAllByRole('listitem')).toHaveLength(1));
        expect(within(themeList).getByRole('link').textContent).toBe('the covenant');
        expect(within(themeList).getByText('2 passages')).toBeTruthy();
    });

    it('shows how tags and themes get created when there are none', async () => {
        await Promise.all([db.annotations.clear(), db.tags.clear()]);
        const { findByText } = render(TagsSection);
        expect(await findByText(/No tags yet\. Add one here, or while writing a note/)).toBeTruthy();
        expect(await findByText(/No theme threads yet\. Select verses in the reader and choose Theme/)).toBeTruthy();
    });
});
