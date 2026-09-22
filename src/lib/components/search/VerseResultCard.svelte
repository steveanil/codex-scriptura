<script lang="ts">
    import { findBook } from '@codex-scriptura/core';
    import type { VerseRecord } from '@codex-scriptura/core';
    import { readerHref } from '$lib/utils/readerHref';

    /** One verse in a result list, linking into the reader. `html` is the already-highlighted, already-escaped text. */
    let {
        verse,
        html,
        hitCount = 0,
        showTranslation = false,
        id,
    }: {
        verse: Pick<VerseRecord, 'book' | 'chapter' | 'verse' | 'translationId'>;
        html: string;
        hitCount?: number;
        showTranslation?: boolean;
        id?: string;
    } = $props();
</script>

<a href={readerHref(verse.book, verse.chapter, verse.verse)} class="result-card" {id}>
    <div class="result-ref">
        <span class="result-book">{findBook(verse.book)?.name ?? verse.book}</span>
        <span class="result-cv">{verse.chapter}:{verse.verse}</span>
        {#if hitCount > 1}
            <span class="hit-badge">{hitCount}×</span>
        {/if}
        {#if showTranslation}
            <span class="result-translation">{verse.translationId}</span>
        {/if}
    </div>
    <p class="result-text">{@html html}</p>
</a>

<style>
    .result-card {
        display: block;
        padding: var(--space-3) var(--space-4);
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border-subtle);
        border-radius: var(--radius-sm);
        text-decoration: none;
        transition: all var(--transition-fast);
    }
    .result-card:hover {
        background: var(--color-bg-hover);
        border-color: var(--color-border);
        box-shadow: var(--shadow-sm);
    }

    .result-ref {
        display: flex;
        align-items: baseline;
        gap: var(--space-2);
        margin-bottom: var(--space-1);
    }
    .result-book {
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: var(--color-accent);
    }
    .result-cv {
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
        font-weight: 500;
    }
    .hit-badge {
        font-size: var(--font-size-xs);
        font-weight: 700;
        color: var(--color-accent);
        background: var(--color-accent-subtle);
        border-radius: var(--radius-pill);
        padding: 1px 6px;
    }
    .result-translation {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: 1px var(--space-2);
        font-weight: 600;
        margin-left: auto;
    }

    .result-text {
        font-family: var(--font-scripture);
        font-size: var(--font-size-base);
        color: var(--color-text-secondary);
        line-height: 1.6;
    }
    .result-text :global(mark) {
        background: var(--color-search-highlight);
        color: var(--color-text-primary);
        border-radius: var(--radius-xs);
        padding: 0 2px;
    }
</style>
