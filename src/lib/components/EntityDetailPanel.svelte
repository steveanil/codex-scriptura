<script lang="ts">
    import { goto } from '$app/navigation';
    import type { Person, Place, BibleEvent, DictionaryEntry } from '@codex-scriptura/core';
    import PlaceMap from './PlaceMap.svelte';

    type SelectedEntity =
        | { type: 'person'; data: Person }
        | { type: 'place'; data: Place }
        | { type: 'event'; data: BibleEvent };

    let {
        entity,
        bookId,
        chapter,
        chapterVerseNums,
        otherRefCount,
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
        otherRefCount: number;
        dictEntry: DictionaryEntry | null;
        translationId?: string;
        /** Person is in the genealogy graph; gates the Family tree button */
        hasFamilyLinks?: boolean;
        onScrollToVerse: (v: number) => void;
        onGenealogyRequested?: (id: string) => void;
        /** Navigate the reader to a scripture ref cited in Easton's text */
        onNavigateToRef?: (book: string, chapter: number, verse: number) => void;
    } = $props();

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

    import { verseHover } from '$lib/actions/verseHover';
    import { preferences } from '$lib/stores/preferences.svelte';
    import DictDefinition from '$lib/components/DictDefinition.svelte';
</script>

<!-- The rail header carries the name and the kind; the panel starts with
     what is known about the entity. -->
<div class="panel">
    {#if entity.type === 'person'}
        {#if entity.data.nameMeaning}
            <div class="name-meaning-section">
                <p class="name-meaning">Meaning: "{entity.data.nameMeaning.charAt(0).toUpperCase() + entity.data.nameMeaning.slice(1)}"</p>
                {#if entity.data.nameMeaningSource === 'bibledata'}
                    <span class="meaning-source">Source: BibleData</span>
                {/if}
            </div>
        {/if}
        {#if entity.data.description}
            <div class="entity-role">
                <DictDefinition definition={entity.data.description} {translationId} onNavigate={onNavigateToRef} />
            </div>
        {/if}

        {#if chapterVerseNums.length > 0}
        <div class="verse-refs">
            {#each chapterVerseNums as vNum}
            <button 
                class="verse-pill" 
                use:verseHover={{ osisId: `${bookId}.${chapter}.${vNum}`, translationId: preferences.value?.activeTranslation ?? 'KJV' }}
                onclick={() => onScrollToVerse(vNum)}>v.{vNum}</button>
            {/each}
            {#if otherRefCount > 0}
            <span class="refs-more">+{otherRefCount} elsewhere</span>
            {/if}
        </div>
        {:else if otherRefCount > 0}
        <div class="verse-refs">
            <span class="refs-more">{otherRefCount} references across the Bible</span>
        </div>
        {/if}

        <hr class="divider">

        <div class="actions">
            {#if hasFamilyLinks}
                <button class="action-primary person-primary" onclick={() => onGenealogyRequested?.(entity.data.id)}>Family tree</button>
            {/if}
            <button class="action-default" onclick={() => goto(`/graph?person=${entity.data.id}`)}>View in graph</button>
        </div>

    {:else if entity.type === 'place'}
        {#if entity.data.lat !== undefined && entity.data.lng !== undefined}
            <span class="coords">{entity.data.lat.toFixed(4)}, {entity.data.lng.toFixed(4)}</span>
        {/if}
        {#if entity.data.confidence !== undefined}
            {@const conf = confidenceLabel(entity.data.confidence)}
            {#if conf !== 'certain'}
            <span class="confidence-badge badge-{conf}">{conf}</span>
            {/if}
        {/if}

        {#if entity.data.lat !== undefined && entity.data.lng !== undefined}
            <PlaceMap lat={entity.data.lat} lng={entity.data.lng} name={entity.data.name} />
        {/if}

        {#if chapterVerseNums.length > 0}
        <div class="verse-refs">
            {#each chapterVerseNums as vNum}
            <button 
                class="verse-pill" 
                use:verseHover={{ osisId: `${bookId}.${chapter}.${vNum}`, translationId: preferences.value?.activeTranslation ?? 'KJV' }}
                onclick={() => onScrollToVerse(vNum)}>v.{vNum}</button>
            {/each}
            {#if otherRefCount > 0}
            <span class="refs-more">+{otherRefCount} elsewhere</span>
            {/if}
        </div>
        {:else if otherRefCount > 0}
        <div class="verse-refs">
            <span class="refs-more">{otherRefCount} references across the Bible</span>
        </div>
        {/if}

        <hr class="divider">

        {#if entity.data.description}
        <div class="dict-section">
            <span class="data-label dict-label">From Easton's</span>
            <DictDefinition definition={entity.data.description} {translationId} onNavigate={onNavigateToRef} />
        </div>
        {:else if dictEntry}
        <div class="dict-section">
            <span class="data-label dict-label">From Easton's</span>
            <DictDefinition definition={dictEntry.definition} {translationId} onNavigate={onNavigateToRef} />
        </div>
        {/if}

        <div class="actions">
            <button class="action-default" onclick={() => goto(`/graph?place=${entity.data.id}`)}>View in graph</button>
        </div>

    {:else if entity.type === 'event'}
        {#if entity.data.date}
            {@const yr = formatEventYear(entity.data.date)}
            {#if yr}<span class="event-year">{yr}</span>{/if}
        {/if}

        {#if chapterVerseNums.length > 0}
        <div class="verse-refs">
            {#each chapterVerseNums as vNum}
            <button 
                class="verse-pill" 
                use:verseHover={{ osisId: `${bookId}.${chapter}.${vNum}`, translationId: preferences.value?.activeTranslation ?? 'KJV' }}
                onclick={() => onScrollToVerse(vNum)}>v.{vNum}</button>
            {/each}
            {#if otherRefCount > 0}
            <span class="refs-more">+{otherRefCount} elsewhere</span>
            {/if}
        </div>
        {:else if otherRefCount > 0}
        <div class="verse-refs">
            <span class="refs-more">{otherRefCount} references across the Bible</span>
        </div>
        {/if}

        <hr class="divider">

        <div class="actions">
            <button class="action-default" onclick={() => goto(`/graph?event=${entity.data.id}`)}>View in graph</button>
        </div>
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

    .name-meaning-section {
        margin: 0 0 var(--space-3);
    }

    .name-meaning {
        font-size: var(--font-size-xs);
        font-style: italic;
        color: var(--color-text-muted);
        margin: 0 0 var(--space-1);
        line-height: 1.4;
    }

    .meaning-source {
        display: block;
        font-family: var(--font-ui);
        font-size: var(--font-size-2xs);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-muted);
        opacity: 0.6;
    }

    .entity-role {
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        line-height: 1.5;
        margin: 0 0 var(--space-3);
    }

    .coords {
        display: block;
        font-family: var(--font-mono);
        font-size: var(--font-size-2xs);
        color: var(--color-text-muted);
        margin-bottom: var(--space-2);
    }

    .confidence-badge {
        display: inline-block;
        font-family: var(--font-ui);
        font-size: var(--font-size-2xs);
        font-weight: 500;
        padding: 1px 8px;
        border-radius: var(--radius-pill);
        margin-bottom: var(--space-3);
    }
    .badge-probable  { background: #FAEEDA; color: #633806; }
    .badge-possible,
    .badge-uncertain { background: var(--color-bg-hover); color: var(--color-text-muted); }

    .event-year {
        display: block;
        font-size: var(--font-size-2xs);
        color: var(--color-text-muted);
        margin-bottom: var(--space-3);
    }

    .verse-refs {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-1);
        margin-bottom: var(--space-3);
    }
    .verse-pill {
        background: none;
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-pill);
        padding: 1px 8px;
        font-family: var(--font-ui);
        font-size: var(--font-size-2xs);
        color: var(--color-accent);
        cursor: pointer;
        transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
        white-space: nowrap;
    }
    .verse-pill:hover {
        background: var(--color-accent);
        border-color: var(--color-accent);
        color: var(--color-on-accent, #fff);
    }
    .refs-more {
        font-family: var(--font-ui);
        font-size: var(--font-size-2xs);
        color: var(--color-text-muted);
        white-space: nowrap;
    }

    .divider {
        border: none;
        border-top: 1px solid var(--color-border-subtle);
        margin: var(--space-3) 0;
    }

    .dict-section {
        margin-bottom: var(--space-4);
        font-size: var(--font-size-xs);
    }
    .dict-label {
        display: block;
        margin-bottom: var(--space-2);
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
    .person-primary {
        background: var(--color-accent-subtle);
        border: 1px solid color-mix(in srgb, var(--color-accent) 35%, transparent);
        color: var(--color-accent);
    }
    .person-primary:hover { background: color-mix(in srgb, var(--color-accent) 24%, transparent); }
</style>
