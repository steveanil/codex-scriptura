<script lang="ts">
    import type { Snippet } from 'svelte';
    /** A raised card with a mono kicker header strip; one per Settings section. */
    let { id, kicker, children }: { id: string; kicker: string; children: Snippet } = $props();
</script>

<section class="card" {id} aria-labelledby="{id}-kicker">
    <div class="card-head">
        <h2 class="card-kicker" id="{id}-kicker">{kicker}</h2>
    </div>
    <div class="card-body">
        {@render children()}
    </div>
</section>

<style>
    .card {
        /* Positioning context so visually-hidden status text stays inside the card */
        position: relative;
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        margin-bottom: var(--space-6);
        scroll-margin-top: var(--space-4);
    }
    .card-head {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-4) var(--space-5);
        border-bottom: 1px solid var(--color-border-subtle);
    }
    .card-body {
        padding: var(--space-2) var(--space-5) var(--space-5);
    }
    @media (max-width: 768px) {
        .card-head { padding: var(--space-3) var(--space-4); }
        .card-body { padding: var(--space-2) var(--space-4) var(--space-4); }
    }
</style>
