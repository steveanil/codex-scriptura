<script lang="ts">
    import type { PaneState } from '$lib/stores/splitPanes.svelte';

    let { pane }: { pane: PaneState } = $props();

    let pillsEl: HTMLDivElement | undefined = $state();

    // Each finished chapter load brings the active pill into view. Only
    // the end of a load counts, not the strip appearing on a resize.
    let wasLoading: boolean | undefined;
    $effect(() => {
        const loading = pane.loading;
        if (wasLoading === true && !loading) {
            const active = pillsEl?.querySelector('.chapter-pill.active') as HTMLElement | null;
            if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
        wasLoading = loading;
    });

    function handleWheel(e: WheelEvent) {
        if (!pillsEl) return;
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.preventDefault();
            pillsEl.scrollLeft += e.deltaY;
        }
    }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="chapter-pills" bind:this={pillsEl} onwheel={handleWheel}>
    {#each pane.availableChapters as ch}
        <button
            class="chapter-pill"
            class:active={ch === pane.chapter}
            onclick={() => pane.navigateToChapter(ch)}
        >{ch}</button>
    {/each}
</div>

<style>
    .chapter-pills {
        display: flex;
        flex: 0 1 auto;
        min-width: 0;
        gap: 2px;
        overflow-x: auto;
        overflow-y: hidden;
        padding: var(--space-1) 0;
        scrollbar-width: none;
    }
    .chapter-pills::-webkit-scrollbar { display: none; }

    .chapter-pill {
        padding: var(--space-1) var(--space-2);
        background: none;
        border: none;
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 500;
        cursor: pointer;
        transition: all var(--transition-fast);
        flex-shrink: 0;
        min-width: 28px;
    }
    .chapter-pill:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
    }
    .chapter-pill.active {
        color: var(--color-accent);
        background: var(--color-accent-subtle);
        font-weight: 700;
    }
</style>
