<script lang="ts">
    import { toast } from '$lib/stores/toast.svelte';
</script>

<div class="toaster" role="status" aria-live="polite">
    {#each toast.items as t (t.id)}
        <div class="toast">
            <span class="toast-message">{t.message}</span>
            {#if t.action}
                <button class="toast-action" onclick={() => toast.act(t.id)}>{t.action.label}</button>
            {/if}
            <button class="toast-close" onclick={() => toast.dismiss(t.id)} aria-label="Dismiss">×</button>
        </div>
    {/each}
</div>

<style>
    .toaster {
        position: fixed;
        left: 50%;
        /* Clears the reader's fixed selection toolbar (bottom 24px, ~48px tall) */
        bottom: 5.5rem;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-2);
        /* Above every overlay in the app (highest is 501) */
        z-index: 600;
        pointer-events: none;
        max-width: min(420px, calc(100vw - 2 * var(--space-4)));
    }
    .toast {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        animation: toast-in 160ms ease-out;
    }
    .toast-message {
        flex: 1;
    }
    .toast-action {
        padding: var(--space-1) var(--space-3);
        background: var(--color-accent-subtle);
        border: 1px solid transparent;
        border-radius: var(--radius-sm);
        color: var(--color-accent);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
    }
    .toast-action:hover {
        border-color: var(--color-accent);
    }
    .toast-close {
        width: 28px;
        height: 28px;
        border: none;
        background: none;
        color: var(--color-text-muted);
        font-size: 18px;
        line-height: 1;
        border-radius: var(--radius-sm);
        cursor: pointer;
    }
    .toast-close:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }
    @keyframes toast-in {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: none; }
    }
    @media (max-width: 768px) {
        .toaster {
            bottom: calc(var(--mobile-nav-height) + 5rem + env(safe-area-inset-bottom));
        }
    }
</style>
