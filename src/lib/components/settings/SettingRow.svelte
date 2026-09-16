<script lang="ts">
    import type { Snippet } from 'svelte';
    /**
     * One setting: label and optional hint on the left, the control on the
     * right; `stack` puts the control under the text for wide controls.
     */
    let {
        label,
        hint,
        labelFor,
        stack = false,
        children,
        below,
    }: {
        label: string;
        hint?: string;
        /** id of the control the label is for; renders a <label> instead of a span. */
        labelFor?: string;
        stack?: boolean;
        children: Snippet;
        /** Optional full-width line under the row (a conditional-state note). */
        below?: Snippet;
    } = $props();
</script>

<div class="row" class:stack>
    <div class="row-text">
        {#if labelFor}
            <label class="lbl" for={labelFor}>{label}</label>
        {:else}
            <span class="lbl">{label}</span>
        {/if}
        {#if hint}<span class="hint">{hint}</span>{/if}
    </div>
    <div class="ctl">
        {@render children()}
    </div>
    {#if below}
        <div class="below">{@render below()}</div>
    {/if}
</div>

<style>
    .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--space-2) var(--space-5);
        min-height: 52px;
        padding: var(--space-2) 0;
        border-bottom: 1px solid var(--color-border-subtle);
    }
    .row:last-child {
        border-bottom: none;
    }
    .row.stack {
        flex-direction: column;
        align-items: stretch;
        gap: var(--space-3);
        padding: var(--space-4) 0;
    }
    /* In a column the flex basis would become a height */
    .row.stack .row-text {
        flex: none;
    }
    .row.stack .ctl {
        flex-wrap: wrap;
        justify-content: flex-start;
        gap: var(--space-4);
    }
    .row-text {
        min-width: 0;
        flex: 1 1 240px;
    }
    .lbl {
        display: block;
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
        font-weight: 500;
    }
    .hint {
        display: block;
        color: var(--color-text-muted);
        font-size: var(--font-size-xs);
        margin-top: 1px;
        max-width: 52ch;
    }
    .ctl {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex: 0 0 auto;
    }
    .below {
        flex-basis: 100%;
    }
    @media (max-width: 768px) {
        .row {
            flex-direction: column;
            align-items: flex-start;
        }
        .row-text {
            flex: none;
            width: 100%;
        }
    }
</style>
