<script lang="ts">
    /**
     * Placeholder for content that is on its way (issue #244): text lines,
     * list rows or a card. Announced once as busy; the real content replaces
     * it in place, so the layout does not jump.
     */
    let {
        variant = 'text',
        lines = 3,
        label = 'Loading',
    }: {
        /** text = paragraph lines, row = list rows with a leading dot, card = one raised block */
        variant?: 'text' | 'row' | 'card';
        lines?: number;
        /** What is loading, for assistive technology ("Loading cross-references"). */
        label?: string;
    } = $props();
</script>

<div class="skeleton skeleton-{variant}" role="status" aria-busy="true" aria-live="polite">
    <span class="visually-hidden">{label}…</span>
    {#if variant === 'card'}
        <div class="bone card" aria-hidden="true"></div>
    {:else}
        {#each Array.from({ length: Math.max(1, lines) }) as _, i (i)}
            <div class="line" aria-hidden="true">
                {#if variant === 'row'}<span class="bone dot"></span>{/if}
                <span class="bone bar" class:short={i === lines - 1 && lines > 1}></span>
            </div>
        {/each}
    {/if}
</div>

<style>
    .skeleton {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        width: 100%;
    }
    .skeleton-row { gap: var(--space-2); }
    .line { display: flex; align-items: center; gap: var(--space-2); }
    .bone {
        display: block;
        background: linear-gradient(90deg, var(--color-bg-surface) 25%, var(--color-bg-hover) 50%, var(--color-bg-surface) 75%);
        background-size: 200% 100%;
        animation: skeleton-shimmer 1.5s infinite;
        border-radius: var(--radius-sm);
    }
    .bar { height: 14px; flex: 1; }
    .bar.short { flex: 0 0 60%; }
    .skeleton-row .bar { height: 12px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .card { height: 72px; }
    @keyframes skeleton-shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
    }
    @media (prefers-reduced-motion: reduce) {
        .bone { animation: none; }
    }
</style>
