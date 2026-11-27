// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { Translation } from '@codex-scriptura/core';
import TranslationSelect from './TranslationSelect.svelte';

afterEach(cleanup);

const KJV = { id: 'KJV', abbreviation: 'KJV', name: 'King James Version' } as Translation;
const OEB = { id: 'OEB', abbreviation: 'OEB', name: 'Open English Bible', coverage: 'NT and some OT books' } as Translation;

describe('TranslationSelect', () => {
    it('labels partial translations and titles the select after the current one', () => {
        render(TranslationSelect, { value: 'OEB', translations: [KJV, OEB], onchange: vi.fn() });
        const select = screen.getByRole('combobox') as HTMLSelectElement;
        expect([...select.options].map((o) => [o.value, o.textContent, o.title])).toEqual([
            ['KJV', 'KJV', 'King James Version'],
            ['OEB', 'OEB (partial)', 'Open English Bible: NT and some OT books (in-progress translation)'],
        ]);
        expect(select.value).toBe('OEB');
        expect(select.title).toBe('Open English Bible: NT and some OT books (in-progress translation)');
        expect(select.className).toContain('translation-picker');
        expect(select.hasAttribute('id')).toBe(false);
        expect(select.hasAttribute('aria-label')).toBe(false);
    });

    it('passes the id and aria-label through', () => {
        render(TranslationSelect, { value: 'KJV', translations: [KJV, OEB], onchange: vi.fn(), id: 'translation-picker', 'aria-label': 'Translation' });
        expect(screen.getByRole('combobox', { name: 'Translation' }).id).toBe('translation-picker');
    });

    it('calls back with the chosen id', async () => {
        const onchange = vi.fn();
        render(TranslationSelect, { value: 'KJV', translations: [KJV, OEB], onchange });
        await fireEvent.change(screen.getByRole('combobox'), { target: { value: 'OEB' } });
        expect(onchange).toHaveBeenCalledWith('OEB');
    });

    it('shows a badge instead of a select with one translation', () => {
        const { container } = render(TranslationSelect, { value: 'KJV', translations: [KJV], onchange: vi.fn() });
        expect(screen.queryByRole('combobox')).toBeNull();
        expect(container.querySelector('.translation-badge')?.textContent).toBe('KJV');
    });
});
