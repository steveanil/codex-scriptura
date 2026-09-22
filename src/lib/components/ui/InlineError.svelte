<script lang="ts">
    import Button from './Button.svelte';

    /**
     * Something went wrong, said where it happened (issue #244): the cause
     * in one line and a retry, never a bare failure. Danger colour, since
     * this is a fault, not an absent capability.
     */
    let {
        message,
        detail,
        onRetry,
        retrying = false,
        retryLabel = 'Retry',
    }: {
        /** What failed, as a sentence. */
        message: string;
        /** The underlying reason, shown in mono beneath. */
        detail?: string;
        onRetry?: () => void;
        retrying?: boolean;
        retryLabel?: string;
    } = $props();
</script>

<div class="inline-error" role="alert">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4" /><path d="M12 17h.01" />
    </svg>
    <div class="text">
        <p class="message">{message}</p>
        {#if detail}<p class="detail">{detail}</p>{/if}
    </div>
    {#if onRetry}
        <Button size="sm" variant="secondary" loading={retrying} onclick={onRetry}>{retrying ? 'Retrying…' : retryLabel}</Button>
    {/if}
</div>

<style>
    .inline-error {
        display: flex;
        align-items: flex-start;
        gap: var(--space-3);
        padding: var(--space-3) var(--space-4);
        border: 1px solid color-mix(in srgb, var(--color-danger) 40%, transparent);
        border-radius: var(--radius-sm);
        background: color-mix(in srgb, var(--color-danger) 8%, var(--color-bg-elevated));
        color: var(--color-text-primary);
        font-size: var(--font-size-xs);
    }
    .inline-error svg { flex-shrink: 0; color: var(--color-danger); margin-top: 2px; }
    .text { flex: 1; min-width: 0; }
    .message { margin: 0; }
    .detail {
        margin: var(--space-1) 0 0;
        color: var(--color-text-muted);
        font-family: var(--font-mono);
        font-size: var(--font-size-2xs);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
</style>
