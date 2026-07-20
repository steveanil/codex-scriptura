<script lang="ts">
    import { WHATS_NEW, LATEST_UPDATE_ID } from '$lib/whats-new';
    import { setKv } from '@codex-scriptura/db';
    import { ui } from '$lib/stores/ui.svelte';

    async function close() {
        ui.whatsNewOpen = false;
        if (ui.hasUnseenUpdates) {
            ui.hasUnseenUpdates = false;
            await setKv('whatsNewSeen', LATEST_UPDATE_ID);
        }
    }
</script>

{#if ui.whatsNewOpen}
    <div class="wn-overlay" onclick={close} role="presentation"></div>
    <div class="wn-modal" role="dialog" aria-modal="true" aria-label="What's new in Codex Scriptura">
        <div class="wn-header">
            <h2 class="wn-title">What's new</h2>
            <button class="wn-close" aria-label="Close" onclick={close}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                </svg>
            </button>
        </div>

        <div class="wn-body">
            {#each WHATS_NEW.slice(0, 5) as entry (entry.id)}
                <div class="wn-entry">
                    <div class="wn-entry-header">
                        <h3 class="wn-entry-title">{entry.title}</h3>
                        <span class="wn-entry-date">{entry.date}</span>
                    </div>
                    <ul class="wn-list">
                        {#each entry.highlights as h}
                            <li>{h}</li>
                        {/each}
                    </ul>
                </div>
            {/each}
        </div>

        <div class="wn-footer">
            <button class="wn-got-it" onclick={close}>Got it</button>
        </div>
    </div>
{/if}

<style>
    .wn-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 200;
    }
    .wn-modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: min(480px, calc(100vw - 2rem));
        max-height: min(600px, calc(100vh - 4rem));
        display: flex;
        flex-direction: column;
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
        z-index: 201;
    }
    .wn-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--space-4) var(--space-5) var(--space-2);
    }
    .wn-title {
        font-family: var(--font-ui);
        font-size: var(--font-size-lg);
        font-weight: 600;
        color: var(--color-text-primary);
        margin: 0;
    }
    .wn-close {
        background: none;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        display: flex;
        padding: var(--space-1);
        border-radius: var(--radius-sm);
    }
    .wn-close:hover { color: var(--color-text-primary); }

    .wn-body {
        overflow-y: auto;
        padding: 0 var(--space-5);
    }
    .wn-entry { padding: var(--space-3) 0; }
    .wn-entry + .wn-entry { border-top: 1px solid var(--color-border-subtle); }
    .wn-entry-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: var(--space-3);
    }
    .wn-entry-title {
        font-family: var(--font-ui);
        font-size: var(--font-size-base);
        font-weight: 600;
        color: var(--color-accent);
        margin: 0;
    }
    .wn-entry-date {
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        white-space: nowrap;
    }
    .wn-list {
        margin: var(--space-2) 0 0;
        padding-left: 1.1em;
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }
    .wn-list li {
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        line-height: 1.55;
        color: var(--color-text-secondary);
    }

    .wn-footer {
        padding: var(--space-3) var(--space-5) var(--space-4);
        display: flex;
        justify-content: flex-end;
    }
    .wn-got-it {
        background: var(--color-accent);
        border: none;
        border-radius: var(--radius-sm);
        color: white;
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 600;
        padding: var(--space-2) var(--space-4);
        cursor: pointer;
    }
</style>
