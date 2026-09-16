<script lang="ts">
    import { onMount } from 'svelte';
    import SettingsCard from './SettingsCard.svelte';
    import { translationLibrary } from '$lib/stores/translationLibrary.svelte';
    import { preferences } from '$lib/stores/preferences.svelte';
    import { toast } from '$lib/stores/toast.svelte';
    import { clearCachedSearchIndexes } from '@codex-scriptura/db';
    import { measureStorage, type StorageItem } from '$lib/utils/storage-measure';
    import { formatBytes, shareOf } from '$lib/utils/format';
    import { exportBackup } from '$lib/utils/backup';

    let { usage, onChanged }: { usage: { usage: number; quota: number } | null; onChanged?: () => void } = $props();

    let items = $state<StorageItem[]>([]);
    let measuring = $state(false);
    let measuredFor = '';

    const installed = $derived(translationLibrary.catalog.filter((t) => translationLibrary.isInstalled(t.id)));
    const prefs = $derived(preferences.value);

    async function measure() {
        measuring = true;
        try {
            items = await measureStorage(installed.map((t) => ({ id: t.id, abbreviation: t.abbreviation })));
        } finally {
            measuring = false;
        }
    }
    // Re-measure when the installed set changes (a download or removal above)
    $effect(() => {
        const key = installed.map((t) => t.id).join(',');
        if (!translationLibrary.loaded || key === measuredFor) return;
        measuredFor = key;
        measure();
    });
    onMount(() => { if (translationLibrary.loaded) measure(); });

    const largest = $derived(Math.max(1, ...items.map((i) => i.bytes)));
    const BAR_COLOR: Record<StorageItem['kind'], string> = {
        translation: 'var(--color-accent)',
        annotations: 'var(--color-success)',
        index: 'var(--cat-ot)',
        graph: 'var(--cat-nt)',
    };

    function removable(id: string): string | null {
        const tid = id.replace('translation:', '');
        if (installed.length <= 1) return null;
        if (prefs?.activeTranslation === tid) return null;
        return tid;
    }
    async function removeTranslation(id: string) {
        const t = translationLibrary.catalog.find((x) => x.id === id);
        if (!t || !confirm(`Remove ${t.name}? You can download it again anytime.`)) return;
        await translationLibrary.remove(id);
        onChanged?.();
    }
    async function rebuildIndex() {
        await clearCachedSearchIndexes();
        toast.show('Search index cleared; it rebuilds on the next search');
        measure();
    }
</script>

<SettingsCard id="storage" kicker="Storage">
    <div class="head">
        <div>
            <span class="lbl">{usage && usage.quota > 0 ? `${formatBytes(usage.usage)} of ${formatBytes(usage.quota)} used` : 'Usage unknown'}</span>
            <span class="hint">What this browser reports for the whole app. Removing an item here removes it from the Library too; verse and graph sizes are measured from the records and are approximate.</span>
        </div>
        <a class="manage" href="#library">Manage…</a>
    </div>
    {#if items.length === 0}
        <p class="muted">{measuring ? 'Measuring…' : 'Nothing measured yet.'}</p>
    {:else}
        <div class="bars" aria-busy={measuring}>
            {#each items as item (item.id)}
                <div class="bar">
                    <span class="n" title={item.detail}>{item.label}</span>
                    <span class="t" aria-hidden="true"><i style="width: {Math.max(1, Math.round(shareOf(item.bytes, largest) * 100))}%; background: {BAR_COLOR[item.kind]}"></i></span>
                    <span class="v">{item.approx ? '~' : ''}{formatBytes(item.bytes)}</span>
                    <span class="a">
                        {#if item.kind === 'translation' && removable(item.id)}
                            <button onclick={() => removeTranslation(item.id.replace('translation:', ''))}>Remove</button>
                        {:else if item.kind === 'annotations'}
                            <button onclick={() => exportBackup().then(() => toast.show('Backup written'))}>Export</button>
                        {:else if item.kind === 'index'}
                            <button onclick={rebuildIndex}>Rebuild</button>
                        {/if}
                    </span>
                    <span class="d">{item.detail}</span>
                </div>
            {/each}
        </div>
    {/if}
</SettingsCard>

<style>
    .head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--space-4);
        padding: var(--space-3) 0 var(--space-2);
    }
    .lbl { display: block; color: var(--color-text-primary); font-size: var(--font-size-sm); font-weight: 500; }
    .hint { display: block; color: var(--color-text-muted); font-size: var(--font-size-xs); margin-top: 1px; max-width: 56ch; }
    .manage {
        flex: none;
        display: inline-flex;
        align-items: center;
        height: var(--row-h-sm);
        padding: 0 var(--space-3);
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-size: var(--font-size-xs);
        font-weight: 600;
    }
    .manage:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }
    .bars { display: flex; flex-direction: column; gap: var(--space-3); padding-top: var(--space-2); }
    .bar {
        display: grid;
        grid-template-columns: 130px 1fr 84px 72px;
        grid-template-areas: 'n t v a' 'd d d d';
        align-items: center;
        gap: 2px var(--space-3);
        font-size: var(--font-size-xs);
    }
    .n { grid-area: n; color: var(--color-text-secondary); }
    .t { grid-area: t; height: 6px; border-radius: 3px; background: var(--color-bg-surface); overflow: hidden; }
    .t i { display: block; height: 100%; }
    .v { grid-area: v; font-family: var(--font-mono); color: var(--color-text-muted); text-align: right; white-space: nowrap; }
    .a { grid-area: a; text-align: right; }
    .a button {
        border: 0;
        background: none;
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        cursor: pointer;
        padding: 2px 4px;
        border-radius: 4px;
    }
    .a button:hover { color: var(--color-danger); background: color-mix(in srgb, var(--color-danger) 10%, transparent); }
    .d { grid-area: d; font-size: var(--font-size-2xs); color: var(--color-text-muted); }
    .muted { font-size: var(--font-size-xs); color: var(--color-text-muted); padding: var(--space-2) 0; }
    @media (max-width: 768px) {
        .bar { grid-template-columns: 1fr 72px 72px; grid-template-areas: 'n v a' 't t t' 'd d d'; }
    }
</style>
