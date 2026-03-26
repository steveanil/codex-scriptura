<script lang="ts">
    import { onMount } from 'svelte';
    import { db, getTranslations, getSavedSearches, saveSearch, deleteSavedSearch } from '@codex-scriptura/db';
    import { findBook } from '@codex-scriptura/core';
    import type { VerseRecord, Translation, SavedSearch } from '@codex-scriptura/core';
    import MiniSearch from 'minisearch';

    // ── Search state ──────────────────────────────────────
    let query = $state('');
    let results = $state<(VerseRecord & { score: number })[]>([]);
    let searching = $state(false);
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    // ── Translation filter ────────────────────────────────
    let availableTranslations = $state<Translation[]>([]);
    let selectedTranslations = $state<string[]>(['KJV']);
    // Map of translationId → { index, building, ready }
    const indexes = new Map<string, { index: MiniSearch<VerseRecord> | null; building: boolean; ready: boolean }>();

    // ── Testament / book filter ───────────────────────────
    let testamentFilter = $state<'all' | 'OT' | 'NT' | 'AP'>('all');

    // ── Saved searches ────────────────────────────────────
    let savedSearches = $state<SavedSearch[]>([]);

    const STOP_WORDS = new Set(['the','and','of','in','to','a','is','was','that','it','for','his','he','she','her','with','be','not','but','they','shall','unto','upon','from','by','as','all','are','this','them','which','their','were']);

    // ── Index management ──────────────────────────────────
    async function buildIndexForTranslation(translationId: string) {
        const entry = indexes.get(translationId);
        if (entry?.ready || entry?.building) return;

        indexes.set(translationId, { index: null, building: true, ready: false });

        const allVerses = await db.verses.where('translationId').equals(translationId).toArray();

        const idx = new MiniSearch<VerseRecord>({
            fields: ['text'],
            storeFields: ['id', 'translationId', 'book', 'chapter', 'verse', 'osisId', 'text'],
            idField: 'id',
            processTerm: (term) => {
                const t = term.toLowerCase();
                return STOP_WORDS.has(t) ? null : t;
            },
            searchOptions: {
                prefix: true,
                fuzzy: (term) => term.length > 4 ? 0.2 : 0,
                boost: { text: 1 },
            },
        });

        idx.addAll(allVerses);
        indexes.set(translationId, { index: idx, building: false, ready: true });

        // Trigger re-search now that this index is ready
        if (query.trim()) doSearch();
    }

    function isIndexReady(translationId: string) {
        return indexes.get(translationId)?.ready ?? false;
    }

    function isIndexBuilding(translationId: string) {
        return indexes.get(translationId)?.building ?? false;
    }

    let anyIndexBuilding = $derived(selectedTranslations.some(t => isIndexBuilding(t)));
    let allIndexesReady = $derived(selectedTranslations.every(t => isIndexReady(t)));

    // ── Search logic ──────────────────────────────────────
    function handleInput() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(doSearch, 150);
    }

    function doSearch() {
        const qtr = query.trim();
        if (!qtr) { results = []; return; }

        // Make sure indexes are built for all selected translations
        for (const tid of selectedTranslations) {
            if (!indexes.get(tid)?.ready && !indexes.get(tid)?.building) {
                buildIndexForTranslation(tid);
            }
        }

        searching = true;

        // Collect results from all ready indexes
        let merged: (VerseRecord & { score: number })[] = [];
        const qlc = qtr.toLowerCase();

        for (const tid of selectedTranslations) {
            const entry = indexes.get(tid);
            if (!entry?.ready || !entry.index) continue;

            let raw = entry.index.search(qtr);

            // Exact phrase re-ranking
            if (qlc.includes(' ')) {
                raw = raw.map(r => {
                    let boost = 0;
                    const textLc = (r.text as string).toLowerCase();
                    if (textLc.includes(qlc)) {
                        boost += 50;
                    } else {
                        const words = qlc.split(/\s+/).filter(w => !STOP_WORDS.has(w));
                        if (words.length > 1 && words.every(w => textLc.includes(w))) boost += 15;
                    }
                    return { ...r, score: r.score + boost };
                });
                raw.sort((a, b) => b.score - a.score);
            }

            const typed = raw.map(r => ({
                id: r.id as string,
                translationId: r.translationId as string,
                book: r.book as string,
                chapter: r.chapter as number,
                verse: r.verse as number,
                osisId: r.osisId as string,
                text: r.text as string,
                score: r.score,
            }));
            merged = merged.concat(typed);
        }

        // Sort merged results by score descending
        merged.sort((a, b) => b.score - a.score);

        // Apply testament filter
        if (testamentFilter !== 'all') {
            merged = merged.filter(r => findBook(r.book)?.testament === testamentFilter);
        }

        // Slice top 50
        results = merged.slice(0, 50);
        searching = false;
    }

    // ── Translation toggle ────────────────────────────────
    function toggleTranslation(id: string) {
        if (selectedTranslations.includes(id)) {
            if (selectedTranslations.length === 1) return; // Keep at least one
            selectedTranslations = selectedTranslations.filter(t => t !== id);
        } else {
            selectedTranslations = [...selectedTranslations, id];
            buildIndexForTranslation(id);
        }
        if (query.trim()) doSearch();
    }

    // ── Testament filter ──────────────────────────────────
    function setTestamentFilter(f: 'all' | 'OT' | 'NT' | 'AP') {
        testamentFilter = f;
        if (query.trim()) doSearch();
    }

    // ── Saved searches ────────────────────────────────────
    async function handleSave() {
        if (!query.trim()) return;
        const search: SavedSearch = {
            id: crypto.randomUUID(),
            query: query.trim(),
            translationIds: [...selectedTranslations],
            testamentFilter,
            created: Date.now(),
        };
        await saveSearch(search);
        savedSearches = await getSavedSearches();
    }

    async function handleDeleteSaved(id: string) {
        await deleteSavedSearch(id);
        savedSearches = await getSavedSearches();
    }

    function applySavedSearch(s: SavedSearch) {
        query = s.query;
        selectedTranslations = [...s.translationIds];
        testamentFilter = s.testamentFilter;
        // Ensure indexes are built
        for (const tid of selectedTranslations) {
            if (!indexes.get(tid)?.ready && !indexes.get(tid)?.building) {
                buildIndexForTranslation(tid);
            }
        }
        doSearch();
    }

    // ── Highlight ─────────────────────────────────────────
    function highlightMatch(text: string, q: string): string {
        if (!q.trim()) return text;
        const qlc = q.trim().toLowerCase();
        if (text.toLowerCase().includes(qlc)) {
            const pattern = new RegExp(`(${q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            return text.replace(pattern, '<mark>$1</mark>');
        }
        const words = q.trim().split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w.toLowerCase()));
        if (words.length === 0) return text;
        const pattern = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
        return text.replace(pattern, '<mark>$1</mark>');
    }

    function getBookName(bookId: string): string {
        return findBook(bookId)?.name ?? bookId;
    }

    let totalIndexed = $derived(
        selectedTranslations.filter(t => isIndexReady(t)).length
    );

    onMount(async () => {
        availableTranslations = await db.translations.toArray();
        savedSearches = await getSavedSearches();
        buildIndexForTranslation('KJV');
    });
</script>

<svelte:head>
    <title>Search — Codex Scriptura</title>
</svelte:head>

<div class="search-page">
    <div class="search-container">
        <div class="search-header">
            <h1 class="search-title">Search Scripture</h1>

            <!-- Search input -->
            <div class="search-input-wrap">
                <svg class="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                </svg>
                <input
                    type="text"
                    class="search-input"
                    placeholder={allIndexesReady
                        ? `Search across ${selectedTranslations.join(', ')}…`
                        : anyIndexBuilding ? 'Building index…' : 'Loading…'}
                    bind:value={query}
                    oninput={handleInput}
                    id="search-input"
                />
                {#if query}
                    <button class="search-clear" onclick={() => { query = ''; results = []; }} aria-label="Clear search">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                {/if}
                {#if query.trim()}
                    <button class="save-btn" onclick={handleSave} title="Save this search" aria-label="Save search">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                    </button>
                {/if}
            </div>

            <!-- Saved searches -->
            {#if savedSearches.length > 0}
                <div class="saved-searches">
                    <span class="saved-label">Saved:</span>
                    <div class="saved-pills">
                        {#each savedSearches as s}
                            <div class="saved-pill">
                                <button class="saved-pill-text" onclick={() => applySavedSearch(s)} title="Re-run this search">
                                    {s.query}
                                    {#if s.testamentFilter !== 'all'}
                                        <span class="saved-pill-meta">{s.testamentFilter}</span>
                                    {/if}
                                </button>
                                <button class="saved-pill-delete" onclick={() => handleDeleteSaved(s.id)} aria-label="Delete saved search">×</button>
                            </div>
                        {/each}
                    </div>
                </div>
            {/if}

            <!-- Filters -->
            <div class="filters-bar">
                <div class="filter-group">
                    <span class="filter-label">Testament</span>
                    <div class="filter-pills">
                        {#each ['all', 'OT', 'NT', 'AP'] as f}
                            <button
                                class="filter-pill"
                                class:active={testamentFilter === f}
                                onclick={() => setTestamentFilter(f as 'all' | 'OT' | 'NT' | 'AP')}
                            >{f === 'all' ? 'All' : f}</button>
                        {/each}
                    </div>
                </div>

                {#if availableTranslations.length > 1}
                    <div class="filter-group">
                        <span class="filter-label">Translations</span>
                        <div class="filter-pills">
                            {#each availableTranslations as t}
                                <button
                                    class="filter-pill translation-pill"
                                    class:active={selectedTranslations.includes(t.id)}
                                    class:building={isIndexBuilding(t.id)}
                                    onclick={() => toggleTranslation(t.id)}
                                    title={t.name}
                                >
                                    {t.abbreviation}
                                    {#if isIndexBuilding(t.id)}
                                        <span class="pill-spinner"></span>
                                    {/if}
                                </button>
                            {/each}
                        </div>
                    </div>
                {/if}
            </div>

            {#if query && results.length > 0}
                <p class="search-meta">{results.length} results{results.length >= 50 ? ' (top 50)' : ''}</p>
            {/if}
        </div>

        <!-- Results -->
        <div class="search-results">
            {#if anyIndexBuilding && !allIndexesReady && !query}
                <div class="search-state">
                    <div class="loading-spinner"></div>
                    <p>Building search index…</p>
                </div>
            {:else if !query}
                <div class="search-state">
                    <p class="search-hint">Type to search across all verses</p>
                </div>
            {:else if results.length === 0 && !searching && !anyIndexBuilding}
                <div class="search-state">
                    <p>No results for "{query}"</p>
                </div>
            {:else if results.length === 0 && anyIndexBuilding}
                <div class="search-state">
                    <div class="loading-spinner"></div>
                    <p>Building index for new translation…</p>
                </div>
            {:else}
                {#each results as verse}
                    <a
                        href="/read?book={verse.book}&chapter={verse.chapter}#{`verse-${verse.verse}`}"
                        class="result-card"
                        id="result-{verse.osisId}"
                    >
                        <div class="result-ref">
                            <span class="result-book">{getBookName(verse.book)}</span>
                            <span class="result-cv">{verse.chapter}:{verse.verse}</span>
                            {#if selectedTranslations.length > 1}
                                <span class="result-translation">{verse.translationId}</span>
                            {/if}
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
        max-width: 720px;
    }

    .search-header {
        margin-bottom: var(--space-6);
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
    }

    .search-title {
        font-size: var(--font-size-2xl);
        font-weight: 700;
    }

    /* ── Input ── */
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
        padding-right: 72px;
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
    .search-input::placeholder { color: var(--color-text-muted); }

    .search-clear {
        position: absolute;
        right: 40px;
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

    .save-btn {
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
    .save-btn:hover { color: var(--color-warning); }

    /* ── Saved searches ── */
    .saved-searches {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex-wrap: wrap;
    }

    .saved-label {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        flex-shrink: 0;
    }

    .saved-pills {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
    }

    .saved-pill {
        display: inline-flex;
        align-items: center;
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-full);
        overflow: hidden;
    }

    .saved-pill-text {
        background: none;
        border: none;
        padding: 3px var(--space-2);
        color: var(--color-text-secondary);
        font-size: var(--font-size-xs);
        font-weight: 500;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: var(--space-1);
        transition: color var(--transition-fast);
    }
    .saved-pill-text:hover { color: var(--color-accent); }

    .saved-pill-meta {
        background: var(--color-accent-subtle);
        color: var(--color-accent);
        padding: 1px 4px;
        border-radius: var(--radius-sm);
        font-size: 10px;
        font-weight: 700;
    }

    .saved-pill-delete {
        background: none;
        border: none;
        border-left: 1px solid var(--color-border);
        padding: 3px var(--space-2);
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
        cursor: pointer;
        line-height: 1;
        transition: color var(--transition-fast);
    }
    .saved-pill-delete:hover { color: var(--color-danger); }

    /* ── Filters ── */
    .filters-bar {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4);
        align-items: center;
    }

    .filter-group {
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }

    .filter-label {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        white-space: nowrap;
    }

    .filter-pills {
        display: flex;
        gap: 4px;
    }

    .filter-pill {
        padding: 3px var(--space-3);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-full);
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 500;
        cursor: pointer;
        transition: all var(--transition-fast);
        display: flex;
        align-items: center;
        gap: var(--space-1);
    }
    .filter-pill:hover {
        border-color: var(--color-accent);
        color: var(--color-text-primary);
    }
    .filter-pill.active {
        background: var(--color-accent-subtle);
        border-color: var(--color-accent);
        color: var(--color-accent);
        font-weight: 600;
    }

    .pill-spinner {
        display: inline-block;
        width: 8px;
        height: 8px;
        border: 1.5px solid currentColor;
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .search-meta {
        font-size: var(--font-size-sm);
        color: var(--color-text-muted);
    }

    /* ── Results ── */
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
    .search-hint { font-size: var(--font-size-sm); }

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
        border-radius: 2px;
        padding: 0 2px;
    }
</style>
