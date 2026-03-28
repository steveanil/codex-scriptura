<script lang="ts">
    import type { Person, Place, BibleEvent, DictionaryEntry } from '@codex-scriptura/core';

    type SelectedEntity =
        | { type: 'person'; data: Person }
        | { type: 'place'; data: Place }
        | { type: 'event'; data: BibleEvent };

    let {
        entity,
        chapterVerseNums,
        otherRefCount,
        dictEntry,
        onScrollToVerse,
        onClose,
        onMapRequested,
        onAllVersesRequested,
        onGenealogyRequested,
    }: {
        entity: SelectedEntity;
        chapterVerseNums: number[];
        otherRefCount: number;
        dictEntry: DictionaryEntry | null;
        onScrollToVerse: (v: number) => void;
        onClose: () => void;
        onMapRequested?: () => void;
        onAllVersesRequested?: () => void;
        onGenealogyRequested?: (id: string) => void;
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
</script>

<div class="panel">
    <button class="close-btn" onclick={onClose} aria-label="Close">×</button>

    {#if entity.type === 'person'}
        <span class="type-label person-label">Person</span>
        <h2 class="entity-name">{entity.data.name}</h2>
        {#if entity.data.nameMeaning}
            <div class="name-meaning-section">
                <p class="name-meaning">Meaning: "{entity.data.nameMeaning.charAt(0).toUpperCase() + entity.data.nameMeaning.slice(1)}"</p>
                {#if entity.data.nameMeaningSource === 'bibledata'}
                    <span class="meaning-source">Source: BibleData</span>
                {/if}
            </div>
        {/if}
        {#if entity.data.description}
            <p class="entity-role">{entity.data.description}</p>
        {/if}

        {#if chapterVerseNums.length > 0}
        <div class="verse-refs">
            {#each chapterVerseNums as vNum}
            <button class="verse-pill" onclick={() => onScrollToVerse(vNum)}>v.{vNum}</button>
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
            <button class="action-primary person-primary" onclick={() => onGenealogyRequested?.(entity.data.id)}>Family tree</button>
            <button class="action-default" onclick={() => onAllVersesRequested?.()}>All verses</button>
        </div>

    {:else if entity.type === 'place'}
        <span class="type-label place-label">Place</span>
        <h2 class="entity-name">{entity.data.name}</h2>
        {#if entity.data.lat !== undefined && entity.data.lng !== undefined}
            <span class="coords">{entity.data.lat.toFixed(4)}, {entity.data.lng.toFixed(4)}</span>
        {/if}
        {#if entity.data.confidence !== undefined}
            {@const conf = confidenceLabel(entity.data.confidence)}
            {#if conf !== 'certain'}
            <span class="confidence-badge badge-{conf}">{conf}</span>
            {/if}
        {/if}

        {#if chapterVerseNums.length > 0}
        <div class="verse-refs">
            {#each chapterVerseNums as vNum}
            <button class="verse-pill" onclick={() => onScrollToVerse(vNum)}>v.{vNum}</button>
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
            <span class="dict-label">From Easton's</span>
            <p class="dict-def">{entity.data.description}</p>
        </div>
        {:else if dictEntry}
        <div class="dict-section">
            <span class="dict-label">From Easton's</span>
            <p class="dict-def">{dictEntry.definition}</p>
        </div>
        {/if}

        <div class="actions">
            <button class="action-primary place-primary" onclick={() => onMapRequested?.()}>View on map</button>
            <button class="action-default" onclick={() => onAllVersesRequested?.()}>All verses</button>
        </div>

    {:else if entity.type === 'event'}
        <span class="type-label event-label">Event</span>
        <h2 class="entity-name">{entity.data.name}</h2>
        {#if entity.data.date}
            {@const yr = formatEventYear(entity.data.date)}
            {#if yr}<span class="event-year">{yr}</span>{/if}
        {/if}

        {#if chapterVerseNums.length > 0}
        <div class="verse-refs">
            {#each chapterVerseNums as vNum}
            <button class="verse-pill" onclick={() => onScrollToVerse(vNum)}>v.{vNum}</button>
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
            <button class="action-default" onclick={() => onAllVersesRequested?.()}>All verses</button>
        </div>
    {/if}
</div>

<style>
    .panel {
        position: relative;
        padding: var(--space-5) var(--space-4);
        height: 100%;
        box-sizing: border-box;
        overflow-y: auto;
        animation: slideIn 180ms ease-out;
    }

    @keyframes slideIn {
        from { transform: translateX(100%); }
        to { transform: translateX(0); }
    }

    .close-btn {
        position: absolute;
        top: var(--space-3);
        right: var(--space-3);
        background: none;
        border: none;
        cursor: pointer;
        color: var(--color-text-muted);
        font-size: var(--font-size-base);
        line-height: 1;
        padding: 2px var(--space-1);
        border-radius: 4px;
        transition: color var(--transition-fast), background var(--transition-fast);
    }
    .close-btn:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
    }

    .type-label {
        display: block;
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        margin-bottom: var(--space-1);
    }
    .person-label { color: #185FA5; }
    .place-label  { color: #0F6E56; }
    .event-label  { color: #854F0B; }

    .entity-name {
        font-family: var(--font-ui);
        font-size: 16px;
        font-weight: 500;
        color: var(--color-text-primary);
        margin: 0 0 var(--space-2);
        padding-right: var(--space-6);
        line-height: 1.3;
    }

    .name-meaning-section {
        margin: 0 0 var(--space-3);
    }

    .name-meaning {
        font-size: 12px;
        font-style: italic;
        color: var(--color-text-muted);
        margin: 0 0 var(--space-1);
        line-height: 1.4;
    }

    .meaning-source {
        display: block;
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-muted);
        opacity: 0.6;
    }

    .entity-role {
        font-size: 12px;
        color: var(--color-text-secondary);
        line-height: 1.5;
        margin: 0 0 var(--space-3);
    }

    .coords {
        display: block;
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--color-text-muted);
        margin-bottom: var(--space-2);
    }

    .confidence-badge {
        display: inline-block;
        font-family: var(--font-ui);
        font-size: 11px;
        font-weight: 500;
        padding: 1px 8px;
        border-radius: 9999px;
        margin-bottom: var(--space-3);
    }
    .badge-probable  { background: #FAEEDA; color: #633806; }
    .badge-possible,
    .badge-uncertain { background: var(--color-bg-hover); color: var(--color-text-muted); }

    .event-year {
        display: block;
        font-size: 11px;
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
        border: 1px solid var(--color-border);
        border-radius: 9999px;
        padding: 1px 8px;
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--color-accent);
        cursor: pointer;
        transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
        white-space: nowrap;
    }
    .verse-pill:hover {
        background: var(--color-accent);
        border-color: var(--color-accent);
        color: #fff;
    }
    .refs-more {
        font-family: var(--font-ui);
        font-size: 11px;
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
    }
    .dict-label {
        display: block;
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-muted);
        margin-bottom: var(--space-2);
    }
    .dict-def {
        font-size: 12px;
        color: var(--color-text-secondary);
        line-height: 1.6;
        margin: 0;
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
        border: 1px solid var(--color-border);
        color: var(--color-text-secondary);
    }
    .action-default:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-surface);
    }
    .place-primary {
        background: rgba(15, 110, 86, 0.12);
        border: 1px solid rgba(15, 110, 86, 0.3);
        color: #0F6E56;
    }
    .place-primary:hover { background: rgba(15, 110, 86, 0.22); }
    .person-primary {
        background: rgba(24, 95, 165, 0.12);
        border: 1px solid rgba(24, 95, 165, 0.3);
        color: #185FA5;
    }
    .person-primary:hover { background: rgba(24, 95, 165, 0.22); }
</style>
