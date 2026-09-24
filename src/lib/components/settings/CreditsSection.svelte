<script lang="ts">
    import { onMount } from 'svelte';
    import { getResources, getInstalledResourceIds } from '@codex-scriptura/db';
    import { datasetStatus } from '$lib/stores/datasetStatus.svelte';
    import SettingsCard from './SettingsCard.svelte';
    import { creditGroups, sourceIdentity, type CreditGroup } from '$lib/credits';

    let groups = $state<CreditGroup[] | null>(null);

    onMount(async () => {
        const [resources, installed] = await Promise.all([getResources(), getInstalledResourceIds()]);
        groups = creditGroups(resources, installed);
    });
</script>

<SettingsCard id="credits" kicker="Credits">
    <p class="note">Every text and dataset in Codex Scriptura is open data. This is what each one is, where it came from and under which terms, as recorded when it was built.</p>
    {#if datasetStatus.resourceCatalogStale}
        <p class="note stale" role="status">This device could not refresh the catalog on the last start, so an entry may lag the installed data.</p>
    {/if}

    {#if groups === null}
        <p class="muted">Loading…</p>
    {:else if groups.length === 0}
        <p class="muted">Nothing catalogued yet. Credits appear once the library data has loaded.</p>
    {:else}
        {#each groups as group (group.label)}
            <h3 class="group">{group.label}</h3>
            <ul class="items">
                {#each group.items as item (item.resource.id)}
                    {@const r = item.resource}
                    <li class="item">
                        <div class="head">
                            <div class="title-block">
                                <span class="t">{r.title}</span>
                                {#if item.byline}<span class="by">{item.byline}</span>{/if}
                            </div>
                            <div class="facts">
                                <span class="type">{item.typeLabel}</span>
                                {#if r.license.url}
                                    <a class="license" href={r.license.url} target="_blank" rel="noopener">{r.license.name}</a>
                                {:else}
                                    <span class="license">{r.license.name}</span>
                                {/if}
                                <span class="version" title="Version of the shipped content">{r.version}</span>
                                {#if item.installed}<span class="installed">Installed</span>{/if}
                            </div>
                        </div>
                        {#if r.description}<p class="desc">{r.description}</p>{/if}
                        <ul class="sources">
                            {#each r.provenance as s (s.sourceId)}
                                {@const fixed = sourceIdentity(s)}
                                <li class="source">
                                    <span class="src-line">
                                        <a href={s.url} target="_blank" rel="noopener">{s.name}</a>
                                        <span class="spdx">{s.license}</span>
                                        {#if fixed}<span class="fixed">{fixed}</span>{/if}
                                    </span>
                                    {#if s.attribution}<q class="attribution">{s.attribution}</q>{/if}
                                </li>
                            {/each}
                        </ul>
                    </li>
                {/each}
            </ul>
        {/each}
        <h3 class="group">Maps</h3>
        <p class="muted">Place maps use OpenStreetMap tiles; the map credits <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> in its corner.</p>
    {/if}
</SettingsCard>

<style>
    .note {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        padding: var(--space-3) 0 var(--space-1);
        max-width: 64ch;
    }
    .stale { color: var(--color-warning); }
    .muted { font-size: var(--font-size-xs); color: var(--color-text-muted); }
    .group {
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: var(--color-text-primary);
        padding: var(--space-5) 0 var(--space-2);
    }
    .items, .sources { list-style: none; margin: 0; padding: 0; }
    .item {
        padding: var(--space-3) 0;
        border-bottom: 1px solid var(--color-border-subtle);
    }
    .item:last-child { border-bottom: none; }
    .head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        flex-wrap: wrap;
        gap: var(--space-1) var(--space-4);
    }
    .title-block { min-width: 0; display: flex; flex-wrap: wrap; gap: 0 var(--space-2); align-items: baseline; }
    .t { color: var(--color-text-primary); font-weight: 500; font-size: var(--font-size-sm); }
    .by { color: var(--color-text-muted); font-size: var(--font-size-xs); }
    .facts {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--space-3);
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
    }
    .type { color: var(--color-text-muted); }
    .license { color: var(--color-text-secondary); }
    a.license:hover { color: var(--color-text-primary); }
    .version { font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--color-text-muted); }
    .installed {
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
    .desc {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        margin: 2px 0 0;
        max-width: 72ch;
    }
    .sources {
        margin-top: var(--space-2);
        padding-left: var(--space-3);
        border-left: 2px solid var(--color-border-subtle);
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
    }
    .source { font-size: var(--font-size-xs); }
    .src-line { display: inline-flex; flex-wrap: wrap; gap: var(--space-2); align-items: baseline; }
    .src-line a { color: var(--color-text-secondary); }
    .src-line a:hover { color: var(--color-text-primary); }
    .spdx, .fixed { font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--color-text-muted); }
    .attribution {
        display: block;
        color: var(--color-text-secondary);
        font-style: italic;
        margin-top: 1px;
    }
    .attribution::before, .attribution::after { content: ''; }
</style>
