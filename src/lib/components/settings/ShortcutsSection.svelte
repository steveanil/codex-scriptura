<script lang="ts">
    import SettingsCard from './SettingsCard.svelte';
    import { SHORTCUTS, renderKey } from '$lib/shortcuts';
    const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
</script>

<SettingsCard id="shortcuts" kicker="Keyboard shortcuts">
    <p class="note">Read-only for now. Plugin commands register into this list with the plugin runtime (v1.1.0), and remapping lands with them.</p>
    <div class="keys">
        {#each SHORTCUTS as s (s.id)}
            <div class="k">
                <span>{s.label}</span>
                <span class="combo">{#each s.keys as key, i (i)}<kbd>{renderKey(key, isMac)}</kbd>{/each}</span>
            </div>
        {/each}
    </div>
</SettingsCard>

<style>
    .note {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        padding: var(--space-3) 0 var(--space-2);
        max-width: 64ch;
    }
    .keys {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0 var(--space-8);
    }
    .k {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-4);
        min-height: var(--row-h-md);
        padding: var(--space-1) 0;
        border-bottom: 1px solid var(--color-border-subtle);
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
    }
    .combo { display: inline-flex; gap: 4px; white-space: nowrap; }
    kbd {
        font-family: var(--font-mono);
        font-size: var(--font-size-2xs);
        color: var(--color-text-primary);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-bottom-width: 2px;
        border-radius: 5px;
        padding: 2px 6px;
    }
    @media (max-width: 768px) {
        .keys { grid-template-columns: 1fr; }
    }
</style>
