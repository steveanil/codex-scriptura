// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import type { Annotation } from '@codex-scriptura/core';

const db = vi.hoisted(() => ({
    getTags: vi.fn(),
    saveTag: vi.fn(),
    getLastVerses: vi.fn(),
}));
vi.mock('@codex-scriptura/db', async (orig) => ({
    normalizeTagName: (await orig<typeof import('@codex-scriptura/db')>()).normalizeTagName,
    ...db,
}));

import NoteEditor from './NoteEditor.svelte';
import AnnotationEditor from './AnnotationEditor.svelte';

const swatches = [
    { id: 'y', name: 'Yellow', value: 'rgba(250, 204, 21, 0.4)' },
    { id: 'b', name: 'Blue', value: 'rgba(96, 165, 250, 0.4)' },
];

function note(over: Partial<Annotation> = {}): Annotation {
    return {
        id: 'n1', type: 'note', book: 'Gen', verseStart: 'Gen.1.1', verseEnd: 'Gen.1.2',
        data: 'In the beginning', tags: ['creation'], created: 1, modified: 2, synced: false, ...over,
    };
}
function highlight(over: Partial<Annotation> = {}): Annotation {
    return {
        id: 'h1', type: 'highlight', book: 'Gen', verseStart: 'Gen.1.3', verseEnd: 'Gen.1.3', data: '',
        color: swatches[0].value, translation: 'ASV', tags: [], created: 1, modified: 2, synced: false, ...over,
    };
}

beforeEach(() => {
    db.getTags.mockResolvedValue([{ id: 't1', name: 'grace', color: '#000' }, { id: 't2', name: 'creation', color: '#000' }]);
    db.saveTag.mockResolvedValue(undefined);
    db.getLastVerses.mockResolvedValue({ 1: 31, 2: 25 });
});
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('NoteEditor (create)', () => {
    it('submits on the button and on Ctrl+Enter, and shows the returned error', async () => {
        const onSubmit = vi.fn().mockResolvedValueOnce('Write something or add a tag.').mockResolvedValue(null);
        const { getByRole, getByLabelText, findByRole, queryByRole } = render(NoteEditor, { onSubmit });
        await fireEvent.click(getByRole('button', { name: 'Save note' }));
        expect((await findByRole('alert')).textContent).toMatch(/Write something/);

        await fireEvent.keyDown(getByLabelText('Note text'), { key: 'Enter', ctrlKey: true });
        expect(onSubmit).toHaveBeenCalledTimes(2);
        await waitFor(() => expect(queryByRole('alert')).toBeNull());
    });

    it('has no Cancel and ignores Escape without onCancel', async () => {
        const { queryByRole, getByLabelText } = render(NoteEditor, { onSubmit: vi.fn() });
        expect(queryByRole('button', { name: 'Cancel' })).toBeNull();
        await fireEvent.keyDown(getByLabelText('Note text'), { key: 'Escape' });
    });

    it('adds a normalised tag, registers a new one, offers the unused vocabulary, and removes a tag', async () => {
        const { getByLabelText, getByRole, container } = render(NoteEditor, { onSubmit: vi.fn(), tags: ['creation'] });
        await waitFor(() => expect(container.querySelectorAll('datalist option')).toHaveLength(1));
        expect(container.querySelector('datalist option')?.getAttribute('value')).toBe('grace');

        const input = getByLabelText('Add tag') as HTMLInputElement;
        await fireEvent.input(input, { target: { value: '  Light ' } });
        await fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(getByRole('button', { name: 'Remove tag light' })).toBeTruthy());
        expect(db.saveTag).toHaveBeenCalledWith(expect.objectContaining({ name: 'light' }));

        await fireEvent.input(input, { target: { value: 'grace' } });
        await fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(getByRole('button', { name: 'Remove tag grace' })).toBeTruthy());
        expect(db.saveTag).toHaveBeenCalledTimes(1);

        await fireEvent.click(getByRole('button', { name: 'Remove tag creation' }));
        await waitFor(() => expect(container.querySelectorAll('.tag-pill')).toHaveLength(2));
    });
});

describe('AnnotationEditor: notes', () => {
    it('saves an edited body and tags as the same record', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        const { getByLabelText, getByRole } = render(AnnotationEditor, { annotation: note(), swatches, translationId: 'KJV', onSave, onCancel: vi.fn() });
        await fireEvent.input(getByLabelText('Note text'), { target: { value: 'Let there be light' } });
        await fireEvent.click(getByRole('button', { name: 'Remove tag creation' }));
        await fireEvent.click(getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave.mock.calls[0][0]).toMatchObject({ id: 'n1', created: 1, data: 'Let there be light', tags: [] });
    });

    it('changes the range through the pickers', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        const { getByLabelText, getByRole } = render(AnnotationEditor, { annotation: note(), swatches, translationId: 'KJV', onSave, onCancel: vi.fn() });
        await waitFor(() => expect((getByLabelText('End chapter') as HTMLSelectElement).matches(':disabled')).toBe(false));
        expect(db.getLastVerses).toHaveBeenCalledWith('KJV', 'Gen');
        await fireEvent.change(getByLabelText('End chapter'), { target: { value: '2' } });
        await fireEvent.change(getByLabelText('End verse'), { target: { value: '4' } });
        await fireEvent.click(getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave.mock.calls[0][0]).toMatchObject({ id: 'n1', verseStart: 'Gen.1.1', verseEnd: 'Gen.2.4' });
    });

    it('shows the validation message inline for a start after the end and does not save', async () => {
        const onSave = vi.fn();
        const { getByLabelText, getByRole, findByRole } = render(AnnotationEditor, { annotation: note(), swatches, translationId: 'KJV', onSave, onCancel: vi.fn() });
        await waitFor(() => expect((getByLabelText('Start verse') as HTMLSelectElement).matches(':disabled')).toBe(false));
        await fireEvent.change(getByLabelText('Start verse'), { target: { value: '9' } });
        await fireEvent.click(getByRole('button', { name: 'Save' }));
        expect((await findByRole('alert')).textContent).toMatch(/start verse comes after the end/);
        expect(onSave).not.toHaveBeenCalled();
    });

    it('cancels on the button and on Escape, and closes without saving when nothing changed', async () => {
        const onCancel = vi.fn();
        const onSave = vi.fn();
        const { getByLabelText, getByRole } = render(AnnotationEditor, { annotation: note(), swatches, translationId: 'KJV', onSave, onCancel });
        await fireEvent.click(getByRole('button', { name: 'Cancel' }));
        await fireEvent.keyDown(getByLabelText('Note text'), { key: 'Escape' });
        await fireEvent.keyDown(getByLabelText('Note text'), { key: 'Enter', metaKey: true });
        await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(3));
        expect(onSave).not.toHaveBeenCalled();
    });
});

describe('AnnotationEditor: highlights', () => {
    it('recolours from the presets, using the highlight translation for verse numbers', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        const { getByRole, getByLabelText } = render(AnnotationEditor, { annotation: highlight(), swatches, translationId: 'KJV', onSave, onCancel: vi.fn() });
        expect(db.getLastVerses).toHaveBeenCalledWith('ASV', 'Gen');
        expect((getByLabelText('Yellow') as HTMLInputElement).checked).toBe(true);
        expect(() => getByLabelText('Current colour')).toThrow();
        await fireEvent.click(getByLabelText('Blue'));
        await fireEvent.keyDown(getByLabelText('Blue'), { key: 'Enter', ctrlKey: true });
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave.mock.calls[0][0]).toMatchObject({ id: 'h1', color: swatches[1].value, translation: 'ASV' });
        expect(getByRole('group', { name: 'Edit highlight' })).toBeTruthy();
    });

    it('offers the stored colour as Current when no preset matches it', async () => {
        const { getByLabelText } = render(AnnotationEditor, { annotation: highlight({ color: 'rgba(1, 2, 3, 0.4)' }), swatches, translationId: 'KJV', onSave: vi.fn(), onCancel: vi.fn() });
        expect((getByLabelText('Current colour') as HTMLInputElement).checked).toBe(true);
    });

    it('cancels on Escape', async () => {
        const onCancel = vi.fn();
        const { getByLabelText } = render(AnnotationEditor, { annotation: highlight(), swatches, translationId: 'KJV', onSave: vi.fn(), onCancel });
        await fireEvent.keyDown(getByLabelText('Blue'), { key: 'Escape' });
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});
