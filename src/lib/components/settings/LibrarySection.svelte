<script lang="ts">
    import { preferences } from '$lib/stores/preferences.svelte';
    import { translationLibrary } from '$lib/stores/translationLibrary.svelte';
    import Button from '$lib/components/ui/Button.svelte';
    import SettingsCard from './SettingsCard.svelte';
    import { LIBRARY_CATEGORIES, countFor, filterItems, libraryItems, type LibraryFilter } from '$lib/library';

    let { onChanged }: { onChanged?: () => void } = $props();

    const prefs = $derived(preferences.value);
    const items = $derived(libraryItems(translationLibrary.catalog, translationLibrary.installedIds));
    let filter = $state<LibraryFilter>('all');
    const visible = $derived(filterItems(items, filter));
    const emptyCategory = $derived(filter !== 'all' && filter !== 'installed' ? LIBRARY_CATEGORIES.find((c) => c.kind === filter) : undefined);
    const installedCount = $derived(translationLibrary.installedIds.size);

    /** Why this translation can't be removed right now, or null. */
    function removalBlock(id: string): string | null {
        if (installedCount <= 1) return 'The last installed translation cannot be removed';
        if (prefs?.activeTranslation === id) return 'In use by the reader; switch translations there first';
        return null;
    }
    async function download(id: string) {
        await translationLibrary.ensureInstalled(id);
        onChanged?.();
    }
    async function remove(id: string, name: string) {
        if (!confirm(`Remove ${name}? You can download it again anytime.`)) return;
        await translationLibrary.remove(id);
        onChanged?.();
    }

    const tabs: { id: LibraryFilter; label: string }[] = [
        { id: 'all', label: 'All' },
        ...LIBRARY_CATEGORIES.map((c) => ({ id: c.kind as LibraryFilter, label: c.label })),
        { id: 'installed', label: 'Installed' },
    ];
</script>

<SettingsCard id="library" kicker="Library">
    <p class="note">Download corpora to read and search them offline. Reader pickers list only what is installed; removing anything here updates Storage immediately.</p>

    <div class="lib-tabs" role="tablist" aria-label="Library filter">
        {#each tabs as t (t.id)}
            <button role="tab" aria-selected={filter === t.id} class="lib-tab" onclick={() => (filter = t.id)}>
                {t.label} <span class="count">{countFor(items, t.id)}</span>
            </button>
        {/each}
    </div>

    {#if !translationLibrary.loaded}
        <p class="muted">Loading…</p>
    {:else if visible.length === 0 && emptyCategory}
        <div class="empty">
            <h3>{emptyCategory.label} arrive with {emptyCategory.plannedIn}</h3>
            <p>{emptyCategory.blurb}</p>
        </div>
    {:else if visible.length === 0}
        <p class="muted">Nothing here yet.</p>
    {:else}
        {#each visible as item (item.id)}
            {@const entry = translationLibrary.state(item.id)}
            <div class="item translation-row">
                <div class="item-text">
                    <div class="t">{item.title}</div>
                    <div class="m">{item.meta}</div>
                    {#if entry.error}<div class="m failed" role="alert">Download failed: {entry.error}</div>{/if}
                </div>
                <div class="size">{#if item.verseCount > 0}{item.verseCount.toLocaleString()} verses{/if}</div>
                <div class="act">
                    {#if entry.downloading}
                        {@const pct = Math.round((entry.progress ?? 0) * 100)}
                        <span class="prog" aria-hidden="true"><i style="width: {pct}%"></i></span>
                        <span class="pct">{pct}%</span>
                        <span class="visually-hidden" role="status">Downloading {item.translation.abbreviation}, {pct} percent</span>
                    {:else if entry.removing}
                        <Button size="sm" variant="danger" loading>Removing…</Button>
                    {:else if item.installed}
                        {@const block = removalBlock(item.id)}
                        <span class="installed">Installed</span>
                        {#if block}
                            <span class="muted" title={block}>In use</span>
                        {:else}
                            <Button size="sm" variant="secondary" onclick={() => remove(item.id, item.translation.name)}>Remove</Button>
                        {/if}
                    {:else if entry.error}
                        <Button size="sm" variant="secondary" onclick={() => download(item.id)}>Retry</Button>
                    {:else}
                        <Button size="sm" variant="secondary" onclick={() => download(item.id)}>Download</Button>
                    {/if}
                </div>
            </div>
        {/each}
    {/if}
</SettingsCard>

<style>
    .note {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        padding: var(--space-3) 0 var(--space-1);
        max-width: 64ch;
    }
    .lib-tabs {
        display: flex;
        gap: var(--space-2);
        padding: var(--space-3) 0 var(--space-4);
        flex-wrap: wrap;
    }
    .lib-tab {
        height: var(--row-h-sm);
        padding: 0 var(--space-3);
        border: 1px solid var(--color-border);
        background: transparent;
        color: var(--color-text-secondary);
        border-radius: var(--radius-pill);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        cursor: pointer;
        transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
    }
    .lib-tab:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }
    .lib-tab[aria-selected='true'] {
        border-color: var(--color-accent);
        background: var(--color-accent-subtle);
        color: var(--color-text-primary);
    }
    .count {
        color: var(--color-text-muted);
        margin-left: 6px;
        font-family: var(--font-mono);
        font-size: var(--font-size-2xs);
    }
    .item {
        display: grid;
        grid-template-columns: 1fr auto auto;
        align-items: center;
        gap: var(--space-4);
        padding: var(--space-3) 0;
        border-bottom: 1px solid var(--color-border-subtle);
    }
    .item:last-child { border-bottom: none; }
    .item-text { min-width: 0; }
    .t { color: var(--color-text-primary); font-weight: 500; font-size: var(--font-size-sm); }
    .m { font-size: var(--font-size-xs); color: var(--color-text-muted); margin-top: 1px; }
    .failed { color: var(--color-danger); }
    .size {
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        text-align: right;
        white-space: nowrap;
    }
    .act {
        position: relative;
        display: flex;
        align-items: center;
        gap: var(--space-2);
        justify-content: flex-end;
        min-width: 170px;
    }
    .installed {
        font-size: var(--font-size-xs);
        color: var(--color-success);
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }
    .installed::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--color-success);
    }
    .prog {
        width: 112px;
        height: 4px;
        border-radius: var(--radius-xs);
        background: var(--color-bg-surface);
        overflow: hidden;
        display: inline-block;
    }
    .prog i { display: block; height: 100%; background: var(--color-accent); transition: width var(--transition-fast); }
    .pct { font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--color-text-muted); }
    .muted { font-size: var(--font-size-xs); color: var(--color-text-muted); }
    .empty {
        text-align: center;
        padding: var(--space-8) var(--space-5) var(--space-6);
        border: 1px dashed var(--color-border);
        border-radius: var(--radius-md);
    }
    .empty h3 { color: var(--color-text-primary); font-size: var(--font-size-base); font-weight: 600; }
    .empty p { color: var(--color-text-muted); font-size: var(--font-size-xs); max-width: 44ch; margin: var(--space-2) auto 0; }
    @media (max-width: 768px) {
        .item { grid-template-columns: 1fr; gap: var(--space-2); }
        .size { text-align: left; }
        .act { justify-content: flex-start; min-width: 0; }
    }
</style>
