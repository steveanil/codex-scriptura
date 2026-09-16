// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { afterEach } from 'vitest';
import SegmentedControl from './SegmentedControl.svelte';

afterEach(cleanup);

const four = ['One', 'Two', 'Three', 'Four'].map((l) => ({ value: l.toLowerCase(), label: l }));
const five = [...four, { value: 'five', label: 'Five' }];

describe('SegmentedControl', () => {
    it('renders up to four options as a radiogroup with the active segment checked', () => {
        const onchange = vi.fn();
        const { getByRole, getAllByRole } = render(SegmentedControl, { options: four, value: 'two', onchange, label: 'Mode' });
        expect(getByRole('radiogroup', { name: 'Mode' })).toBeTruthy();
        const radios = getAllByRole('radio');
        expect(radios).toHaveLength(4);
        expect(radios[1].getAttribute('aria-checked')).toBe('true');
        expect(radios[1].getAttribute('tabindex')).toBe('0');
        expect(radios[0].getAttribute('tabindex')).toBe('-1');
    });

    it('reports a click and ignores a click on the current value', async () => {
        const onchange = vi.fn();
        const { getAllByRole } = render(SegmentedControl, { options: four, value: 'two', onchange, label: 'Mode' });
        await fireEvent.click(getAllByRole('radio')[3]);
        expect(onchange).toHaveBeenCalledWith('four');
        await fireEvent.click(getAllByRole('radio')[1]);
        expect(onchange).toHaveBeenCalledTimes(1);
    });

    it('moves with arrow keys and wraps', async () => {
        const onchange = vi.fn();
        const { getByRole } = render(SegmentedControl, { options: four, value: 'four', onchange, label: 'Mode' });
        await fireEvent.keyDown(getByRole('radio', { name: 'Four' }), { key: 'ArrowRight' });
        expect(onchange).toHaveBeenLastCalledWith('one');
        await fireEvent.keyDown(getByRole('radio', { name: 'Four' }), { key: 'ArrowLeft' });
        expect(onchange).toHaveBeenLastCalledWith('three');
    });

    it('becomes a labelled dropdown at five options', () => {
        const { queryByRole, getByRole, getByText } = render(SegmentedControl, { options: five, value: 'one', onchange: vi.fn(), label: 'Mode', shortcut: 'Alt+M' });
        expect(queryByRole('radiogroup')).toBeNull();
        const select = getByRole('combobox', { name: /Mode/ }) as HTMLSelectElement;
        expect(select.options).toHaveLength(5);
        expect(getByText('Alt M')).toBeTruthy();
    });

    it('cycles with the page shortcut in both presentations', async () => {
        const onchange = vi.fn();
        render(SegmentedControl, { options: five, value: 'five', onchange, label: 'Mode', shortcut: 'Alt+M' });
        await fireEvent.keyDown(window, { key: 'm', code: 'KeyM', altKey: true });
        expect(onchange).toHaveBeenCalledWith('one');
    });
});
