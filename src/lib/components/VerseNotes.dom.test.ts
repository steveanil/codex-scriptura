// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { VerseNote } from '@codex-scriptura/core';
import VerseNotes from './VerseNotes.svelte';

afterEach(cleanup);

const notes: VerseNote[] = [
    { at: 4, runs: [{ t: 'moving', s: 'catch' }, ': or, ', { t: 'creeping', s: 'alt' }] },
    { at: 9, kind: 'xref', runs: [{ t: 'Exodus 30:12', ref: 'Exod.30.12' }, '; etc.'] },
    { at: 9, runs: ['<img src=x onerror="alert(1)"> stays text'] },
];

describe('VerseNotes (issue #39)', () => {
    it('lists each note with its letter, catch words emphasised and alternatives in italics', () => {
        const { container } = render(VerseNotes, { notes, active: 0, onNavigate: vi.fn(), onClose: vi.fn() });
        const items = [...container.querySelectorAll('li')];
        expect(items.map((li) => li.textContent)).toEqual([
            'a moving: or, creeping',
            'b See Exodus 30:12; etc.',
            'c <img src=x onerror="alert(1)"> stays text',
        ]);
        expect(items[0].querySelector('strong')?.textContent).toBe('moving');
        expect(items[0].querySelector('em')?.textContent).toBe('creeping');
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('.verse-notes-verse')).toBeNull();
    });

    it('marks the note whose callout was clicked', () => {
        const { container } = render(VerseNotes, { notes, active: 1, onNavigate: vi.fn(), onClose: vi.fn() });
        const items = [...container.querySelectorAll('li')];
        expect(items.map((li) => li.getAttribute('aria-current'))).toEqual([null, 'true', null]);
    });

    it('navigates a passage link by its OSIS id', async () => {
        const onNavigate = vi.fn();
        const { getByRole } = render(VerseNotes, { notes, active: 0, onNavigate, onClose: vi.fn() });
        await fireEvent.click(getByRole('button', { name: 'Exodus 30:12' }));
        expect(onNavigate).toHaveBeenCalledWith('Exod.30.12');
    });

    it('names the omitted verse a carried-over note stands for, in its accessible text', () => {
        const carried: VerseNote[] = [{ at: 20, verse: 21, runs: ['Many authorities insert v. 21.'] }];
        const { container } = render(VerseNotes, { notes: carried, active: 0, onNavigate: vi.fn(), onClose: vi.fn() });
        expect(container.querySelector('.verse-notes-verse')?.textContent).toBe('v. 21');
        expect(container.querySelector('li')?.textContent).toBe('a v. 21 Many authorities insert v. 21.');
        expect([...container.querySelectorAll('li')].filter((li) => li.querySelector('.verse-notes-verse'))).toHaveLength(1);
    });

    it('closes on Escape', async () => {
        const onClose = vi.fn();
        const { getByRole } = render(VerseNotes, { notes, active: 0, onNavigate: vi.fn(), onClose });
        await fireEvent.keyDown(getByRole('button', { name: 'Exodus 30:12' }), { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });
});
