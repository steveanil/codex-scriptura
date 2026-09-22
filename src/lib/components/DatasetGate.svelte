<script lang="ts">
    import type { Snippet } from 'svelte';
    import { datasetStatus, type DatasetUiState } from '$lib/stores/datasetStatus.svelte';
    import { retryDataset } from '$lib/seed';
    import Skeleton from './ui/Skeleton.svelte';
    import EmptyState from './ui/EmptyState.svelte';
    import InlineError from './ui/InlineError.svelte';

    /**
     * Renders a feature only once the datasets it needs are installed
     * (issue #244). While they stream in behind the live reader it shows a
     * Skeleton; a failed install shows the cause with a retry that re-runs
     * that dataset alone; a dataset the deploy does not carry is a neutral
     * empty state. The children re-render on their own when the live query
     * flips the dataset to installed, so no reload is needed.
     */
    let {
        datasets,
        label,
        skeleton = 'text',
        lines = 3,
        children,
    }: {
        /** Manifest ids, e.g. 'cross-references' or ['persons', 'places', 'events']. */
        datasets: string | string[];
        /** What the feature needs, in a sentence fragment: "cross-references", "people, places and events". */
        label: string;
        skeleton?: 'text' | 'row' | 'card';
        lines?: number;
        children: Snippet;
    } = $props();

    const ids = $derived(Array.isArray(datasets) ? datasets : [datasets]);

    // The worst state wins: one failed dataset fails the feature, one still
    // loading keeps it loading, all installed renders it.
    const ORDER: DatasetUiState[] = ['failed', 'loading', 'absent', 'installed'];
    const gateState = $derived.by(() => {
        const states = ids.map((id) => datasetStatus.state(id));
        return ORDER.find((s) => states.includes(s)) ?? 'installed';
    });
    const failedId = $derived(ids.find((id) => datasetStatus.state(id) === 'failed'));
    const failure = $derived(failedId ? datasetStatus.failed[failedId] : undefined);

    let retrying = $state(false);
    async function retry() {
        if (retrying) return;
        retrying = true;
        try {
            for (const id of ids) {
                if (datasetStatus.state(id) === 'failed') await retryDataset(id);
            }
        } finally {
            retrying = false;
        }
    }
</script>

{#if gateState === 'installed'}
    {@render children()}
{:else if gateState === 'loading'}
    <Skeleton variant={skeleton} {lines} label={`Loading ${label}`} />
{:else if gateState === 'failed'}
    <InlineError message={`The ${label} could not be loaded.`} detail={failure} onRetry={retry} {retrying} />
{:else}
    <EmptyState message={`This library does not include ${label}.`} />
{/if}
