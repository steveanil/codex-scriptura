// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { db } from '@codex-scriptura/db';
import { datasetStatus } from '$lib/stores/datasetStatus.svelte';
import DatasetGate from './DatasetGate.svelte';

const retryDataset = vi.fn(async (id: string) => { datasetStatus.begin(id, id); });
vi.mock('$lib/seed', () => ({ retryDataset: (id: string) => retryDataset(id) }));

afterEach(cleanup);

const content = createRawSnippet(() => ({ render: () => '<p class="feature">the feature</p>' }));
const mount = (datasets: string | string[]) => render(DatasetGate, { datasets, label: 'cross-references', skeleton: 'row', lines: 2, children: content });

describe('DatasetGate', () => {
    it('shows a skeleton while the dataset is on this boot\'s plan and still loading', () => {
        datasetStatus.setPhase('enhancing');
        datasetStatus.plan([{ id: 'cross-references', label: 'Cross-references' }]);
        const { getByRole, container } = mount('cross-references');
        expect(getByRole('status').textContent).toContain('Loading cross-references');
        expect(container.querySelector('.feature')).toBeNull();
    });

    it('renders the feature once the receipt lands, without a reload', async () => {
        datasetStatus.watch();
        datasetStatus.setPhase('enhancing');
        datasetStatus.plan([{ id: 'cross-references', label: 'Cross-references' }]);
        const { container } = mount('cross-references');
        expect(container.querySelector('.feature')).toBeNull();
        await db.datasets.put({ id: 'cross-references', version: 'v1', contentHash: 'a'.repeat(64), installedAt: 1, recordCount: 1 });
        await vi.waitFor(() => expect(container.querySelector('.feature')).not.toBeNull());
        await db.datasets.delete('cross-references');
        await vi.waitFor(() => expect(datasetStatus.isInstalled('cross-references')).toBe(false));
    });

    it('shows the cause with a retry that re-runs only the failed dataset', async () => {
        datasetStatus.setPhase('done');
        datasetStatus.plan([{ id: 'cross-references', label: 'Cross-references' }, { id: 'persons', label: 'People' }]);
        datasetStatus.fail('cross-references', 'cross-references-part2.json is missing');
        await db.datasets.put({ id: 'persons', version: 'v1', contentHash: 'b'.repeat(64), installedAt: 1, recordCount: 1 });
        await vi.waitFor(() => expect(datasetStatus.isInstalled('persons')).toBe(true));

        const { getByRole, getByText } = mount(['cross-references', 'persons']);
        expect(getByRole('alert').textContent).toContain('The cross-references could not be loaded.');
        expect(getByText('cross-references-part2.json is missing')).toBeTruthy();
        await fireEvent.click(getByRole('button', { name: 'Retry' }));
        await vi.waitFor(() => expect(retryDataset).toHaveBeenCalledTimes(1));
        expect(retryDataset).toHaveBeenCalledWith('cross-references');
        // Retrying puts the dataset back in flight: the gate is loading again, not failed
        await vi.waitFor(() => expect(getByRole('status').textContent).toContain('Loading'));
        await db.datasets.delete('persons');
    });

    it('is a neutral empty state for a dataset the deploy does not carry', () => {
        datasetStatus.setPhase('done');
        datasetStatus.plan([]);
        const { getByRole, queryByRole } = mount('commentary:calvin');
        expect(getByRole('status').textContent).toContain('This library does not include cross-references.');
        expect(queryByRole('alert')).toBeNull();
    });
});
