<script lang="ts">
    import type { Snippet } from 'svelte';

    /** The centered notice a result list shows instead of results: a hint, "no results", or a spinner while working. */
    let { loading = false, children }: { loading?: boolean; children: Snippet } = $props();
</script>

<div class="search-state">
    {#if loading}
        <div class="loading-spinner"></div>
    {/if}
    {@render children()}
</div>

<style>
    .search-state {
        text-align: center;
        padding: var(--space-12) 0;
        color: var(--color-text-muted);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-3);
    }
    .loading-spinner {
        width: 32px;
        height: 32px;
        border: 2px solid var(--color-border);
        border-top-color: var(--color-accent);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* The hint pair callers pass as children */
    .search-state :global(.search-hint) { font-size: var(--font-size-sm); }
    .search-state :global(.search-hint-sub) {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        opacity: 0.7;
        margin-top: calc(-1 * var(--space-2));
    }
    .search-state :global(.retry-btn) {
        margin-top: var(--space-3);
        padding: 4px var(--space-3);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-pill);
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 500;
        cursor: pointer;
        transition: all var(--transition-fast);
    }
    .search-state :global(.retry-btn:hover) {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }
</style>
