<script lang="ts">
    import type { Snippet } from 'svelte';
    import Button from './Button.svelte';

    /**
     * Nothing to show, and that is information rather than a fault (issue
     * #244): one sentence saying so, optionally one action. Neutral colours
     * only; red is for something that went wrong (InlineError).
     */
    let {
        message,
        action,
        icon,
    }: {
        /** One sentence. */
        message: string;
        /** At most one thing the reader can do about it. */
        action?: { label: string; onclick?: () => void; href?: string };
        icon?: Snippet;
    } = $props();
</script>

<div class="empty-state" role="status">
    {#if icon}<span class="icon" aria-hidden="true">{@render icon()}</span>{/if}
    <p class="message">{message}</p>
    {#if action?.href}
        <a class="action-link" href={action.href}>{action.label}</a>
    {:else if action}
        <Button size="sm" variant="secondary" onclick={action.onclick}>{action.label}</Button>
    {/if}
</div>

<style>
    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-6) var(--space-4);
        text-align: center;
        color: var(--color-text-muted);
    }
    .icon { display: inline-flex; color: var(--color-text-muted); opacity: 0.7; }
    .message { margin: 0; font-size: var(--font-size-sm); max-width: 36ch; }
    .action-link { font-size: var(--font-size-sm); color: var(--color-accent); }
</style>
