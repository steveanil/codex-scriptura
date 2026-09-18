// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import Skeleton from './Skeleton.svelte';
import EmptyState from './EmptyState.svelte';
import InlineError from './InlineError.svelte';

afterEach(cleanup);

describe('Skeleton', () => {
    it('announces what is loading and draws the requested number of lines', () => {
        const { getByRole, container } = render(Skeleton, { lines: 4, label: 'Loading cross-references' });
        const status = getByRole('status');
        expect(status.getAttribute('aria-busy')).toBe('true');
        expect(status.textContent).toContain('Loading cross-references');
        expect(container.querySelectorAll('.line')).toHaveLength(4);
        expect(container.querySelectorAll('.bar.short')).toHaveLength(1);
    });

    it('renders rows with a leading dot and a card as one block', () => {
        const rows = render(Skeleton, { variant: 'row', lines: 2 });
        expect(rows.container.querySelectorAll('.dot')).toHaveLength(2);
        cleanup();
        const card = render(Skeleton, { variant: 'card' });
        expect(card.container.querySelectorAll('.bone.card')).toHaveLength(1);
        expect(card.container.querySelectorAll('.line')).toHaveLength(0);
    });
});

describe('EmptyState', () => {
    it('shows one sentence and no action by default', () => {
        const { getByRole, queryByRole } = render(EmptyState, { message: 'Nothing is tagged with this theme yet.' });
        expect(getByRole('status').textContent).toContain('Nothing is tagged');
        expect(queryByRole('button')).toBeNull();
        expect(queryByRole('link')).toBeNull();
    });

    it('offers at most one action, as a button or a link', async () => {
        const onclick = vi.fn();
        const { getByRole } = render(EmptyState, { message: 'No highlights yet.', action: { label: 'Open the reader', onclick } });
        await fireEvent.click(getByRole('button', { name: 'Open the reader' }));
        expect(onclick).toHaveBeenCalledTimes(1);
        cleanup();
        const linked = render(EmptyState, { message: 'No translations installed.', action: { label: 'Open Library', href: '/settings#library' } });
        expect(linked.getByRole('link', { name: 'Open Library' }).getAttribute('href')).toBe('/settings#library');
    });
});

describe('InlineError', () => {
    it('states the cause and retries on demand', async () => {
        const onRetry = vi.fn();
        const { getByRole, getByText } = render(InlineError, { message: 'The cross-references could not be loaded.', detail: 'part2.json missing', onRetry });
        expect(getByRole('alert').textContent).toContain('could not be loaded');
        expect(getByText('part2.json missing')).toBeTruthy();
        await fireEvent.click(getByRole('button', { name: 'Retry' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('shows a retrying state and no button without a handler', () => {
        const retrying = render(InlineError, { message: 'x', onRetry: () => {}, retrying: true });
        expect(retrying.getByRole('button').textContent).toContain('Retrying');
        expect(retrying.getByRole('button').hasAttribute('disabled')).toBe(true);
        cleanup();
        const bare = render(InlineError, { message: 'x' });
        expect(bare.queryByRole('button')).toBeNull();
    });
});
