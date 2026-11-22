// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { Annotation } from '@codex-scriptura/core';

vi.mock('@codex-scriptura/db', async (orig) => ({
    normalizeTagName: (await orig<typeof import('@codex-scriptura/db')>()).normalizeTagName,
    getTags: vi.fn().mockResolvedValue([]),
    saveTag: vi.fn(),
    getLastVerses: vi.fn().mockResolvedValue({ 1: 31 }),
}));

import AnnotationCard from './AnnotationCard.svelte';

afterEach(cleanup);

const base = { id: 'a', book: 'Gen', verseStart: 'Gen.1.1', verseEnd: 'Gen.1.3', created: 1, modified: 1, synced: false };
const note: Annotation = { ...base, type: 'note', data: 'Body', tags: ['grace'] };
const theme: Annotation = { ...base, type: 'theme', data: 'Covenant', tags: ['covenant'] };

function props(annotation: Annotation, extra = {}) {
    return {
        annotation, swatches: [], translationId: 'KJV',
        onNavigate: vi.fn(), onDelete: vi.fn(), onEdit: vi.fn(), onCancelEdit: vi.fn(), onSave: vi.fn(),
        ...extra,
    };
}

describe('AnnotationCard', () => {
    it('offers Edit on a note and reports it', async () => {
        const p = props(note);
        const { getByRole, getByText } = render(AnnotationCard, p);
        expect(getByText('v1–3 ↗')).toBeTruthy();
        await fireEvent.click(getByRole('button', { name: 'Edit note' }));
        expect(p.onEdit).toHaveBeenCalled();
    });

    it('keeps theme cards to jump and delete', () => {
        const { queryByRole, getByRole } = render(AnnotationCard, props(theme));
        expect(queryByRole('button', { name: /Edit/ })).toBeNull();
        expect(getByRole('button', { name: 'Delete theme tag' })).toBeTruthy();
    });

    it('shows the editor in place of the card while editing', () => {
        const { getByLabelText, queryByText } = render(AnnotationCard, props(note, { editing: true }));
        expect((getByLabelText('Note text') as HTMLTextAreaElement).value).toBe('Body');
        expect(queryByText('v1–3 ↗')).toBeNull();
    });

    it('labels a range that crosses chapters with both chapters', () => {
        const { getByText } = render(AnnotationCard, props({ ...note, verseEnd: 'Gen.2.4' }));
        expect(getByText('1:1–2:4 ↗')).toBeTruthy();
    });
});
