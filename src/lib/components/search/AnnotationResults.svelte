<script lang="ts">
    import { untrack } from 'svelte';
    import { observeAllAnnotations } from '@codex-scriptura/db';
    import { escapeHtml, parseOsisId } from '@codex-scriptura/core';
    import type { Annotation } from '@codex-scriptura/core';
    import { preferences } from '$lib/stores/preferences.svelte';
    import { markMatches } from '$lib/search/highlight';
    import {
        annotationQueryPattern,
        isSearchableAnnotation,
        loadAnnotationVerses,
        parseAnnotationQuery,
        searchAnnotations,
        type AnnotationHit,
        type AnnotationKind,
        type AnnotationOrder,
        type AnnotationVerses,
    } from '$lib/search/annotations';
    import type { Testament } from '$lib/search/fulltext';
    import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
    import type { SegmentOption } from '$lib/components/ui/segmented';
    import EmptyState from '$lib/components/ui/EmptyState.svelte';
    import SearchStatus from './SearchStatus.svelte';
    import VerseResultCard from './VerseResultCard.svelte';

    /**
     * Annotations mode (issue #47): the user's notes, highlights and theme
     * tags that match the query; an empty query lists them all. The list
     * follows the database live. The shell bumps `seq` when the query or
     * testament should be applied.
     */
    let { query, testament, seq }: { query: string; testament: Testament; seq: number } = $props();

    type KindFilter = 'all' | AnnotationKind;
    const KIND_LABELS: Record<AnnotationKind, string> = { note: 'Note', highlight: 'Highlight', theme: 'Theme tag' };
    const PLURALS: Record<KindFilter, string> = { all: 'annotations', note: 'notes', highlight: 'highlights', theme: 'theme tags' };

    let annotations = $state.raw<Annotation[] | null>(null);
    let verses = $state.raw(new Map<string, AnnotationVerses>());
    let versesLoaded = $state(false);
    let applied = $state<{ query: string; testament: Testament }>({ query: '', testament: 'all' });
    let kind = $state<KindFilter>('all');
    let order = $state<AnnotationOrder>('canonical');
    let generation = 0;
    // Pages like Word Study: three thousand cards take ~400 ms to render
    const PAGE_SIZE = 50;
    let visible = $state(PAGE_SIZE);

    $effect(() => {
        void seq;
        untrack(() => {
            applied = { query, testament };
            visible = PAGE_SIZE;
        });
    });

    $effect(() => {
        const sub = observeAllAnnotations().subscribe({
            next: (list) => { annotations = list; },
            error: (err) => console.error('Annotations live query failed', err),
        });
        return () => sub.unsubscribe();
    });

    // Verse text for highlights and theme tags, re-read when the records or
    // the reader's translation change
    let activeTranslation = $derived(preferences.value?.activeTranslation);
    $effect(() => {
        const list = annotations;
        const translation = activeTranslation;
        if (!list) return;
        untrack(() => { void hydrate(list, translation); });
    });

    async function hydrate(list: Annotation[], translation: string | undefined) {
        const gen = ++generation;
        try {
            const loaded = await loadAnnotationVerses(list, translation);
            if (gen === generation) verses = loaded;
        } catch (err) {
            console.error('Loading annotation verses failed', err);
        } finally {
            if (gen === generation) versesLoaded = true;
        }
    }

    let anyAnnotations = $derived(annotations?.some(isSearchableAnnotation) ?? false);
    let hits = $derived(annotations
        ? searchAnnotations(annotations, verses, applied.query, { testament: applied.testament, order })
        : []);
    let counts = $derived.by(() => {
        const c = { all: hits.length, note: 0, highlight: 0, theme: 0 };
        for (const h of hits) c[h.kind]++;
        return c;
    });
    let shown = $derived(kind === 'all' ? hits : hits.filter((h) => h.kind === kind));
    let pattern = $derived(annotationQueryPattern(parseAnnotationQuery(applied.query)));

    let kindOptions = $derived<SegmentOption<KindFilter>[]>([
        { value: 'all', label: `All ${counts.all}` },
        { value: 'note', label: `Notes ${counts.note}` },
        { value: 'highlight', label: `Highlights ${counts.highlight}` },
        { value: 'theme', label: `Theme tags ${counts.theme}` },
    ]);
    const ORDER_OPTIONS: SegmentOption<AnnotationOrder>[] = [
        { value: 'canonical', label: 'Bible order' },
        { value: 'recent', label: 'Recent', title: 'Most recently modified first' },
    ];

    function textOf(hit: AnnotationHit): string {
        return hit.kind === 'note' ? hit.annotation.data : hit.verses?.text ?? '';
    }

    function html(hit: AnnotationHit): string {
        const text = textOf(hit);
        return pattern ? markMatches(text, pattern) : escapeHtml(text);
    }

    function cardVerse(a: Annotation) {
        const start = parseOsisId(a.verseStart) ?? { book: a.book, chapter: 1, verse: 1 };
        const end = parseOsisId(a.verseEnd);
        const verseEnd = end && end.chapter === start.chapter ? end.verse : undefined;
        return { ...start, verseEnd };
    }

    function chipTags(hit: AnnotationHit): string[] {
        // A theme's only tag is its slug; the label says the same thing better
        return hit.kind === 'theme' ? [hit.annotation.data] : hit.annotation.tags;
    }
</script>

{#if annotations === null || (!versesLoaded && anyAnnotations)}
    <SearchStatus loading>
        <p>Loading your annotations…</p>
    </SearchStatus>
{:else if !anyAnnotations}
    <EmptyState
        message="Nothing here yet. Select verses in the reader, then pick a highlight colour, Note or Theme from the toolbar."
        action={{ label: 'Open the reader', href: '/read' }}
    />
{:else}
    <div class="annotation-controls">
        <SegmentedControl size="sm" label="Annotation type" options={kindOptions} value={kind} onchange={(v) => { kind = v; visible = PAGE_SIZE; }} />
        <SegmentedControl size="sm" label="Order" options={ORDER_OPTIONS} value={order} onchange={(v) => { order = v; visible = PAGE_SIZE; }} />
    </div>

    {#if shown.length === 0}
        <SearchStatus>
            {#if applied.query.trim()}
                <p>No {PLURALS[kind]} match "{applied.query.trim()}"</p>
            {:else}
                <p>No {PLURALS[kind]} {applied.testament === 'all' ? 'yet' : 'in this testament'}</p>
            {/if}
        </SearchStatus>
    {:else}
        {#each shown.slice(0, visible) as hit (hit.annotation.id)}
            {@const v = cardVerse(hit.annotation)}
            <VerseResultCard
                verse={{ book: v.book, chapter: v.chapter, verse: v.verse, translationId: hit.verses?.translationId ?? '' }}
                verseEnd={v.verseEnd}
                html={html(hit)}
                prose={hit.kind === 'note'}
                showTranslation={hit.kind === 'highlight' && !!hit.verses}
            >
                {#snippet meta()}
                    <span class="kind-chip">
                        {#if hit.kind === 'highlight'}<span class="swatch" style:background={hit.annotation.color ?? hit.annotation.data}></span>{/if}
                        {KIND_LABELS[hit.kind]}
                    </span>
                {/snippet}
                {#snippet footer()}
                    {#if chipTags(hit).length > 0}
                        <div class="tag-row">
                            {#each chipTags(hit) as tag, i (i)}<span class="tag-chip">{tag}</span>{/each}
                        </div>
                    {/if}
                {/snippet}
            </VerseResultCard>
        {/each}
        {#if shown.length > visible}
            <button class="show-more-btn" onclick={() => (visible += PAGE_SIZE)}>
                Show {Math.min(PAGE_SIZE, shown.length - visible)} more · {shown.length - visible} remaining
            </button>
        {/if}
    {/if}
{/if}

<style>
    .annotation-controls {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: var(--space-2);
        margin-bottom: var(--space-2);
    }
    .show-more-btn {
        display: block;
        margin: var(--space-3) auto 0;
        padding: 4px var(--space-3);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-pill);
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 500;
        cursor: pointer;
        transition: all var(--transition-fast);
    }
    .show-more-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }
    .kind-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: var(--font-size-2xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--color-text-muted);
    }
    .swatch {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        border: 1px solid var(--color-border);
    }
    .tag-row {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: var(--space-2);
    }
    .tag-chip {
        padding: 1px var(--space-2);
        background: var(--color-accent-subtle);
        color: var(--color-accent);
        border-radius: var(--radius-pill);
        font-size: var(--font-size-xs);
        font-weight: 500;
    }
</style>
