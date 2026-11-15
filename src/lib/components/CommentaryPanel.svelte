<script lang="ts">
    import { parseOsisId, sourceLocatorUrl, type CommentaryEntry, type ResourceDescriptor } from '@codex-scriptura/core';
    import { getCommentaryForChapter, getInstalledCommentaries } from '@codex-scriptura/db';
    import { getDataManifest, commentaryCatalog } from '$lib/data-manifest';
    import { datasetStatus } from '$lib/stores/datasetStatus.svelte';
    import DatasetGate from './DatasetGate.svelte';
    import CommentaryContent from './CommentaryContent.svelte';
    import EmptyState from './ui/EmptyState.svelte';

    /**
     * The Study Rail's commentary section (issue #366): the entries of one
     * installed commentary that cover the pane's chapter, narrowed to the
     * selected verses when there are any. It reads the catalogue from the
     * manifest and names no commentary itself. Entries are queried only
     * once the dataset's receipt is present (DatasetGate), never on the
     * table alone, because a failed install can leave partial rows.
     */
    let {
        bookId,
        bookName,
        chapter,
        selectedVerses = [],
    }: {
        bookId: string;
        bookName: string;
        chapter: number;
        selectedVerses?: number[];
    } = $props();

    let catalog = $state<{ datasetId: string; resource: ResourceDescriptor }[] | null>(null);
    let chosen = $state<string | null>(null);
    $effect(() => {
        // The manifest is fetched, so with no network the list comes from what is installed
        void getDataManifest().then(async (m) => {
            catalog = m ? commentaryCatalog(m).map((c) => ({ datasetId: c.entry.id, resource: c.resource })) : await getInstalledCommentaries();
        });
    });
    const current = $derived(catalog?.find((c) => c.resource.id === chosen) ?? catalog?.[0] ?? null);

    let entries = $state<CommentaryEntry[]>([]);
    let loadedFor = $state('');
    $effect(() => {
        const c = current;
        if (!c || !datasetStatus.isInstalled(c.datasetId)) { entries = []; loadedFor = ''; return; }
        const want = `${c.resource.id}|${bookId}.${chapter}`;
        void getCommentaryForChapter(bookId, chapter, c.resource.id).then((rows) => {
            // A slower answer for a chapter the pane has left is dropped
            if (want === `${current?.resource.id}|${bookId}.${chapter}`) { entries = rows; loadedFor = want; }
        });
    });

    /** The verses of this chapter an entry covers, as [first, last]; an entry that runs over a chapter end covers to that end. */
    function span(e: CommentaryEntry): [number, number] {
        const a = parseOsisId(e.startRef)!, b = parseOsisId(e.endRef)!;
        return [a.book === bookId && a.chapter === chapter ? a.verse : 1, b.book === bookId && b.chapter === chapter ? b.verse : Infinity];
    }
    const shown = $derived(selectedVerses.length === 0 ? entries : entries.filter((e) => {
        const [from, to] = span(e);
        return selectedVerses.some((v) => v >= from && v <= to);
    }));
    function label(e: CommentaryEntry): string {
        const a = parseOsisId(e.startRef)!, b = parseOsisId(e.endRef)!;
        const end = a.chapter === b.chapter ? (a.verse === b.verse ? '' : `-${b.verse}`) : `-${b.chapter}:${b.verse}`;
        return `${bookName} ${a.chapter}:${a.verse}${end}`;
    }
    const hasProvenance = $derived(entries.some((e) => e.excerpts?.length));
</script>

<div class="commentary-panel">
    {#if catalog === null}
        <p class="note" role="status">Loading the commentary list</p>
    {:else if !current}
        <EmptyState message="This build carries no commentary yet." />
    {:else}
        {#if catalog.length > 1}
            <label class="resource-pick">
                <span>Commentary</span>
                <select value={current.resource.id} onchange={(e) => { chosen = (e.currentTarget as HTMLSelectElement).value; }}>
                    {#each catalog as c (c.resource.id)}<option value={c.resource.id}>{c.resource.title}</option>{/each}
                </select>
            </label>
        {/if}
        <header class="resource">
            <h3>{current.resource.title}</h3>
            <p class="byline">
                {#if current.resource.author}{current.resource.author}{/if}{#if current.resource.author && current.resource.publisher}, {/if}{#if current.resource.publisher}{current.resource.publisher}{/if}
            </p>
            <p class="byline">
                {current.resource.license.name}{#each current.resource.provenance.slice(0, 1) as p (p.sourceId)} · source: <a href={p.url} target="_blank" rel="noopener noreferrer">{p.name}</a>{/each}
            </p>
        </header>
        <DatasetGate datasets={current.datasetId} label={current.resource.title} skeleton="text" lines={6}>
            {#if hasProvenance}
                <p class="note provenance-note">
                    This text was read from scans by OCR. A margin citation is the OCR's reading unless it is marked as checked against the page; each excerpt links to the page it was read from.
                </p>
            {/if}
            {#if loadedFor && shown.length === 0}
                <EmptyState message={selectedVerses.length ? `Nothing in this commentary covers the selected verses of ${bookName} ${chapter}.` : `This commentary has nothing on ${bookName} ${chapter}.`} />
            {/if}
            {#each shown as e (e.id)}
                <section class="entry" data-entry={e.id}>
                    <h4 class="entry-ref">
                        <span>{e.heading ?? label(e)}</span>
                        {#if e.source}
                            <a href={sourceLocatorUrl(e.source)} target="_blank" rel="noopener noreferrer">{e.source.pageStart ? `p. ${e.source.pageStart}${e.source.pageEnd && e.source.pageEnd !== e.source.pageStart ? `-${e.source.pageEnd}` : ''}` : 'Scan'}</a>
                        {/if}
                    </h4>
                    <CommentaryContent content={e.content} excerpts={e.excerpts} source={e.source} />
                </section>
            {/each}
        </DatasetGate>
    {/if}
</div>

<style>
    .commentary-panel { padding: var(--space-3) var(--space-4) var(--space-6); }
    .resource h3 { margin: 0; font-size: var(--font-size-base, 1rem); font-weight: 600; }
    .byline, .note { margin: var(--space-1) 0 0; font-size: 0.75rem; color: var(--color-text-secondary); }
    .provenance-note { margin: var(--space-3) 0; padding: var(--space-2) var(--space-3); border-left: 2px solid var(--color-border); }
    .resource { margin-bottom: var(--space-3); }
    .resource-pick { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); font-size: 0.75rem; color: var(--color-text-secondary); }
    .entry { margin-top: var(--space-4); padding-top: var(--space-3); border-top: 1px solid var(--color-border); }
    .entry-ref { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-2); margin: 0 0 var(--space-2); font-family: var(--font-mono, monospace); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.02em; color: var(--color-text-secondary); }
    a { color: var(--color-accent); text-decoration: underline; text-underline-offset: 2px; }
</style>
