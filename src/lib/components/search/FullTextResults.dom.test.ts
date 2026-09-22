// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';

const manager = vi.hoisted(() => ({
    getOrBuildIndex: vi.fn<(id: string) => Promise<unknown>>(),
    releaseIndex: vi.fn(),
}));
const engine = vi.hoisted(() => ({
    searchFullText: vi.fn<(indexes: unknown[], query: string, opts: unknown) => Promise<unknown[]>>(async () => []),
}));
vi.mock('$lib/search/index-manager', () => manager);
vi.mock('$lib/search/fulltext', () => engine);

import FullTextResults from './FullTextResults.svelte';
import { SearchIndexSet } from '$lib/search/index-set.svelte';

beforeEach(() => {
    manager.getOrBuildIndex.mockReset();
    manager.releaseIndex.mockReset();
    engine.searchFullText.mockClear();
});
afterEach(cleanup);

describe('FullTextResults triggers (issue #364)', () => {
    it('runs on mount, again when an index becomes ready, and again when seq is bumped', async () => {
        let resolveIndex!: (v: unknown) => void;
        manager.getOrBuildIndex.mockReturnValue(new Promise((r) => { resolveIndex = r; }));
        const indexes = new SearchIndexSet();
        indexes.sync(['KJV']);

        const { rerender } = render(FullTextResults, {
            props: { query: 'grace', testament: 'all', translations: ['KJV'], indexes, seq: 1 },
        });

        // Mounted with a query: searches at once, over the (still empty) ready set
        await waitFor(() => expect(engine.searchFullText).toHaveBeenCalledTimes(1));
        expect(engine.searchFullText.mock.calls[0][0]).toEqual([]);

        // The index lands: the same query re-runs so its verses join the list
        resolveIndex('kjv-index');
        await waitFor(() => expect(engine.searchFullText).toHaveBeenCalledTimes(2));
        expect(engine.searchFullText.mock.calls[1][0]).toEqual(['kjv-index']);

        // The shell asks for a run (debounce fired, filter changed)
        await rerender({ query: 'grace', testament: 'all', translations: ['KJV'], indexes, seq: 2 });
        await waitFor(() => expect(engine.searchFullText).toHaveBeenCalledTimes(3));
    });

    it('does not search an empty query and shows the hint', async () => {
        manager.getOrBuildIndex.mockResolvedValue('kjv-index');
        const indexes = new SearchIndexSet();
        indexes.sync(['KJV']);

        const { container } = render(FullTextResults, {
            props: { query: '', testament: 'all', translations: ['KJV'], indexes, seq: 1 },
        });
        await waitFor(() => expect(container.querySelector('.search-hint')).not.toBeNull());
        expect(engine.searchFullText).not.toHaveBeenCalled();
    });
});
