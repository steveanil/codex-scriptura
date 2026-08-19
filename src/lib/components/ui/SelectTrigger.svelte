<script lang="ts">
    import type { Snippet } from 'svelte';
    import type { HTMLButtonAttributes } from 'svelte/elements';

    /**
     * Disclosure trigger for pickers and popovers (book selector, future
     * display-mode pickers). Distinct from Button on purpose: this opens
     * a chooser, it does not perform an action, and it always carries a
     * chevron that tracks the expanded state.
     */
    interface Props extends HTMLButtonAttributes {
        /** Whether the controlled picker is open; drives aria-expanded and the chevron. */
        expanded?: boolean;
        children: Snippet;
    }

    let { expanded = false, children, ...rest }: Props = $props();
</script>

<button {...rest} class="select-trigger" aria-expanded={expanded}>
    {@render children()}
    <svg
        class="chevron"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
    >
        <path d="M6 9l6 6 6-6" />
    </svg>
</button>

<style>
    .select-trigger {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        height: 32px;
        padding: 0 var(--space-3);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        flex-shrink: 0;
        transition:
            background var(--transition-fast),
            border-color var(--transition-fast);
    }
    .select-trigger:hover {
        background: var(--color-bg-hover);
        border-color: var(--color-accent);
    }
    .select-trigger[aria-expanded='true'] {
        background: var(--color-bg-hover);
        border-color: var(--color-accent);
    }
    .select-trigger:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring, 0 0 0 2px var(--color-bg), 0 0 0 4px var(--color-accent));
    }

    .chevron {
        flex: none;
        opacity: 0.7;
        transition: transform var(--transition-fast);
    }
    .select-trigger[aria-expanded='true'] .chevron {
        transform: rotate(180deg);
    }
</style>
