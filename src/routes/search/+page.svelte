<script lang="ts">
    import { onMount } from 'svelte';
    import { db } from '@codex-scriptura/db';
    import { findBook } from '@codex-scriptura/core';
    import type { VerseRecord } from '@codex-scriptura/core';
    import MiniSearch from 'minisearch';

    let query = $state('');
    let results = $state<VerseRecord[]>([]);
    let searchIndex = $state<MiniSearch<VerseRecord> | null>(null);
    let searching = $state(false);
    let indexed = $state(false);
    let totalVerses = $state(0);
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    async function buildIndex() {
        const allVerses = await db.verses.where('translationId').equals('KJV').toArray();
        totalVerses = allVerses.length;

        const idx = new MiniSearch<VerseRecord>({
            fields: ['text'],
            storeFields: ['id', 'translationId', 'book', 'chapter', 'verse', 'osisId', 'text'],
            idField: 'id',
            searchOptions: {
                prefix: true,
                fuzzy: 0.2,
                boost: { text: 1 },
            },
        });

        idx.addAll(allVerses);
        searchIndex = idx;
        indexed = true;
    }

    function handleInput() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => doSearch(), 150);
    }

    function doSearch() {
        if (!searchIndex || !query.trim()) {
            results = [];
            return;
        }

        searching = true;
        const raw = searchIndex.search(query.trim()).slice(0, 50);
        results = raw.map((r) => ({
            id: r.id as string,
            translationId: r.translationId as string,
            book: r.book as string,
            chapter: r.chapter as number,
            verse: r.verse as number,
            osisId: r.osisId as string,
            text: r.text as string,
        }));
        searching = false;
    }

    function getBookName(bookId: string): string {
        return findBook(bookId)?.name ?? bookId;
    }

    function highlightMatch(text: string, q: string): string {
        if (!q.trim()) return text;
        const words = q.trim().split(/\s+/).filter(w => w.length > 1);
        if (words.length === 0) return text;
        const pattern = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
        return text.replace(pattern, '<mark>$1</mark>');
    }

    onMount(() => {
        buildIndex();
    });
</script>

<svelte:head>
    <title>Search — Codex Scriptura</title>
</svelte:head>

<div class="search-page">
    <div class="search-container">
        <div class="search-header">
            <h1 class="search-title">Search Scripture</h1>
            <div class="search-input-wrap">
                <svg class="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                </svg>
                <input
                    type="text"
                    class="search-input"
                    placeholder={indexed ? `Search ${totalVerses.toLocaleString()} verses…` : 'Building index…'}
                    bind:value={query}
                    oninput={handleInput}
                    disabled={!indexed}
                    id="search-input"
                />
                {#if query}
                    <button class="search-clear" onclick={() => { query = ''; results = []; }} aria-label="Clear search">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                {/if}
            </div>
            {#if query && results.length > 0}
                <p class="search-meta">{results.length} results{results.length >= 50 ? ' (showing top 50)' : ''}</p>
            {/if}
        </div>

        <div class="search-results">
            {#if !indexed}
                <div class="search-state">
                    <div class="loading-spinner"></div>
                    <p>Building search index…</p>
                </div>
            {:else if !query}
                <div class="search-state">
                    <p class="search-hint">Type to search across all verses</p>
                </div>
            {:else if results.length === 0 && !searching}
                <div class="search-state">
                    <p>No results for "{query}"</p>
                </div>
            {:else}
                {#each results as verse}
                    <a href="/read?book={verse.book}&chapter={verse.chapter}#{`verse-${verse.verse}`}" class="result-card" id="result-{verse.osisId}">
                        <div class="result-ref">
                            <span class="result-book">{getBookName(verse.book)}</span>
                            <span class="result-cv">{verse.chapter}:{verse.verse}</span>
                        </div>
                        <p class="result-text">{@html highlightMatch(verse.text, query)}</p>
                    </a>
                {/each}
            {/if}
        </div>
    </div>
</div>

<style>
    .search-page {
        display: flex;
        justify-content: center;
        min-height: 100vh;
        padding: var(--space-8) var(--space-6);
    }

    .search-container {
        width: 100%;
        max-width: 680px;
    }

    .search-header {
        margin-bottom: var(--space-6);
    }

    .search-title {
        font-size: var(--font-size-2xl);
        font-weight: 700;
        margin-bottom: var(--space-4);
    }

    .search-input-wrap {
        position: relative;
        display: flex;
        align-items: center;
    }

    .search-icon {
        position: absolute;
        left: var(--space-4);
        color: var(--color-text-muted);
        pointer-events: none;
    }

    .search-input {
        width: 100%;
        padding: var(--space-3) var(--space-4);
        padding-left: 48px;
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-base);
        outline: none;
        transition: all var(--transition-fast);
    }
    .search-input:focus {
        border-color: var(--color-accent);
        box-shadow: var(--shadow-glow);
    }
    .search-input::placeholder {
        color: var(--color-text-muted);
    }
    .search-input:disabled {
        opacity: 0.6;
    }

    .search-clear {
        position: absolute;
        right: var(--space-3);
        background: none;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        padding: var(--space-1);
        border-radius: var(--radius-sm);
        display: flex;
        transition: color var(--transition-fast);
    }
    .search-clear:hover { color: var(--color-text-primary); }

    .search-meta {
        margin-top: var(--space-2);
        font-size: var(--font-size-sm);
        color: var(--color-text-muted);
    }

    /* ─── Results ───────────────────────────────────── */
    .search-results {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .search-state {
        text-align: center;
        padding: var(--space-12) 0;
        color: var(--color-text-muted);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-3);
    }
    .loading-spinner {
        width: 32px;
        height: 32px;
        border: 2px solid var(--color-border);
        border-top-color: var(--color-accent);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .search-hint {
        font-size: var(--font-size-sm);
    }

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

    .result-text {
        font-family: var(--font-scripture);
        font-size: var(--font-size-base);
        color: var(--color-text-secondary);
        line-height: 1.6;
    }
    .result-text :global(mark) {
        background: var(--color-search-highlight);
        color: var(--color-text-primary);
        border-radius: 2px;
        padding: 0 2px;
    }
</style>
