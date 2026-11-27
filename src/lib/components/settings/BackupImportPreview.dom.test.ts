// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { Annotation, UserPreferences } from '@codex-scriptura/core';
import BackupImportPreview from './BackupImportPreview.svelte';
import { buildBackup, type LocalState } from '$lib/utils/backup-format';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const note = (id: string, verse: number, data: string, modified: number): Annotation =>
    ({ id, type: 'note', book: 'Gen', verseStart: `Gen.1.${verse}`, verseEnd: `Gen.1.${verse}`, data, tags: [], created: 1, modified, synced: false });

// 120 notes the backup holds a newer copy of, one it holds an older copy of, one new, one only here
const shared = Array.from({ length: 120 }, (_, i) => i + 1);
const backup = buildBackup({
    app: '2026-11-21',
    settings: { id: 'default' } as UserPreferences,
    annotations: [...shared.map((i) => note(`n${i}`, i, `backup text ${i}`, 10)), note('old', 1, 'backup old', 1), note('new', 2, 'brand new', 5)],
    tags: [],
    savedSearches: [],
}, 0);
const local: LocalState = {
    annotations: [...shared.map((i) => note(`n${i}`, i, `local text ${i}`, 5)), note('old', 1, 'edited here', 9), note('mine', 3, 'only here', 1)],
    tags: [],
    savedSearches: [],
};
const props = () => ({ name: 'backup.json', backup, local, onMerge: vi.fn(), onReplace: vi.fn(), onCancel: vi.fn() });

describe('BackupImportPreview', () => {
    it('counts what a merge does per type', () => {
        const { getByRole } = render(BackupImportPreview, props());
        const row = getByRole('row', { name: /Annotations/ });
        expect([...row.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['1', '120', '1', '1']);
    });

    it('lists the records merge will overwrite, capped, with the local text they replace', async () => {
        const { getByText, container } = render(BackupImportPreview, props());
        await fireEvent.click(getByText('Show the 120 records merge will overwrite'));
        const items = container.querySelectorAll('details')[0].querySelectorAll('.items li');
        expect(items).toHaveLength(50);
        expect(items[0].textContent).toContain('Gen 1:1 · note');
        expect(items[0].textContent).toContain('“backup text 1”');
        expect(items[0].textContent).toContain('Here now: “local text 1”');
        expect(getByText('and 70 more records')).toBeTruthy();
    });

    it('says what replace removes, and replaces only after the user confirms', async () => {
        const p = props();
        const { getByRole, getByText } = render(BackupImportPreview, p);
        const consequence = 'Replace makes this browser match the backup: it deletes 1 record that only this browser has, puts back the older backup copy of 1 record edited here since and replaces the settings here.';
        expect(getByText(consequence)).toBeTruthy();
        const ask = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
        await fireEvent.click(getByRole('button', { name: 'Replace everything' }));
        expect(ask).toHaveBeenCalledWith(`${consequence} This cannot be undone.`);
        expect(p.onReplace).not.toHaveBeenCalled();
        await fireEvent.click(getByRole('button', { name: 'Replace everything' }));
        expect(p.onReplace).toHaveBeenCalledTimes(1);
        await fireEvent.click(getByRole('button', { name: 'Merge into this browser' }));
        expect(p.onMerge).toHaveBeenCalledTimes(1);
    });
});
