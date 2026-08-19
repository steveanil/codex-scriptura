<script lang="ts">
    import type { Snippet } from 'svelte';
    import type { HTMLButtonAttributes } from 'svelte/elements';

    interface Props extends HTMLButtonAttributes {
        /** primary = filled accent, secondary = surface + border, ghost = bare, danger = destructive outline */
        variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
        /** sm 28px, md 32px, lg 40px */
        size?: 'sm' | 'md' | 'lg';
        /** Shows a spinner and disables the button; text children stay visible for progress copy. */
        loading?: boolean;
        /** Square button holding only an icon; `label` becomes required for the accessible name. */
        iconOnly?: boolean;
        fullWidth?: boolean;
        /** Accessible name for icon-only buttons (aria-label + title). */
        label?: string;
        children: Snippet;
    }

    let {
        variant = 'secondary',
        size = 'md',
        loading = false,
        iconOnly = false,
        fullWidth = false,
        label,
        disabled = false,
        children,
        ...rest
    }: Props = $props();

    $effect(() => {
        if (import.meta.env.DEV && iconOnly && !label) {
            console.warn('Button: icon-only buttons need a `label` for their accessible name');
        }
    });
</script>

<button
    {...rest}
    class="btn {variant} {size}"
    class:icon-only={iconOnly}
    class:full-width={fullWidth}
    aria-label={iconOnly ? label : rest['aria-label']}
    title={rest.title ?? (iconOnly ? label : undefined)}
    aria-busy={loading || undefined}
    disabled={disabled || loading}
>
    {#if loading}
        <span class="spinner" aria-hidden="true"></span>
    {/if}
    {@render children()}
</button>

<style>
    .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        font-family: var(--font-ui);
        font-weight: 600;
        border: 1px solid transparent;
        border-radius: var(--radius-sm);
        cursor: pointer;
        white-space: nowrap;
        flex-shrink: 0;
        transition:
            background var(--transition-fast),
            border-color var(--transition-fast),
            color var(--transition-fast);
    }

    /* Sizes */
    .sm {
        height: 28px;
        padding: 0 var(--space-2);
        font-size: var(--font-size-xs);
    }
    .md {
        height: 32px;
        padding: 0 var(--space-3);
        font-size: var(--font-size-sm);
    }
    .lg {
        height: 40px;
        padding: 0 var(--space-4);
        font-size: var(--font-size-sm);
    }
    .icon-only {
        padding: 0;
    }
    .icon-only.sm { width: 28px; }
    .icon-only.md { width: 32px; }
    .icon-only.lg { width: 40px; }
    .full-width {
        width: 100%;
    }

    /* Variants */
    .primary {
        background: var(--color-accent);
        color: var(--color-on-accent, #fff);
    }
    .primary:hover:not(:disabled) {
        background: var(--color-accent-hover);
    }
    .secondary {
        background: var(--color-bg-surface);
        border-color: var(--color-border);
        color: var(--color-text-primary);
    }
    .secondary:hover:not(:disabled) {
        background: var(--color-bg-hover);
        border-color: var(--color-accent);
    }
    .ghost {
        background: none;
        color: var(--color-text-secondary);
    }
    .ghost:hover:not(:disabled) {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }
    .danger {
        background: none;
        border-color: color-mix(in srgb, var(--color-danger) 55%, transparent);
        color: var(--color-danger);
    }
    .danger:hover:not(:disabled) {
        background: color-mix(in srgb, var(--color-danger) 12%, transparent);
        border-color: var(--color-danger);
    }

    /* States */
    .btn:active:not(:disabled) {
        transform: scale(0.98);
    }
    .btn:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring, 0 0 0 2px var(--color-bg), 0 0 0 4px var(--color-accent));
    }
    .btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }
    .btn[aria-busy='true'] {
        cursor: progress;
    }

    .spinner {
        width: 1em;
        height: 1em;
        flex: none;
        border-radius: 50%;
        border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
        border-top-color: currentColor;
        animation: btn-spin 0.7s linear infinite;
    }
    @keyframes btn-spin {
        to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
        .spinner { animation-duration: 1.6s; }
    }
</style>
