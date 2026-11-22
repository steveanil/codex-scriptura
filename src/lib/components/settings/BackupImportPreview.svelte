<script lang="ts">
    import type { Annotation, SavedSearch, Tag } from '@codex-scriptura/core';
    import Button from '$lib/components/ui/Button.svelte';
    import { planImport, summarize, type Backup, type Collision, type LocalState, type TypePlan } from '$lib/utils/backup-format';
    import { formatOsisLabel } from '$lib/utils/verse-render';
    import { formatDate } from '$lib/utils/format';

    /** Rendered rows per list; the rest are counted, so a file with thousands of records stays usable. */
    const LIST_CAP = 50;

    let {
        name,
        backup,
        local,
        importing = false,
        onMerge,
        onReplace,
        onCancel,
    }: {
        name: string;
        backup: Backup;
        local: LocalState;
        importing?: boolean;
        onMerge: () => void;
        /** Called after the user confirms. */
        onReplace: () => void;
        onCancel: () => void;
    } = $props();

    const summary = $derived(summarize(backup));
    const merge = $derived(planImport(backup, 'merge', local));
    const replace = $derived(planImport(backup, 'replace', local));

    type Row = { label: string; plan: TypePlan<{ id: string }> };
    const rows: Row[] = $derived([
        { label: 'Annotations', plan: merge.annotations },
        { label: 'Tags', plan: merge.tags },
        { label: 'Saved searches', plan: merge.savedSearches },
    ]);
    const total = (pick: (p: TypePlan<{ id: string }>) => unknown[]) => rows.reduce((n, r) => n + pick(r.plan).length, 0);
    const overwriteCount = $derived(total((p) => p.newer));
    const sameCount = $derived(total((p) => p.same));
    const localOnlyCount = $derived(total((p) => p.localOnly));
    const replaceRevertCount = $derived(total((p) => p.older));

    const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
    const clip = (s: string) => (s.length > 90 ? `${s.slice(0, 90).trimEnd()}…` : s);

    type Item = { key: string; label: string; snippet?: string; was?: string };

    function range(a: Annotation): string {
        const end = a.verseEnd.split('.').pop();
        return a.verseEnd === a.verseStart ? formatOsisLabel(a.verseStart) : `${formatOsisLabel(a.verseStart)}-${end}`;
    }
    function annotationItem(a: Annotation, here?: Annotation): Item {
        const kind = a.type === 'highlight' && a.translation ? `highlight (${a.translation})` : a.type;
        const text = a.type === 'highlight' ? undefined : clip(a.data);
        const was = here && here.type !== 'highlight' && here.data !== a.data ? clip(here.data) : undefined;
        return { key: `a:${a.id}`, label: `${range(a)} · ${kind}`, snippet: text, was };
    }
    const tagItem = (t: Tag, here?: Tag): Item => ({ key: `t:${t.id}`, label: `Tag: ${t.name}`, was: here && here.name !== t.name ? here.name : undefined });
    const searchItem = (s: SavedSearch, here?: SavedSearch): Item => ({ key: `s:${s.id}`, label: `Saved search: ${s.query}`, was: here && here.query !== s.query ? here.query : undefined });

    const collide = <T,>(cs: Collision<T>[], f: (t: T, here: T) => Item) => cs.map((c) => f(c.incoming, c.local));
    const overwriteItems = $derived([
        ...collide(merge.annotations.newer, annotationItem),
        ...collide(merge.tags.newer, tagItem),
        ...collide(merge.savedSearches.newer, searchItem),
    ]);
    const removeItems = $derived([
        ...replace.annotations.localOnly.map((a) => annotationItem(a)),
        ...replace.tags.localOnly.map((t) => tagItem(t)),
        ...replace.savedSearches.localOnly.map((s) => searchItem(s)),
    ]);

    const replaceConsequence = $derived.by(() => {
        const parts: string[] = [];
        if (localOnlyCount > 0) parts.push(`deletes ${plural(localOnlyCount, 'record')} that only this browser has`);
        if (replaceRevertCount > 0) parts.push(`puts back the older backup copy of ${plural(replaceRevertCount, 'record')} edited here since`);
        parts.push(`replaces the settings${backup.scratchPad ? ' and scratch pad' : ''} here`);
        const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
        return `Replace makes this browser match the backup: it ${list}.`;
    });

    const padLine = $derived(
        !backup.scratchPad
            ? null
            : merge.scratchPad
                ? "Scratch pad: the backup's copy is newer and replaces the one here."
                : 'Scratch pad: the copy here is kept; it is the same or newer.',
    );

    function confirmReplace() {
        if (confirm(`${replaceConsequence} This cannot be undone.`)) onReplace();
    }
</script>

{#snippet itemList(items: Item[])}
    <ul class="items">
        {#each items.slice(0, LIST_CAP) as item (item.key)}
            <li>
                <span class="item-label">{item.label}</span>
                {#if item.snippet}<span class="item-snippet">“{item.snippet}”</span>{/if}
                {#if item.was !== undefined}<span class="item-was">Here now: “{item.was}”</span>{/if}
            </li>
        {/each}
    </ul>
    {#if items.length > LIST_CAP}
        <p class="more">and {plural(items.length - LIST_CAP, 'more record')}</p>
    {/if}
{/snippet}

<div class="preview" role="region" aria-label="Backup preview">
    <p class="title">{name}</p>
    <p class="line">Written {formatDate(summary.exportedAt)} by build {summary.app}: {plural(summary.notes, 'note')}, {plural(summary.highlights, 'highlight')}, {plural(summary.themes, 'theme tag')}, {plural(summary.tags, 'tag')}, {plural(summary.savedSearches, 'saved search')}{summary.scratchPad ? ', the scratch pad' : ''}.</p>

    <table class="counts">
        <caption class="line">What a merge does with each record</caption>
        <thead>
            <tr>
                <th scope="col"><span class="visually-hidden">Type</span></th>
                <th scope="col">New</th>
                <th scope="col">Overwrites</th>
                <th scope="col" title="The copy in this browser is newer, so it is kept">Newer here</th>
                <th scope="col" title="Not in the backup; merge keeps them, replace deletes them">Only here</th>
            </tr>
        </thead>
        <tbody>
            {#each rows as row (row.label)}
                <tr>
                    <th scope="row">{row.label}</th>
                    <td class:zero={row.plan.added.length === 0}>{row.plan.added.length.toLocaleString()}</td>
                    <td class:zero={row.plan.newer.length === 0} class:warn={row.plan.newer.length > 0}>{row.plan.newer.length.toLocaleString()}</td>
                    <td class:zero={row.plan.older.length === 0}>{row.plan.older.length.toLocaleString()}</td>
                    <td class:zero={row.plan.localOnly.length === 0}>{row.plan.localOnly.length.toLocaleString()}</td>
                </tr>
            {/each}
        </tbody>
    </table>

    <p class="line">
        Merge adds new records, overwrites one only when the backup's copy is newer, and keeps everything else here{sameCount > 0 ? ` (${plural(sameCount, 'record')} are identical)` : ''}. Settings stay as they are. Anything deleted here since the backup was made comes back.
    </p>
    {#if padLine}<p class="line">{padLine}</p>{/if}

    {#if overwriteItems.length > 0}
        <details class="list">
            <summary>Show the {plural(overwriteItems.length, 'record')} merge will overwrite</summary>
            {@render itemList(overwriteItems)}
        </details>
    {/if}

    <div class="actions">
        <Button variant="primary" size="sm" onclick={onMerge} loading={importing}>Merge into this browser</Button>
        <Button variant="danger" size="sm" onclick={confirmReplace} disabled={importing}>Replace everything</Button>
        <Button variant="ghost" size="sm" onclick={onCancel} disabled={importing}>Cancel</Button>
    </div>
    <p class="line">{replaceConsequence}</p>
    {#if removeItems.length > 0}
        <details class="list">
            <summary>Show the {plural(removeItems.length, 'record')} replace will delete</summary>
            {@render itemList(removeItems)}
        </details>
    {/if}
</div>

<style>
    .preview {
        margin-top: var(--space-2);
        padding: var(--space-3) var(--space-4);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg-surface);
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        min-width: 0;
    }
    .title { font-size: var(--font-size-sm); font-weight: 600; color: var(--color-text-primary); overflow-wrap: anywhere; }
    .line { font-size: var(--font-size-xs); color: var(--color-text-muted); }
    .counts {
        border-collapse: collapse;
        font-size: var(--font-size-xs);
        width: 100%;
        max-width: 520px;
    }
    .counts caption { text-align: left; padding-bottom: var(--space-1); }
    .counts th, .counts td {
        padding: 4px var(--space-2);
        border-bottom: 1px solid var(--color-border-subtle);
        text-align: right;
        font-variant-numeric: tabular-nums;
    }
    .counts thead th { color: var(--color-text-muted); font-weight: 500; vertical-align: bottom; }
    .counts th[scope='row'] { text-align: left; color: var(--color-text-secondary); font-weight: 500; padding-left: 0; }
    .counts td { color: var(--color-text-primary); }
    .counts td.zero { color: var(--color-text-muted); }
    /* weight, not the warning hue: --color-warning has no light-theme value and fails contrast there */
    .counts td.warn { font-weight: 700; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-1); }
    .list summary {
        cursor: pointer;
        color: var(--color-text-secondary);
        font-size: var(--font-size-xs);
        width: fit-content;
    }
    .list summary:hover { color: var(--color-text-primary); }
    .items {
        list-style: none;
        margin: var(--space-2) 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        max-height: 320px;
        overflow-y: auto;
        border-top: 1px solid var(--color-border-subtle);
    }
    .items li {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 6px 0;
        border-bottom: 1px solid var(--color-border-subtle);
        font-size: var(--font-size-xs);
        min-width: 0;
    }
    .item-label { color: var(--color-text-primary); font-weight: 500; }
    .item-snippet, .item-was { color: var(--color-text-secondary); overflow-wrap: anywhere; }
    .item-was { color: var(--color-text-muted); }
    .more { font-size: var(--font-size-xs); color: var(--color-text-muted); padding-top: var(--space-1); }
</style>
