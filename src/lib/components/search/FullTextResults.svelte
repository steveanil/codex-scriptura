<script lang="ts">
    import { untrack } from 'svelte';
    import { searchFullText, type FullTextHit, type Testament } from '$lib/search/fulltext';
    import type { SearchIndexSet } from '$lib/search/index-set.svelte';
    import { highlightQuery } from '$lib/search/highlight';
    import SearchStatus from './SearchStatus.svelte';
    import VerseResultCard from './VerseResultCard.svelte';

    /**
     * Full Text mode: the best-matching verses for a phrase, ranked by the
     * MiniSearch indexes of the selected translations. The shell bumps
     * `seq` when a search should run; an index that becomes ready re-runs
     * the search on its own so its verses join the list.
     */
    let {
        query,
        testament,
        translations,
        indexes,
        seq,
    }: {
        query: string;
        testament: Testament;
        /** Selected translation ids, in the order the pills show them. */
        translations: string[];
        indexes: SearchIndexSet;
        seq: number;
    } = $props();

    let results = $state<FullTextHit[]>([]);
    let searching = $state(false);
    // Hits are hydrated from IndexedDB, so a run can finish after a newer
    // one started; the generation guard keeps the newest run's results.
    let generation = 0;

    let anyBuilding = $derived(indexes.anyBuilding(translations));
    let allReady = $derived(indexes.allReady(translations));
    let failed = $derived(indexes.failed(translations));

    $effect(() => {
        void seq;
        void indexes.readyKey;
        untrack(() => { void run(); });
    });

    async function run() {
        const gen = ++generation;
        const q = query.trim();
        if (!q) {
            results = [];
            searching = false;
            return;
        }
        // A failed index is retried by the next search (issue #158)
        for (const id of translations) void indexes.ensure(id);
        searching = true;
        try {
            const hits = await searchFullText(indexes.readyIndexes(translations), q, { limit: 50, testament });
            if (gen === generation) results = hits;
        } catch (err) {
            console.error('Full text search failed', err);
            if (gen === generation) results = [];
        } finally {
            if (gen === generation) searching = false;
        }
    }

    function retryFailed() {
        for (const id of failed) void indexes.ensure(id);
    }
</script>

{#if query && results.length > 0}
    <p class="search-meta">{results.length} results{results.length >= 50 ? ' (top 50)' : ''}</p>
{/if}

{#if failed.length > 0 && !anyBuilding && results.length === 0}
    <SearchStatus>
        <p>The search index failed to build for {failed.join(', ')}.</p>
        <button class="retry-btn" onclick={retryFailed}>Retry</button>
    </SearchStatus>
{:else if anyBuilding && !allReady && !query}
    <SearchStatus loading>
        <p>Building search index…</p>
    </SearchStatus>
{:else if !query}
    <SearchStatus>
        <p class="search-hint">Search phrases and topics: "bread of life", "wilderness", "kingdom of God"</p>
        <p class="search-hint-sub">Looking for every occurrence of one word? Use Word Study.</p>
    </SearchStatus>
{:else if results.length === 0 && !searching && !anyBuilding}
    <SearchStatus>
        <p>No results for "{query}"</p>
    </SearchStatus>
{:else if results.length === 0 && anyBuilding}
    <SearchStatus loading>
        <p>Building index for new translation…</p>
    </SearchStatus>
{:else}
    {#each results as verse (verse.id)}
        <VerseResultCard
            {verse}
            html={highlightQuery(verse.text, query)}
            showTranslation={translations.length > 1}
            id="result-{verse.osisId}"
        />
    {/each}
{/if}

<style>
    .search-meta {
        font-size: var(--font-size-sm);
        color: var(--color-text-muted);
        margin: 0 0 var(--space-2);
    }
</style>
