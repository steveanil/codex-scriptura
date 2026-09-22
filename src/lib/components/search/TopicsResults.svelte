<script lang="ts">
    import { untrack } from 'svelte';
    import { searchTopics, getTopicById, type TopicSummary } from '@codex-scriptura/db';
    import { parseOsisId } from '@codex-scriptura/core';
    import type { Topic } from '@codex-scriptura/core';
    import { readerHref } from '$lib/utils/readerHref';
    import { datasetStatus } from '$lib/stores/datasetStatus.svelte';
    import DatasetGate from '$lib/components/DatasetGate.svelte';
    import SearchStatus from './SearchStatus.svelte';

    /**
     * Topics mode (Nave's, issue #28): the topics matching a subject, and
     * one topic opened to its curated verse list. The shell bumps `seq`
     * when a search should run; the topical index landing behind a live
     * reader (issue #244) re-runs it on its own.
     */
    let { query, seq }: { query: string; seq: number } = $props();

    let results = $state<TopicSummary[]>([]);
    let selected = $state<Topic | null>(null);
    let searching = $state(false);
    // Pointers already shown inside a section render there; the top row
    // keeps only the ones from Nave's bare "See X" lines.
    let seeAlso = $derived.by(() => {
        const topic = selected;
        if (!topic) return [];
        return topic.seeAlso.filter((slug) => !topic.sections.some((s) => s.seeAlso.includes(slug)));
    });

    let topicsInstalled = $derived(datasetStatus.isInstalled('naves-topics'));

    $effect(() => {
        void seq;
        void topicsInstalled;
        untrack(() => { void run(); });
    });

    async function run() {
        selected = null;
        if (!query.trim()) {
            results = [];
            return;
        }
        searching = true;
        try {
            results = await searchTopics(query);
        } finally {
            searching = false;
        }
    }

    async function open(id: string) {
        selected = (await getTopicById(id)) ?? null;
    }

    /** Open a topic the route resolved itself (the ?topic= deep link). */
    export function showTopic(topic: Topic) {
        selected = topic;
    }

    /** Reader link for a topic ref; ranges land on their first verse. */
    function refHref(osis: string): string {
        const ref = parseOsisId(osis.split('-')[0]);
        return ref ? readerHref(ref.book, ref.chapter, ref.verse) : '/read';
    }
</script>

{#if !query && !selected}
    <SearchStatus>
        <p class="search-hint">Type a subject - forgiveness, prayer, courage - to browse its curated verse list</p>
        <p class="search-hint-sub">5,300 topics and 78,000 references from Nave's Topical Bible (public domain)</p>
    </SearchStatus>
{:else}
    <DatasetGate datasets="naves-topics" label="topical index" skeleton="row" lines={5}>
        {#if selected}
            <div class="topic-detail">
                <button class="topic-back" onclick={() => (selected = null)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
                    </svg>
                    Matching topics
                </button>
                <div class="topic-head">
                    <h2 class="topic-name">{selected.name}</h2>
                    <span class="topic-count">{selected.refCount} reference{selected.refCount !== 1 ? 's' : ''}</span>
                </div>
                {#if seeAlso.length > 0}
                    <div class="topic-seealso">
                        <span class="seealso-label">See also</span>
                        {#each seeAlso as slug (slug)}
                            <button class="seealso-chip" onclick={() => open(slug)}>{slug.replace(/-/g, ' ')}</button>
                        {/each}
                    </div>
                {/if}
                {#each selected.sections as section, i (i)}
                    <div class="topic-section">
                        {#if section.heading}
                            <h3 class="topic-heading">{section.heading.toLowerCase()}</h3>
                        {/if}
                        {#each section.entries as entry, j (j)}
                            <div class="topic-entry">
                                {#if entry.label}
                                    <p class="topic-entry-label">{entry.label}</p>
                                {/if}
                                <div class="topic-refs">
                                    {#each entry.refs as ref, k (k)}
                                        <a class="topic-ref" href={refHref(ref.osis)} title={ref.osis}>{ref.label}</a>
                                    {/each}
                                </div>
                            </div>
                        {/each}
                        {#if section.seeAlso.length > 0}
                            <div class="topic-seealso">
                                <span class="seealso-label">See</span>
                                {#each section.seeAlso as slug (slug)}
                                    <button class="seealso-chip" onclick={() => open(slug)}>{slug.replace(/-/g, ' ')}</button>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {/each}
            </div>
        {:else if searching}
            <SearchStatus loading>
                <p>Searching topics…</p>
            </SearchStatus>
        {:else if results.length === 0}
            <SearchStatus>
                <p>No topics match "{query}"</p>
                <p class="search-hint-sub">Try a broader word - Nave's indexes subjects, not phrases</p>
            </SearchStatus>
        {:else}
            {#each results as topic (topic.id)}
                <button class="topic-row" onclick={() => open(topic.id)}>
                    <span class="topic-row-name">{topic.name}</span>
                    <span class="topic-row-count">{topic.refCount} ref{topic.refCount !== 1 ? 's' : ''}</span>
                </button>
            {/each}
        {/if}
    </DatasetGate>
{/if}

<style>
    .topic-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        min-height: var(--row-h-lg);
        padding: var(--space-2) var(--space-4);
        margin-bottom: var(--space-2);
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border-subtle);
        border-radius: var(--radius-md);
        cursor: pointer;
        font-family: var(--font-ui);
        text-align: left;
        transition: border-color var(--transition-fast), background var(--transition-fast);
    }
    .topic-row:hover {
        background: var(--color-accent-subtle);
    }
    .topic-row-name {
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: var(--color-text-primary);
    }
    .topic-row-count {
        font-family: var(--font-mono);
        font-size: var(--font-size-2xs);
        color: var(--color-text-muted);
    }
    .topic-detail {
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border-subtle);
        border-radius: var(--radius-md);
        padding: 18px 20px;
    }
    .topic-back {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        margin-bottom: 12px;
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-sm);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        cursor: pointer;
    }
    .topic-back:hover {
        color: var(--color-text-primary);
    }
    .topic-head {
        display: flex;
        align-items: baseline;
        gap: 12px;
        margin-bottom: 6px;
    }
    .topic-name {
        margin: 0;
        font-size: var(--font-size-xl);
        font-weight: 700;
        color: var(--color-text-primary);
    }
    .topic-count {
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
    }
    .topic-seealso {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        margin: 8px 0 4px;
    }
    .seealso-label {
        font-family: var(--font-mono);
        font-size: var(--font-size-2xs);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--color-text-muted);
    }
    .seealso-chip {
        padding: 3px 10px;
        background: var(--color-accent-subtle);
        border: none;
        border-radius: var(--radius-pill);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        color: var(--color-accent);
        cursor: pointer;
        text-transform: capitalize;
    }
    .seealso-chip:hover {
        background: var(--color-accent);
        color: var(--color-on-accent, #fff);
    }
    .topic-section {
        margin-top: 14px;
    }
    .topic-heading {
        margin: 0 0 6px;
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: var(--color-text-muted);
        text-transform: capitalize;
    }
    .topic-entry + .topic-entry {
        margin-top: 10px;
    }
    .topic-entry-label {
        margin: 0 0 4px;
        font-size: var(--font-size-sm);
        font-style: italic;
        color: var(--color-text-muted);
    }
    .topic-refs {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .topic-ref {
        padding: 3px 9px;
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border-subtle);
        border-radius: var(--radius-sm);
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        color: var(--color-text-primary);
        text-decoration: none;
        white-space: nowrap;
        transition: border-color var(--transition-fast);
    }
    .topic-ref:hover {
        background: var(--color-bg-hover);
        color: var(--color-accent);
    }
</style>
