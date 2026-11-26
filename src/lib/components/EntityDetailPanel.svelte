<script lang="ts">
    import { tick } from 'svelte';
    import { goto } from '$app/navigation';
    import type { Person, Place, BibleEvent, DictionaryEntry } from '@codex-scriptura/core';
    import PlaceMap from './PlaceMap.svelte';
    import DictDefinition from '$lib/components/DictDefinition.svelte';
    import { verseHover } from '$lib/actions/verseHover';
    import { preferences } from '$lib/stores/preferences.svelte';
    import { translationLibrary } from '$lib/stores/translationLibrary.svelte';
    import { truncateDefinition } from '$lib/utils/dictionary';
    import { appearanceSummary, dictionaryTitle, groupRefsByBook, sourceCredits } from '$lib/utils/entityFacts';

    type SelectedEntity =
        | { type: 'person'; data: Person }
        | { type: 'place'; data: Place }
        | { type: 'event'; data: BibleEvent };

    let {
        entity,
        bookId,
        chapter,
        chapterVerseNums,
        dictEntry,
        translationId = 'KJV',
        hasFamilyLinks = false,
        onScrollToVerse,
        onGenealogyRequested,
        onNavigateToRef,
    }: {
        entity: SelectedEntity;
        bookId: string;
        chapter: number;
        chapterVerseNums: number[];
        /** Superseded by the per-book appearances list; still passed by ReaderPane. */
        otherRefCount?: number;
        dictEntry: DictionaryEntry | null;
        translationId?: string;
        /** Person is in the genealogy graph; gates the Family tree button */
        hasFamilyLinks?: boolean;
        onScrollToVerse: (v: number) => void;
        onGenealogyRequested?: (id: string) => void;
        /** Navigate the reader to a scripture ref (appearance rows and refs in the description) */
        onNavigateToRef?: (book: string, chapter: number, verse: number) => void;
    } = $props();

    /** Characters of description shown before "Read more". */
    const DESCRIPTION_BUDGET = 600;
    /** Books listed before "Show all"; lists only a little longer are shown whole. */
    const BOOK_CAP = 8;

    const uid = $props.id();
    const entityKey = $derived(`${entity.type}:${entity.data.id}`);

    function confidenceLabel(c: number | undefined): 'certain' | 'probable' | 'possible' | 'uncertain' {
        if (c === undefined) return 'uncertain';
        if (c >= 0.9) return 'certain';
        if (c >= 0.7) return 'probable';
        if (c >= 0.5) return 'possible';
        return 'uncertain';
    }

    function formatEventYear(raw: string | undefined): string | null {
        if (!raw) return null;
        const year = parseInt(raw, 10);
        if (isNaN(year)) return null;
        if (year < 0) return `~${Math.abs(year)} BC`;
        return `AD ${year}`;
    }

    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

    const nameMeaning = $derived(entity.type === 'person' && entity.data.nameMeaning ? capitalize(entity.data.nameMeaning) : null);
    const coords = $derived(
        entity.type === 'place' && entity.data.lat !== undefined && entity.data.lng !== undefined
            ? { lat: entity.data.lat, lng: entity.data.lng }
            : null,
    );
    const certainty = $derived.by(() => {
        if (entity.type !== 'place' || entity.data.confidence === undefined) return null;
        const c = confidenceLabel(entity.data.confidence);
        return c === 'certain' ? null : c;
    });
    const eventYear = $derived(entity.type === 'event' ? formatEventYear(entity.data.date) : null);

    const books = $derived(groupRefsByBook(entity.data.verseRefs));
    let allBooksFor = $state<string | null>(null);
    const showAllBooks = $derived(allBooksFor === entityKey);
    const bookListCapped = $derived(books.length > BOOK_CAP + 2);
    const shownBooks = $derived(bookListCapped && !showAllBooks ? books.slice(0, BOOK_CAP) : books);

    // Places without their own description fall back to the dictionary entry for the name.
    const fromDictionaryTable = $derived(entity.type === 'place' && !entity.data.description && !!dictEntry);
    const description = $derived(entity.data.description ?? (fromDictionaryTable ? dictEntry?.definition : undefined) ?? null);
    const preview = $derived(description ? truncateDefinition(description, DESCRIPTION_BUDGET) : null);
    let expandedFor = $state<string | null>(null);
    const expanded = $derived(expandedFor === entityKey);
    let toggleBtn = $state<HTMLButtonElement>();

    async function toggleDescription() {
        if (!expanded) {
            expandedFor = entityKey;
            return;
        }
        expandedFor = null;
        await tick();
        toggleBtn?.scrollIntoView({ block: 'nearest' });
        toggleBtn?.focus();
    }

    const credits = $derived.by(() => {
        const list = sourceCredits(entity.data.sources, translationLibrary.resources, entity.type !== 'event');
        const title = fromDictionaryTable ? dictionaryTitle(translationLibrary.resources) : null;
        return title ? [...list, { fields: ['description'], name: title }] : list;
    });
    const meaningSource = $derived(credits.find((c) => c.fields.includes('name meaning'))?.name ?? null);

    const graphHref = $derived(`/graph?${entity.type}=${entity.data.id}`);
    const previewTranslation = $derived(preferences.value?.activeTranslation ?? 'KJV');
</script>

<!-- The rail header carries the name and the kind; the panel starts with
     what is known about the entity. Every section renders only when it has
     data, and the rule between sections comes from the one before it. -->
<div class="panel">
    {#if nameMeaning || coords || certainty || eventYear || books.length > 0}
        <section class="section">
            <dl class="facts">
                {#if nameMeaning}
                    <div class="fact">
                        <dt class="data-label">Name meaning</dt>
                        <dd>
                            “{nameMeaning}”
                            {#if meaningSource}<span class="fact-note">{meaningSource}</span>{/if}
                        </dd>
                    </div>
                {/if}
                {#if coords}
                    <div class="fact">
                        <dt class="data-label">Coordinates</dt>
                        <dd class="mono">{coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}</dd>
                    </div>
                {/if}
                {#if certainty}
                    <div class="fact">
                        <dt class="data-label">Location</dt>
                        <dd>{capitalize(certainty)}</dd>
                    </div>
                {/if}
                {#if eventYear}
                    <div class="fact">
                        <dt class="data-label">Date</dt>
                        <dd>{eventYear}</dd>
                    </div>
                {/if}
                {#if books.length > 0}
                    <div class="fact">
                        <dt class="data-label">Appears in</dt>
                        <dd>{appearanceSummary(books)}</dd>
                    </div>
                {/if}
            </dl>
            {#if coords && entity.type === 'place'}
                <div class="map"><PlaceMap lat={coords.lat} lng={coords.lng} name={entity.data.name} /></div>
            {/if}
        </section>
    {/if}

    {#if chapterVerseNums.length > 0}
        <section class="section" aria-labelledby="{uid}-chapter">
            <h3 class="data-label section-label" id="{uid}-chapter">In this chapter</h3>
            <div class="verse-refs">
                {#each chapterVerseNums as vNum (vNum)}
                    <button
                        class="verse-pill"
                        aria-label="Verse {vNum}"
                        use:verseHover={{ osisId: `${bookId}.${chapter}.${vNum}`, translationId: previewTranslation }}
                        onclick={() => onScrollToVerse(vNum)}>v.{vNum}</button>
                {/each}
            </div>
        </section>
    {/if}

    {#if books.length > 0}
        <section class="section" aria-labelledby="{uid}-books">
            <h3 class="data-label section-label" id="{uid}-books">Appearances</h3>
            <ul class="books" id="{uid}-book-list">
                {#each shownBooks as g (g.book)}
                    <li>
                        <button
                            class="book-row"
                            aria-label="{g.name}, {g.count} {g.count === 1 ? 'verse' : 'verses'}. Go to {g.name} {g.first.chapter}:{g.first.verse}"
                            use:verseHover={{ osisId: `${g.book}.${g.first.chapter}.${g.first.verse}`, translationId: previewTranslation }}
                            onclick={() => onNavigateToRef?.(g.book, g.first.chapter, g.first.verse)}
                        >
                            <span class="book-name">{g.name}</span>
                            <span class="book-first">{g.first.chapter}:{g.first.verse}</span>
                            <span class="book-count">{g.count}</span>
                        </button>
                    </li>
                {/each}
            </ul>
            {#if bookListCapped}
                <button
                    class="text-toggle"
                    aria-expanded={showAllBooks}
                    aria-controls="{uid}-book-list"
                    onclick={() => (allBooksFor = showAllBooks ? null : entityKey)}
                >{showAllBooks ? 'Show fewer books' : `Show all ${books.length} books`}</button>
            {/if}
        </section>
    {/if}

    {#if description && preview}
        <section class="section" aria-labelledby="{uid}-desc">
            <h3 class="data-label section-label" id="{uid}-desc">{entity.type === 'event' ? 'Notes' : 'Description'}</h3>
            <div class="description" id="{uid}-desc-body">
                <DictDefinition definition={expanded ? description : preview.text} {translationId} onNavigate={onNavigateToRef} />
            </div>
            {#if preview.truncated}
                <button
                    bind:this={toggleBtn}
                    class="text-toggle"
                    aria-expanded={expanded}
                    aria-controls="{uid}-desc-body"
                    onclick={toggleDescription}
                >{expanded ? 'Show less' : 'Read more'}</button>
            {/if}
        </section>
    {/if}

    <section class="section actions">
        {#if entity.type === 'person' && hasFamilyLinks}
            <button class="action-primary" onclick={() => onGenealogyRequested?.(entity.data.id)}>Family tree</button>
        {/if}
        <button class="action-default" onclick={() => goto(graphHref)}>View in graph</button>
    </section>

    {#if credits.length > 0}
        <section class="section sources" aria-labelledby="{uid}-sources">
            <h3 class="data-label section-label" id="{uid}-sources">Sources</h3>
            <ul>
                {#each credits as c (c.name + (c.via ?? ''))}
                    <li>{capitalize(c.fields.join(', '))}: {c.name}{c.via ? `, via ${c.via}` : ''}</li>
                {/each}
            </ul>
        </section>
    {/if}
</div>

<style>
    .panel {
        position: relative;
        padding: var(--space-4);
        height: 100%;
        box-sizing: border-box;
        overflow-y: auto;
    }

    .section + .section {
        border-top: 1px solid var(--color-border-subtle);
        margin-top: var(--space-4);
        padding-top: var(--space-4);
    }
    .section-label {
        display: block;
        margin: 0 0 var(--space-2);
    }

    .facts {
        display: grid;
        grid-template-columns: max-content 1fr;
        column-gap: var(--space-4);
        row-gap: var(--space-2);
        margin: 0;
    }
    .fact {
        display: contents;
    }
    .facts dt {
        line-height: 1.6;
        padding-top: 2px;
    }
    .facts dd {
        margin: 0;
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: var(--color-text-primary);
        min-width: 0;
    }
    .facts .mono {
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        line-height: 1.8;
    }
    .fact-note {
        display: block;
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
    }
    .map {
        margin-top: var(--space-3);
    }

    .verse-refs {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-1);
    }
    .verse-pill {
        background: none;
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-pill);
        padding: 1px 8px;
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        color: var(--color-accent);
        cursor: pointer;
        transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
        white-space: nowrap;
    }
    .verse-pill:hover {
        background: var(--color-accent);
        border-color: var(--color-accent);
        color: var(--color-on-accent);
    }

    .books {
        list-style: none;
        margin: 0;
        padding: 0;
    }
    .book-row {
        display: flex;
        align-items: baseline;
        gap: var(--space-2);
        width: 100%;
        padding: var(--space-1) var(--space-2);
        box-sizing: border-box;
        background: none;
        border: none;
        border-radius: var(--radius-sm);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
        text-align: left;
        cursor: pointer;
        transition: background var(--transition-fast);
    }
    /* Surface, not the hover wash: muted text drops under 4.5:1 on the light wash */
    .book-row:hover {
        background: var(--color-bg-surface);
    }
    .book-row:hover .book-name {
        text-decoration: underline;
    }
    .book-name {
        flex: 1;
        min-width: 0;
    }
    .book-first {
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
    }
    .book-count {
        min-width: 2.5ch;
        text-align: right;
        font-variant-numeric: tabular-nums;
        color: var(--color-text-secondary);
    }

    .description {
        font-size: var(--font-size-sm);
    }
    .description :global(.dict-sense) {
        line-height: 1.65;
    }

    .text-toggle {
        margin-top: var(--space-2);
        padding: 2px 0;
        background: none;
        border: none;
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 500;
        color: var(--color-accent);
        cursor: pointer;
    }
    .text-toggle:hover {
        text-decoration: underline;
    }

    .actions {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }
    .action-primary,
    .action-default {
        display: block;
        width: 100%;
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-sm);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 500;
        cursor: pointer;
        text-align: center;
        transition: background var(--transition-fast);
    }
    .action-default {
        background: var(--color-bg-hover);
        border: 1px solid var(--color-border-control);
        color: var(--color-text-secondary);
    }
    .action-default:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-surface);
    }
    .action-primary {
        background: var(--color-accent-subtle);
        border: 1px solid color-mix(in srgb, var(--color-accent) 35%, transparent);
        /* Accent text on the accent tint measures 4.4:1 in light */
        color: var(--color-text-primary);
    }
    .action-primary:hover { background: color-mix(in srgb, var(--color-accent) 24%, transparent); }

    .sources ul {
        list-style: none;
        margin: 0;
        padding: 0;
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        line-height: 1.5;
        color: var(--color-text-muted);
    }
    .sources li + li {
        margin-top: var(--space-1);
    }
</style>
