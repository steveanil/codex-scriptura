<script lang="ts">
    import { onDestroy, onMount, tick, untrack } from 'svelte';
    import { page } from '$app/state';
    import { toast } from '$lib/stores/toast.svelte';
    import { getInstalledTranslations, getSavedSearches, saveSearch, deleteSavedSearch, parseStrongsQuery, getTopicById } from '@codex-scriptura/db';
    import type { Translation, SavedSearch } from '@codex-scriptura/core';
    import type { Testament } from '$lib/search/fulltext';
    import { SearchIndexSet } from '$lib/search/index-set.svelte';
    import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
    import type { SegmentOption } from '$lib/components/ui/segmented';
    import FullTextResults from '$lib/components/search/FullTextResults.svelte';
    import WordStudyResults from '$lib/components/search/WordStudyResults.svelte';
    import TopicsResults from '$lib/components/search/TopicsResults.svelte';

    // The shell (issue #364): the query, the mode and the filters that every
    // mode shares, saved searches and deep links. Each mode owns its own
    // results and runs its search when `seq` is bumped, or once when it
    // mounts after a mode switch.

    // ── Search mode ───────────────────────────────────────
    // The standalone Lexicon mode was folded into Word Study (issue #27):
    // mode=lexicon deep links and saved searches map to concordance.
    type SearchMode = 'fulltext' | 'concordance' | 'topics';
    let searchMode = $state<SearchMode>('fulltext');
    // Three modes today; at five the SegmentedControl becomes a dropdown on
    // its own (issue #252), so morphology (#32) and boolean search can join.
    const MODE_OPTIONS: SegmentOption<SearchMode>[] = [
        { value: 'fulltext', label: 'Full Text', title: 'Best-matching verses for a phrase' },
        { value: 'concordance', label: 'Word Study', title: 'Every occurrence of a word or Strong\'s number' },
        { value: 'topics', label: 'Topics', title: 'Nave\'s topical index' },
    ];
    const TESTAMENT_OPTIONS: SegmentOption<Testament>[] = [
        { value: 'all', label: 'All' }, { value: 'OT', label: 'OT', title: 'Old Testament' }, { value: 'NT', label: 'NT', title: 'New Testament' }, { value: 'AP', label: 'AP', title: 'Apocrypha' },
    ];

    // ── Shared query state ────────────────────────────────
    let query = $state('');
    let includeVariants = $state(false);
    let testamentFilter = $state<Testament>('all');
    let availableTranslations = $state<Translation[]>([]);
    let translationsLoaded = $state(false);
    let selectedTranslations = $state<string[]>(['KJV']);
    let savedSearches = $state<SavedSearch[]>([]);

    /** Bumped whenever the active mode should run its search. */
    let seq = $state(0);
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let topics = $state<ReturnType<typeof TopicsResults>>();

    // ── Indexes ───────────────────────────────────────────
    // Full Text reads them; the pills and the placeholder show their state.
    const indexes = new SearchIndexSet();
    $effect(() => {
        if (!translationsLoaded) return;
        const ids = [...selectedTranslations];
        untrack(() => indexes.sync(ids));
    });
    let anyIndexBuilding = $derived(indexes.anyBuilding(selectedTranslations));
    let allIndexesReady = $derived(indexes.allReady(selectedTranslations));
    let failedIndexes = $derived(indexes.failed(selectedTranslations));
    onDestroy(() => indexes.releaseAll());

    // ── Search dispatch ───────────────────────────────────
    function runSearch() {
        seq += 1;
    }

    /** Debounced search: typing and filter pills both go through here. */
    function scheduleSearch() {
        if (debounceTimer) clearTimeout(debounceTimer);
        const delay = searchMode === 'concordance' ? 400 : 150;
        debounceTimer = setTimeout(runSearch, delay);
    }

    function switchMode(mode: SearchMode) {
        searchMode = mode;
        runSearch();
    }

    function clearQuery() {
        query = '';
        runSearch();
    }

    /** From a Word Study group or lexicon card: the full concordance of a Strong's number. */
    function openOccurrences(strongsId: string) {
        query = strongsId;
        switchMode('concordance');
    }

    function toggleTranslation(id: string) {
        if (selectedTranslations.includes(id)) {
            if (selectedTranslations.length === 1) return; // Keep at least one
            selectedTranslations = selectedTranslations.filter((t) => t !== id);
        } else {
            selectedTranslations = [...selectedTranslations, id];
        }
        if (query.trim()) scheduleSearch();
    }

    function setTestamentFilter(f: Testament) {
        testamentFilter = f;
        if (query.trim()) scheduleSearch();
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
            mode: searchMode,
            includeVariants,
        };
        await saveSearch(search);
        savedSearches = await getSavedSearches();
        toast.show('Search saved');
    }

    async function handleDeleteSaved(id: string) {
        const record = $state.snapshot(savedSearches.find((s) => s.id === id));
        await deleteSavedSearch(id);
        savedSearches = await getSavedSearches();
        if (!record) return;
        toast.show('Saved search deleted', {
            action: {
                label: 'Undo',
                run: async () => {
                    await saveSearch(record);
                    savedSearches = await getSavedSearches();
                },
            },
        });
    }

    function applySavedSearch(s: SavedSearch) {
        query = s.query;
        // A saved search may reference translations removed since it was
        // saved (issue #238) - restore only what is still installed.
        const installed = new Set(availableTranslations.map((t) => t.id));
        const restorable = s.translationIds.filter((id) => installed.has(id));
        selectedTranslations = restorable.length > 0 ? restorable : selectedTranslations;
        if (s.mode) {
            // Saved lexicon searches predate the fold into Word Study (issue #27)
            searchMode = s.mode === 'lexicon' ? 'concordance' : s.mode;
        }
        if (s.includeVariants !== undefined) {
            includeVariants = s.includeVariants;
        }
        runSearch();
    }

    onMount(async () => {
        // Installed translations only (issue #238) - catalog-only records
        // (not yet downloaded via the Translation Manager) can't be searched.
        availableTranslations = await getInstalledTranslations();
        savedSearches = await getSavedSearches();
        // Default selection: KJV when installed, else the first installed.
        if (!availableTranslations.some((t) => t.id === 'KJV') && availableTranslations.length > 0) {
            selectedTranslations = [availableTranslations[0].id];
        }
        translationsLoaded = true;

        // Deep link: /search?q=word[&mode=fulltext|concordance].
        // The reader's dictionary card links here; single words from that
        // entry point default to Word Study (an exhaustive concordance is
        // what "search this word in the Bible" means), phrases to Full Text.
        // mode=lexicon predates the fold into Word Study (issue #27).
        const q = page.url.searchParams.get('q')?.trim();
        const topicParam = page.url.searchParams.get('topic')?.trim();
        if (topicParam) {
            // /search?topic=forgiveness deep-links straight into a topic
            const topic = await getTopicById(topicParam);
            searchMode = 'topics';
            if (topic) {
                query = topic.name;
                runSearch();
                await tick();
                topics?.showTopic(topic);
            }
        } else if (q) {
            query = q;
            const mode = page.url.searchParams.get('mode');
            if (mode === 'fulltext' || mode === 'concordance' || mode === 'topics') {
                searchMode = mode;
            } else if (mode === 'lexicon' || !q.includes(' ')) {
                searchMode = 'concordance';
            }
            runSearch();
        }
    });
</script>

<svelte:head>
    <title>Search - Codex Scriptura</title>
</svelte:head>

<div class="search-page">
    <div class="search-container">
        <div class="search-header">
            <h1 class="search-title">Search Scripture</h1>

            <!-- Mode switcher: Alt+M cycles it from anywhere on the page -->
            <div class="mode-row">
                <SegmentedControl id="search-mode" label="Search mode" options={MODE_OPTIONS} value={searchMode} onchange={switchMode} shortcut="Alt+M" />
                <kbd class="mode-kbd" title="Next search mode">Alt M</kbd>
            </div>

            <!-- One-line explanation of the active mode (known-issues #29) -->
            <p class="mode-desc">
                {#if searchMode === 'fulltext'}
                    Find the most relevant verses for a phrase or topic, best matches first.
                {:else if searchMode === 'concordance'}
                    See every occurrence of one word or Strong&rsquo;s number (H7225), grouped by the original Hebrew or Greek word behind it.
                {:else}
                    Browse curated verse lists by subject from Nave&rsquo;s Topical Bible - 5,300 topics, 78,000 references.
                {/if}
            </p>

            <!-- Search input -->
            <div class="search-input-wrap">
                <svg class="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                </svg>
                <input
                    type="text"
                    class="search-input"
                    placeholder={searchMode === 'concordance'
                        ? 'One word (love), Strong\'s number (H7225), or lemma (agape)…'
                        : searchMode === 'topics'
                            ? 'A subject: forgiveness, faith, prayer…'
                            : allIndexesReady
                                ? `Search phrases and topics across ${selectedTranslations.join(', ')}…`
                                : anyIndexBuilding
                                    ? 'Building index…'
                                    : failedIndexes.length > 0 ? 'Search index failed to build' : 'Loading…'}
                    bind:value={query}
                    oninput={scheduleSearch}
                    id="search-input"
                />
                {#if query}
                    <button class="search-clear" onclick={clearQuery} aria-label="Clear search" title="Clear search">
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
                    <span class="data-label">Saved</span>
                    <div class="saved-pills">
                        {#each savedSearches as s (s.id)}
                            <div class="saved-pill">
                                <button class="saved-pill-text" onclick={() => applySavedSearch(s)} title="Re-run this search">
                                    {s.query}
                                    {#if s.testamentFilter !== 'all'}
                                        <span class="saved-pill-meta">{s.testamentFilter}</span>
                                    {/if}
                                </button>
                                <button class="saved-pill-delete" onclick={() => handleDeleteSaved(s.id)} aria-label="Delete saved search" title="Delete saved search">×</button>
                            </div>
                        {/each}
                    </div>
                </div>
            {/if}

            <!-- Filters (translation/testament scoping does not apply to the topical index) -->
            {#if searchMode !== 'topics'}
            <div class="filters-bar">
                <div class="filter-group">
                    <span class="data-label">Testament</span>
                    <SegmentedControl size="sm" label="Testament" options={TESTAMENT_OPTIONS} value={testamentFilter} onchange={setTestamentFilter} />
                </div>

                {#if availableTranslations.length > 1}
                    <div class="filter-group">
                        <span class="data-label">Translations</span>
                        <div class="filter-pills">
                            {#each availableTranslations as t (t.id)}
                                <button
                                    class="filter-pill translation-pill"
                                    class:active={selectedTranslations.includes(t.id)}
                                    class:building={indexes.isBuilding(t.id)}
                                    onclick={() => toggleTranslation(t.id)}
                                    title={t.coverage ? `${t.name}: ${t.coverage} (in-progress translation)` : t.name}
                                >
                                    {t.coverage ? `${t.abbreviation} (partial)` : t.abbreviation}
                                    {#if indexes.isBuilding(t.id)}
                                        <span class="pill-spinner"></span>
                                    {/if}
                                </button>
                            {/each}
                        </div>
                    </div>
                {/if}
            </div>
            {/if}

            <!-- Variant toggle (Word Study only; meaningless for Strong's IDs) -->
            {#if searchMode === 'concordance' && !parseStrongsQuery(query)}
                <label class="variant-toggle">
                    <input
                        type="checkbox"
                        bind:checked={includeVariants}
                        onchange={() => { if (query.trim()) runSearch(); }}
                    />
                    Match word variants (loved, loves, loveth…)
                </label>
            {/if}
        </div>

        <!-- Results: one component per mode, each owning its results -->
        <div class="search-results">
            {#if searchMode === 'topics'}
                <TopicsResults bind:this={topics} {query} {seq} />
            {:else if searchMode === 'concordance'}
                <WordStudyResults
                    {query}
                    {seq}
                    testament={testamentFilter}
                    translations={selectedTranslations}
                    available={availableTranslations}
                    {includeVariants}
                    onOpenOccurrences={openOccurrences}
                />
            {:else}
                <FullTextResults {query} {seq} testament={testamentFilter} translations={selectedTranslations} {indexes} />
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
        font-size: var(--font-size-display);
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

    /* The query field carries the visual weight on this page (issue
       #252): taller, larger type, a raised surface. The mode switcher
       beside it is a quiet segmented control. */
    .search-input {
        width: 100%;
        height: 52px;
        padding: 0 72px 0 48px;
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-md);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-lg);
        outline: none;
        transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    }
    .search-input::placeholder { color: var(--color-text-muted); }

    .search-clear, .save-btn {
        position: absolute;
        background: none;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        padding: 6px;
        border-radius: 50%;
        display: flex;
        transition: all var(--transition-fast);
    }
    .search-clear { right: 44px; }
    .search-clear:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }

    .save-btn { right: var(--space-2); }
    .save-btn:hover { background: var(--color-accent-subtle); color: var(--color-accent); }

    /* ── Saved searches ── */
    .saved-searches {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex-wrap: wrap;
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
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-pill);
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
        font-size: var(--font-size-2xs);
        font-weight: 700;
    }

    .saved-pill-delete {
        background: none;
        border: none;
        border-left: 1px solid var(--color-border-control);
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

    .filter-pills {
        display: flex;
        gap: 4px;
    }

    .filter-pill {
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
        display: flex;
        align-items: center;
        gap: var(--space-1);
    }
    .filter-pill:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }
    .filter-pill.active {
        background: var(--color-accent);
        border-color: var(--color-accent);
        color: var(--color-on-accent, #fff);
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

    /* ── Results ── */
    .search-results {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    /* ── Mode switcher ── */
    .mode-row {
        display: flex;
        align-items: center;
        gap: var(--space-3);
    }
    .mode-kbd {
        padding: 0 var(--space-1);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-xs);
        font-family: var(--font-ui);
        font-size: var(--font-size-2xs);
        color: var(--color-text-muted);
        line-height: 1.6;
    }

    .mode-desc {
        margin: calc(-1 * var(--space-1)) 0 0;
        color: var(--color-text-muted);
        font-size: var(--font-size-xs);
    }

    /* ── Variant toggle ── */
    .variant-toggle {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
        cursor: pointer;
        user-select: none;
    }
    .variant-toggle input { cursor: pointer; }
</style>
