// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import LayersMenu from './LayersMenu.svelte';

afterEach(cleanup);

const layers = [
    { id: 'entities', label: 'Entities', hint: 'Underline people, places and events', checked: false },
    { id: 'redletter', label: 'Red letter', checked: true },
];

describe('LayersMenu', () => {
    it('is a closed menu button showing how many layers are on', () => {
        const { getByRole, queryByRole, getByText } = render(LayersMenu, { layers, ontoggle: vi.fn() });
        const btn = getByRole('button', { name: 'Layers' });
        expect(btn.getAttribute('aria-expanded')).toBe('false');
        expect(queryByRole('menu')).toBeNull();
        expect(getByText('1')).toBeTruthy();
    });

    it('opens to checkbox rows and reports a toggle', async () => {
        const ontoggle = vi.fn();
        const { getByRole, getAllByRole } = render(LayersMenu, { layers, ontoggle });
        await fireEvent.click(getByRole('button', { name: 'Layers' }));
        expect(getByRole('menu')).toBeTruthy();
        const rows = getAllByRole('menuitemcheckbox');
        expect(rows).toHaveLength(2);
        expect(rows[1].getAttribute('aria-checked')).toBe('true');
        await fireEvent.click(rows[0]);
        expect(ontoggle).toHaveBeenCalledWith('entities', true);
        await fireEvent.click(rows[1]);
        expect(ontoggle).toHaveBeenCalledWith('redletter', false);
    });
});
