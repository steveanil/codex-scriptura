<script lang="ts">
    import { preferences } from '$lib/stores/preferences.svelte';
    import type { HighlightPreset } from '@codex-scriptura/core';
    import SettingsCard from './SettingsCard.svelte';

    const prefs = $derived(preferences.value);

    function update(id: string, patch: Partial<HighlightPreset>) {
        if (!prefs) return;
        preferences.update({ highlightPresets: prefs.highlightPresets.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
    }
    function remove(id: string) {
        if (!prefs) return;
        preferences.update({ highlightPresets: prefs.highlightPresets.filter((p) => p.id !== id) });
    }
    function add() {
        if (!prefs) return;
        preferences.update({ highlightPresets: [...prefs.highlightPresets, { id: crypto.randomUUID(), name: 'New Preset', color: '#94a3b8' }] });
    }
</script>

{#if prefs}
<SettingsCard id="highlights" kicker="Highlights">
    <p class="note">The swatches on the selection toolbar. Rename, recolour, or add your own; at least one stays.</p>
    <div class="presets">
        {#each prefs.highlightPresets as preset (preset.id)}
            <div class="preset-row">
                <input type="color" value={preset.color} oninput={(e) => update(preset.id, { color: (e.currentTarget as HTMLInputElement).value })} class="preset-color" aria-label="Preset color" />
                <input type="text" value={preset.name} oninput={(e) => update(preset.id, { name: (e.currentTarget as HTMLInputElement).value })} class="preset-name" placeholder="Preset name" maxlength="32" aria-label="Preset name" />
                <button class="preset-delete" onclick={() => remove(preset.id)} aria-label="Delete preset" title="Delete preset" disabled={prefs.highlightPresets.length <= 1}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
            </div>
        {/each}
    </div>
    <button class="add-preset" onclick={add}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Add preset
    </button>
</SettingsCard>
{/if}

<style>
    .note {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        padding: var(--space-3) 0 var(--space-2);
        max-width: 64ch;
    }
    .presets { display: flex; flex-direction: column; gap: var(--space-2); }
    .preset-row { display: flex; align-items: center; gap: var(--space-3); }
    .preset-color {
        width: 32px;
        height: 28px;
        padding: 2px;
        background: var(--color-bg-control);
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-sm);
        cursor: pointer;
        flex-shrink: 0;
    }
    .preset-color::-webkit-color-swatch-wrapper { padding: 0; }
    .preset-color::-webkit-color-swatch { border: none; border-radius: var(--radius-xs); }
    .preset-name {
        flex: 1;
        height: var(--row-h-sm);
        background: var(--color-bg-control);
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-sm);
        padding: 0 var(--space-3);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
    }
    .preset-delete {
        background: none;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        width: var(--row-h-sm);
        height: var(--row-h-sm);
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }
    .preset-delete:hover:not(:disabled) { color: var(--color-danger); background: var(--color-bg-hover); }
    .preset-delete:disabled { opacity: 0.3; cursor: not-allowed; }
    .add-preset {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        margin-top: var(--space-3);
        height: var(--row-h-sm);
        padding: 0 var(--space-3);
        background: none;
        border: 1px dashed var(--color-border-control);
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        cursor: pointer;
    }
    .add-preset:hover { color: var(--color-accent); background: var(--color-accent-subtle); }
</style>
