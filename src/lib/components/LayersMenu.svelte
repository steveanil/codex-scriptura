<script lang="ts">
    /**
     * The Layers menu (issue #246): every text overlay the reader can draw
     * lives here, so a new overlay (footnotes, provenance, v0.6 plugin
     * layers) gets a checkbox row instead of a new header icon.
     */
    export type LayerItem = { id: string; label: string; hint?: string; checked: boolean };

    let {
        layers,
        ontoggle,
    }: {
        layers: LayerItem[];
        ontoggle: (id: string, checked: boolean) => void;
    } = $props();

    let open = $state(false);
    const onCount = $derived(layers.filter((l) => l.checked).length);
</script>

<svelte:window onkeydown={(e) => { if (open && e.key === 'Escape') open = false; }} />

<div class="layers">
    <button
        class="layers-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Layers"
        title="Layers: what the reader draws over the text"
        onclick={() => (open = !open)}
    >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
        </svg>
        <span class="layers-label">Layers</span>
        {#if onCount > 0}<span class="layers-count" aria-hidden="true">{onCount}</span>{/if}
    </button>
    {#if open}
        <div class="layers-overlay" onclick={() => (open = false)} role="presentation"></div>
        <div class="layers-menu" role="menu" aria-label="Layers">
            {#each layers as layer (layer.id)}
                <button
                    class="layer-row"
                    role="menuitemcheckbox"
                    aria-checked={layer.checked}
                    onclick={() => ontoggle(layer.id, !layer.checked)}
                >
                    <span class="layer-box" aria-hidden="true">
                        {#if layer.checked}
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                        {/if}
                    </span>
                    <span class="layer-text">
                        <span class="layer-name">{layer.label}</span>
                        {#if layer.hint}<span class="layer-hint">{layer.hint}</span>{/if}
                    </span>
                </button>
            {/each}
        </div>
    {/if}
</div>

<style>
    .layers {
        position: relative;
        flex: none;
    }
    .layers-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        height: var(--row-h-sm);
        padding: 0 var(--space-2);
        background: none;
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-sm);
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
        transition: color var(--transition-fast), background var(--transition-fast);
    }
    .layers-btn:hover,
    .layers-btn[aria-expanded='true'] {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
    }
    .layers-count {
        min-width: 16px;
        padding: 0 4px;
        border-radius: var(--radius-pill);
        background: var(--color-accent-subtle);
        color: var(--color-accent);
        font-size: var(--font-size-2xs);
        line-height: 16px;
        text-align: center;
    }
    .layers-overlay {
        position: fixed;
        inset: 0;
        z-index: 49;
    }
    /* Floating: elevated bg plus the floating shadow */
    .layers-menu {
        position: absolute;
        top: calc(100% + 4px);
        right: 0;
        z-index: 50;
        min-width: 240px;
        padding: var(--space-1);
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-floating);
        display: flex;
        flex-direction: column;
    }
    .layer-row {
        display: flex;
        align-items: flex-start;
        gap: var(--space-3);
        width: 100%;
        min-height: var(--row-h-md);
        padding: var(--space-2) var(--space-3);
        background: none;
        border: none;
        border-radius: var(--radius-sm);
        font-family: var(--font-ui);
        text-align: left;
        cursor: pointer;
    }
    .layer-row:hover {
        background: var(--color-bg-hover);
    }
    .layer-box {
        flex: none;
        width: 16px;
        height: 16px;
        margin-top: 2px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-xs);
        background: var(--color-bg-control);
        color: var(--color-on-accent);
    }
    .layer-row[aria-checked='true'] .layer-box {
        background: var(--color-accent);
        border-color: var(--color-accent);
    }
    .layer-text {
        display: flex;
        flex-direction: column;
        gap: 1px;
    }
    .layer-name {
        font-size: var(--font-size-sm);
        font-weight: 500;
        color: var(--color-text-primary);
    }
    .layer-hint {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
    }

    @media (max-width: 768px) {
        .layers-label { display: none; }
        .layers-btn { width: 44px; height: 44px; justify-content: center; padding: 0; }
    }
</style>
