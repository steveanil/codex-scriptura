// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import StudyRail from './StudyRail.svelte';
import { StudyRailState, type RailTab } from '$lib/stores/studyRail.svelte';

afterEach(cleanup);

const content = createRawSnippet((tab: () => RailTab) => ({
    render: () => `<div data-testid="panel">${tab().id}</div>`,
}));

function mount(rail: StudyRailState, extra: Record<string, unknown> = {}) {
    return render(StudyRail, {
        rail,
        width: 360,
        onResize: vi.fn(),
        entityCount: 3,
        onOpenEntities: vi.fn(),
        onOpenAnnotations: vi.fn(),
        content,
        ...extra,
    });
}

describe('StudyRail', () => {
    it('shows the documented empty state and offers Who\'s here and Annotations', async () => {
        const rail = new StudyRailState();
        rail.toggle();
        const onOpenEntities = vi.fn();
        const onOpenAnnotations = vi.fn();
        const { getByText, getByRole } = mount(rail, { onOpenEntities, onOpenAnnotations });
        expect(getByText(/Nothing open yet/)).toBeTruthy();
        expect(getByText('Word lookup')).toBeTruthy();
        expect(getByText('Lineage')).toBeTruthy();
        await fireEvent.click(getByRole('button', { name: /Who's here/ }));
        expect(onOpenEntities).toHaveBeenCalled();
        await fireEvent.click(getByRole('button', { name: /Annotations/ }));
        expect(onOpenAnnotations).toHaveBeenCalled();
    });

    it('disables Who\'s here when the chapter has no entities', () => {
        const rail = new StudyRailState();
        rail.toggle();
        const { getByRole } = mount(rail, { entityCount: 0 });
        expect((getByRole('button', { name: /Who's here/ }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('renders the active tab in the header with its qualifier and no strip for one tab', () => {
        const rail = new StudyRailState();
        rail.show({ id: 'entity:x', kind: 'entity', title: 'Abraham', qualifier: 'Person' });
        const { getByRole, queryByRole, getByText, getByTestId } = mount(rail);
        expect(getByRole('heading', { name: 'Abraham' })).toBeTruthy();
        expect(getByText('Person')).toBeTruthy();
        expect(queryByRole('tablist')).toBeNull();
        expect(getByTestId('panel').textContent).toBe('entity:x');
    });

    it('shows a tab strip with badges once two panels are resident and switches on click', async () => {
        const rail = new StudyRailState();
        rail.show({ id: 'entities', kind: 'entities', title: "Who's here", badge: 7 });
        rail.show({ id: 'lineage', kind: 'lineage', title: 'Lineage' });
        const { getAllByRole, getByText, getByTestId } = mount(rail);
        const tabs = getAllByRole('tab');
        expect(tabs).toHaveLength(2);
        expect(getByText('7')).toBeTruthy();
        expect(tabs[1].getAttribute('aria-selected')).toBe('true');
        await fireEvent.click(tabs[0]);
        expect(rail.activeId).toBe('entities');
        expect(getByTestId('panel').textContent).toBe('entities');
    });

    it('the header close button closes the active tab; the menu closes all', async () => {
        const rail = new StudyRailState();
        rail.show({ id: 'a', kind: 'lookup', title: 'grace' });
        rail.show({ id: 'b', kind: 'lookup', title: 'mercy' });
        const { getByRole } = mount(rail);
        await fireEvent.click(getByRole('button', { name: 'Close mercy' }));
        expect(rail.tabs.map((t) => t.id)).toEqual(['a']);
        expect(rail.activeId).toBe('a');
        await fireEvent.click(getByRole('button', { name: 'Rail options' }));
        await fireEvent.click(getByRole('menuitem', { name: 'Close all tabs' }));
        expect(rail.tabs).toEqual([]);
        expect(rail.open).toBe(false);
    });
});
