<script lang="ts">
    import { onMount } from 'svelte';
    import { page } from '$app/state';
    import { db, getTranslations, getSavedSearches, saveSearch, deleteSavedSearch, wordSearch, strongsSearch, parseStrongsQuery, getLexiconEntry, getCachedSearchIndex, saveCachedSearchIndex, searchLexicon } from '@codex-scriptura/db';
    import { findBook, BOOKS } from '@codex-scriptura/core';
    import type { VerseRecord, Translation, SavedSearch, ConcordanceSearchResult, LexicalMatch, LexiconEntry } from '@codex-scriptura/core';
    import MiniSearch from 'minisearch';
    import { STOP_WORDS, FULL_SEARCH_OPTIONS } from '$lib/search-config';

    // ── Search mode ───────────────────────────────────────
    let searchMode = $state<'fulltext' | 'concordance' | 'lexicon'>('fulltext');
    let includeVariants = $state(false);

    // ── Search state ──────────────────────────────────────
    let query = $state('');
    let results = $state<(VerseRecord & { score: number })[]>([]);
    let searching = $state(false);
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    // ── Concordance state ─────────────────────────────────
    let concordanceResults = $state<ConcordanceSearchResult[]>([]);
    let concordanceSearching = $state(false);
    let concordanceTotalVerses = $derived(concordanceResults.length);
    let concordanceTotalHits = $derived(concordanceResults.reduce((s, r) => s + r.hitCount, 0));
    // Strong's-number queries: the matched lexicon entry shown above the
    // results, an explanatory note when the search had to leave the user's
    // selected translations, and which translations the results came from
    // (drives the per-result translation badge).
    let strongsEntry = $state<LexiconEntry | null>(null);
    let strongsNote = $state<string | null>(null);
    let concordanceTargets = $state<string[]>([]);

    // ── Lexicon state ─────────────────────────────────────
    let lexiconResults = $state<LexiconEntry[]>([]);
    let lexiconSearching = $state(false);
    let selectedLexiconId = $state<string | null>(null);

    // ── Translation filter ────────────────────────────────
    let availableTranslations = $state<Translation[]>([]);
    let selectedTranslations = $state<string[]>(['KJV']);
    // Map of translationId → { index, building, ready }
    const indexes = new Map<string, { index: MiniSearch<VerseRecord> | null; building: boolean; ready: boolean }>();

    // ── Testament / book filter ───────────────────────────
    let testamentFilter = $state<'all' | 'OT' | 'NT' | 'AP'>('all');

    // ── Saved searches ────────────────────────────────────
    let savedSearches = $state<SavedSearch[]>([]);

    // ── Index management ──────────────────────────────────
    async function buildIndexForTranslation(translationId: string) {
        const entry = indexes.get(translationId);
        if (entry?.ready || entry?.building) return;

        indexes.set(translationId, { index: null, building: true, ready: false });

        // Try to load a cached serialized index from IndexedDB
        const cacheKey = `minisearch:${translationId}`;
        const cached = await getCachedSearchIndex(cacheKey);
        const currentCount = await db.verses.where('translationId').equals(translationId).count();

        if (cached && cached.verseCount === currentCount) {
            // Cache hit - deserialize instead of rebuilding
            const idx = MiniSearch.loadJSON<VerseRecord>(cached.serializedIndex, FULL_SEARCH_OPTIONS);
            indexes.set(translationId, { index: idx, building: false, ready: true });
            if (query.trim() && searchMode === 'fulltext') doSearch();
            return;
        }

        // Cache miss or stale - build from scratch
        const allVerses = await db.verses.where('translationId').equals(translationId).toArray();

        const idx = new MiniSearch<VerseRecord>(FULL_SEARCH_OPTIONS);

        idx.addAll(allVerses);
        indexes.set(translationId, { index: idx, building: false, ready: true });

        // Persist the newly built index to the cache
        await saveCachedSearchIndex({
            id: cacheKey,
            translationId,
            serializedIndex: JSON.stringify(idx),
            verseCount: allVerses.length,
            createdAt: Date.now(),
        });

        // Trigger re-search now that this index is ready
        if (query.trim() && searchMode === 'fulltext') doSearch();
    }

    function isIndexReady(translationId: string) {
        return indexes.get(translationId)?.ready ?? false;
    }

    function isIndexBuilding(translationId: string) {
        return indexes.get(translationId)?.building ?? false;
    }

    let anyIndexBuilding = $derived(selectedTranslations.some(t => isIndexBuilding(t)));
    let allIndexesReady = $derived(selectedTranslations.every(t => isIndexReady(t)));

    // ── Search dispatch ───────────────────────────────────
    function runCurrentSearch() {
        if (!query.trim()) {
            results = [];
            concordanceResults = [];
            lexiconResults = [];
            return;
        }
        if (searchMode === 'lexicon') {
            doLexiconSearch();
        } else if (searchMode === 'concordance') {
            doConcordanceSearch();
        } else {
            doSearch();
        }
    }

    function handleInput() {
        if (debounceTimer) clearTimeout(debounceTimer);
        const delay = searchMode === 'concordance' ? 400 : searchMode === 'lexicon' ? 250 : 150;
        debounceTimer = setTimeout(runCurrentSearch, delay);
    }

    function switchMode(mode: 'fulltext' | 'concordance' | 'lexicon') {
        searchMode = mode;
        results = [];
        concordanceResults = [];
        lexiconResults = [];
        selectedLexiconId = null;
        strongsEntry = null;
        strongsNote = null;
        if (query.trim()) runCurrentSearch();
    }

    /** Jump from a lexicon entry to its concordance occurrences. */
    function openOccurrences(entry: LexiconEntry) {
        query = entry.strongsNumber;
        switchMode('concordance');
    }

    // ── Search logic ──────────────────────────────────────

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

    // ── Concordance search ────────────────────────────────
    async function doConcordanceSearch() {
        const qtr = query.trim();
        if (!qtr) { concordanceResults = []; return; }

        concordanceSearching = true;
        concordanceResults = [];
        strongsEntry = null;
        strongsNote = null;

        let merged: ConcordanceSearchResult[];
        const strongsId = parseStrongsQuery(qtr);
        if (strongsId) {
            // Strong's-number query: search lemma tokens instead of English
            // text. Only tagged translations can answer; when none of the
            // user's selected translations are tagged, fall back to every
            // tagged one and say so rather than showing zero results. All of
            // them, not just one: the upstream tagging is uneven (ASV/BSB
            // lack whole Greek ranges that DBY carries, e.g. G26).
            const tagged = availableTranslations.filter(t => t.strongs).map(t => t.id);
            let targets = selectedTranslations.filter(t => tagged.includes(t));
            if (targets.length === 0 && tagged.length > 0) {
                targets = tagged;
                strongsNote = `${selectedTranslations.join(', ')} ${selectedTranslations.length === 1 ? "isn't" : "aren't"} Strong's-tagged - showing occurrences from ${targets.join(', ')}.`;
            }
            concordanceTargets = targets;
            strongsEntry = (await getLexiconEntry(strongsId)) ?? null;
            const resultsArray = await Promise.all(targets.map(tid => strongsSearch(tid, strongsId)));
            merged = resultsArray.flat();
        } else {
            concordanceTargets = [...selectedTranslations];
            const promises = selectedTranslations.map(tid => wordSearch(tid, qtr, includeVariants));
            const resultsArray = await Promise.all(promises);
            merged = resultsArray.flat();
        }

        // Apply testament filter
        let filtered = testamentFilter !== 'all'
            ? merged.filter(r => findBook(r.verse.book)?.testament === testamentFilter)
            : merged;

        // Sort canonically: book position → chapter → verse → translation
        filtered.sort((a, b) => {
            const ai = BOOKS.findIndex(bk => bk.osisId === a.verse.book);
            const bi = BOOKS.findIndex(bk => bk.osisId === b.verse.book);
            if (ai !== bi) return ai - bi;
            if (a.verse.chapter !== b.verse.chapter) return a.verse.chapter - b.verse.chapter;
            if (a.verse.verse !== b.verse.verse) return a.verse.verse - b.verse.verse;
            return a.verse.translationId.localeCompare(b.verse.translationId);
        });

        concordanceResults = filtered;
        concordanceSearching = false;
    }

    // ── Lexicon search ────────────────────────────────────
    async function doLexiconSearch() {
        const qtr = query.trim();
        if (!qtr) { lexiconResults = []; return; }

        lexiconSearching = true;
        selectedLexiconId = null;

        const entries = await searchLexicon(qtr);

        // Sort: exact Strong's ID match first, then by relevance
        entries.sort((a, b) => {
            const qlc = qtr.toLowerCase();
            const aExact = a.strongsNumber.toLowerCase() === qlc ? 1 : 0;
            const bExact = b.strongsNumber.toLowerCase() === qlc ? 1 : 0;
            if (aExact !== bExact) return bExact - aExact;
            // Exact gloss match next
            const aGloss = a.gloss.toLowerCase() === qlc ? 1 : 0;
            const bGloss = b.gloss.toLowerCase() === qlc ? 1 : 0;
            if (aGloss !== bGloss) return bGloss - aGloss;
            return 0;
        });

        lexiconResults = entries.slice(0, 50);
        lexiconSearching = false;
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
        if (query.trim()) runCurrentSearch();
    }

    // ── Testament filter ──────────────────────────────────
    function setTestamentFilter(f: 'all' | 'OT' | 'NT' | 'AP') {
        testamentFilter = f;
        if (query.trim()) runCurrentSearch();
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
    }

    async function handleDeleteSaved(id: string) {
        await deleteSavedSearch(id);
        savedSearches = await getSavedSearches();
    }

    function applySavedSearch(s: SavedSearch) {
        query = s.query;
        selectedTranslations = [...s.translationIds];
        if (s.mode) {
            searchMode = s.mode as 'fulltext' | 'concordance';
        }
        if (s.includeVariants !== undefined) {
            includeVariants = s.includeVariants;
        }

        // Ensure indexes are built
        for (const tid of selectedTranslations) {
            if (!indexes.get(tid)?.ready && !indexes.get(tid)?.building) {
                buildIndexForTranslation(tid);
            }
        }
        runCurrentSearch();
    }

    // ── Highlight ─────────────────────────────────────────
    // These results render via {@html}, so verse text must be HTML-escaped -
    // matches run against the ORIGINAL text (escaping first would let query
    // words match inside entities like &amp;), then each segment is escaped
    // as the marked-up string is assembled.
    function escapeHtml(s: string): string {
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function markMatches(text: string, pattern: RegExp): string {
        let out = '';
        let last = 0;
        for (const m of text.matchAll(pattern)) {
            const idx = m.index ?? 0;
            out += escapeHtml(text.slice(last, idx)) + `<mark>${escapeHtml(m[0])}</mark>`;
            last = idx + m[0].length;
        }
        return out + escapeHtml(text.slice(last));
    }

    function highlightMatch(text: string, q: string): string {
        if (!q.trim()) return escapeHtml(text);
        const qlc = q.trim().toLowerCase();
        if (text.toLowerCase().includes(qlc)) {
            const pattern = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            return markMatches(text, pattern);
        }
        const words = q.trim().split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w.toLowerCase()));
        if (words.length === 0) return escapeHtml(text);
        const pattern = new RegExp(words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
        return markMatches(text, pattern);
    }

    function getBookName(bookId: string): string {
        return findBook(bookId)?.name ?? bookId;
    }

    function highlightConcordanceMatch(text: string, surfaces: string[]): string {
        if (surfaces.length === 0) return escapeHtml(text);
        const escaped = surfaces.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        return markMatches(text, new RegExp(`\\b(${escaped})\\b`, 'gi'));
    }

    let totalIndexed = $derived(
        selectedTranslations.filter(t => isIndexReady(t)).length
    );

    onMount(async () => {
        availableTranslations = await db.translations.toArray();
        savedSearches = await getSavedSearches();
        buildIndexForTranslation('KJV');

        // Deep link: /search?q=word[&mode=fulltext|concordance|lexicon].
        // The reader's dictionary card links here; single words from that
        // entry point default to Word Study (an exhaustive concordance is
        // what "search this word in the Bible" means), phrases to Full Text.
        const q = page.url.searchParams.get('q')?.trim();
        if (q) {
            query = q;
            const mode = page.url.searchParams.get('mode');
            if (mode === 'fulltext' || mode === 'concordance' || mode === 'lexicon') {
                searchMode = mode;
            } else if (!q.includes(' ')) {
                searchMode = 'concordance';
            }
            runCurrentSearch();
        }
    });
</script>

<svelte:head>
    <title>Search - Codex Scriptura</title>
</svelte:head>

<div class="search-page">
    <div class="search-container">
        <div class="search-header">
            <h1 class="search-title">{searchMode === 'lexicon' ? 'Lexicon Lookup' : 'Search Scripture'}</h1>

            <!-- Mode toggle -->
            <div class="mode-toggle">
                <button
                    class="mode-btn"
                    class:active={searchMode === 'fulltext'}
                    onclick={() => switchMode('fulltext')}
                >Full Text</button>
                <button
                    class="mode-btn"
                    class:active={searchMode === 'concordance'}
                    onclick={() => switchMode('concordance')}
                >Word Study</button>
                <button
                    class="mode-btn"
                    class:active={searchMode === 'lexicon'}
                    onclick={() => switchMode('lexicon')}
                >Lexicon</button>
            </div>

            <!-- One-line explanation of the active mode (known-issues #29) -->
            <p class="mode-desc">
                {#if searchMode === 'fulltext'}
                    Find the most relevant verses for a phrase or topic, best matches first.
                {:else if searchMode === 'concordance'}
                    See every occurrence of one word (love, loved, loveth) or Strong&rsquo;s number (H7225), in canonical order.
                {:else}
                    Look up Strong&rsquo;s Hebrew &amp; Greek dictionary entries, then jump to every tagged occurrence.
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
                    placeholder={searchMode === 'lexicon'
                        ? 'Strong\'s ID (H430), lemma, or English gloss…'
                        : searchMode === 'concordance'
                            ? 'One word (barley, love) or Strong\'s number (H7225)…'
                            : allIndexesReady
                                ? `Search phrases and topics across ${selectedTranslations.join(', ')}…`
                                : anyIndexBuilding ? 'Building index…' : 'Loading…'}
                    bind:value={query}
                    oninput={handleInput}
                    id="search-input"
                />
                {#if query}
                    <button class="search-clear" onclick={() => { query = ''; results = []; concordanceResults = []; lexiconResults = []; selectedLexiconId = null; strongsEntry = null; strongsNote = null; }} aria-label="Clear search">
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

            <!-- Filters (hidden in lexicon mode - not relevant) -->
            {#if searchMode !== 'lexicon'}
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
                                    title={t.coverage ? `${t.name}: ${t.coverage} (in-progress translation)` : t.name}
                                >
                                    {t.coverage ? `${t.abbreviation} (partial)` : t.abbreviation}
                                    {#if isIndexBuilding(t.id)}
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
                        onchange={() => { if (query.trim()) doConcordanceSearch(); }}
                    />
                    Match word variants (loved, loves, loveth…)
                </label>
            {/if}

            <!-- Result count summary -->
            {#if searchMode === 'lexicon' && query && (lexiconResults.length > 0 || lexiconSearching)}
                <p class="search-meta">
                    {#if lexiconSearching}Searching lexicon…{:else}{lexiconResults.length} entr{lexiconResults.length === 1 ? 'y' : 'ies'}{lexiconResults.length >= 50 ? ' (top 50)' : ''}{/if}
                </p>
            {:else if searchMode === 'concordance' && query && (concordanceTotalVerses > 0 || concordanceSearching)}
                <p class="search-meta">
                    {#if concordanceSearching}Searching…{:else}{concordanceTotalHits} occurrence{concordanceTotalHits !== 1 ? 's' : ''} in {concordanceTotalVerses} verse{concordanceTotalVerses !== 1 ? 's' : ''}{/if}
                </p>
            {:else if searchMode === 'fulltext' && query && results.length > 0}
                <p class="search-meta">{results.length} results{results.length >= 50 ? ' (top 50)' : ''}</p>
            {/if}
        </div>

        <!-- Results -->
        <div class="search-results">
            {#if searchMode === 'lexicon'}
                <!-- ── Lexicon results ── -->
                {#if lexiconSearching}
                    <div class="search-state">
                        <div class="loading-spinner"></div>
                        <p>Searching lexicon…</p>
                    </div>
                {:else if !query}
                    <div class="search-state">
                        <p class="search-hint">Search by Strong's number (H430 or G26), lemma, transliteration, or English gloss</p>
                        <p class="search-hint-sub">8,674 Hebrew and 5,523 Greek entries available</p>
                    </div>
                {:else if lexiconResults.length === 0}
                    <div class="search-state">
                        <p>No lexicon entries for "{query}"</p>
                    </div>
                {:else}
                    {#each lexiconResults as entry (entry.id)}
                        <div class="lex-card" class:lex-selected={selectedLexiconId === entry.id}>
                            <button
                                class="lex-toggle"
                                onclick={() => selectedLexiconId = selectedLexiconId === entry.id ? null : entry.id}
                            >
                                <div class="lex-header">
                                    <span class="lex-strongs">{entry.strongsNumber}</span>
                                    <span class="lex-lang-badge" class:lex-hebrew={entry.language === 'hebrew'} class:lex-greek={entry.language === 'greek'}>{entry.language === 'hebrew' ? 'Heb' : 'Grk'}</span>
                                    <span class="lex-lemma">{entry.lemma}</span>
                                    <span class="lex-translit">{entry.transliteration}</span>
                                </div>
                                <p class="lex-gloss">{entry.gloss}</p>
                            </button>
                            {#if selectedLexiconId === entry.id}
                                <div class="lex-detail">
                                    {#if entry.description}
                                        <p class="lex-description">{entry.description}</p>
                                    {/if}
                                    <button class="lex-occ-btn" onclick={() => openOccurrences(entry)}>
                                        See every occurrence
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                            <path d="M5 12h14" /><path d="M12 5l7 7-7 7" />
                                        </svg>
                                    </button>
                                </div>
                            {/if}
                        </div>
                    {/each}
                {/if}
            {:else if searchMode === 'concordance'}
                <!-- ── Word Study (concordance) results ── -->
                {#if concordanceSearching}
                    <div class="search-state">
                        <div class="loading-spinner"></div>
                        <p>Scanning {selectedTranslations.join(', ')}…</p>
                    </div>
                {:else if !query}
                    <div class="search-state">
                        <p class="search-hint">Type a word or Strong's number (H7225, G26) to find every occurrence in canonical order</p>
                    </div>
                {:else}
                    {#if strongsEntry}
                        <div class="strongs-entry-card">
                            <div class="lex-header">
                                <span class="lex-strongs">{strongsEntry.strongsNumber}</span>
                                <span class="lex-lang-badge" class:lex-hebrew={strongsEntry.language === 'hebrew'} class:lex-greek={strongsEntry.language === 'greek'}>{strongsEntry.language === 'hebrew' ? 'Heb' : 'Grk'}</span>
                                <span class="lex-lemma">{strongsEntry.lemma}</span>
                                <span class="lex-translit">{strongsEntry.transliteration}</span>
                            </div>
                            <p class="lex-gloss">{strongsEntry.gloss}</p>
                        </div>
                    {/if}
                    {#if strongsNote}
                        <p class="strongs-note">{strongsNote}</p>
                    {/if}
                    {#if concordanceResults.length === 0}
                        <div class="search-state">
                            <p>No {parseStrongsQuery(query) ? 'tagged occurrences' : 'occurrences'} of "{query}"</p>
                        </div>
                    {:else}
                        {#each concordanceResults as result}
                            <a
                                href="/read?book={result.verse.book}&chapter={result.verse.chapter}#{`verse-${result.verse.verse}`}"
                                class="result-card"
                            >
                                <div class="result-ref">
                                    <span class="result-book">{getBookName(result.verse.book)}</span>
                                    <span class="result-cv">{result.verse.chapter}:{result.verse.verse}</span>
                                    {#if result.hitCount > 1}
                                        <span class="hit-badge">{result.hitCount}×</span>
                                    {/if}
                                    {#if concordanceTargets.length > 1}
                                        <span class="result-translation">{result.verse.translationId}</span>
                                    {/if}
                                </div>
                                <p class="result-text">{@html highlightConcordanceMatch(result.verse.text, result.matches.map((m: LexicalMatch) => m.surface))}</p>
                            </a>
                        {/each}
                    {/if}
                {/if}
            {:else}
                <!-- ── Full Text (MiniSearch) results ── -->
                {#if anyIndexBuilding && !allIndexesReady && !query}
                    <div class="search-state">
                        <div class="loading-spinner"></div>
                        <p>Building search index…</p>
                    </div>
                {:else if !query}
                    <div class="search-state">
                        <p class="search-hint">Search phrases and topics: "bread of life", "wilderness", "kingdom of God"</p>
                        <p class="search-hint-sub">Looking for every occurrence of one word? Use Word Study.</p>
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
        padding: 4px var(--space-3);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-full);
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
        color: white;
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

    /* ── Mode toggle ── */
    .mode-toggle {
        display: inline-flex;
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: 4px;
        gap: 2px;
        align-self: flex-start;
    }

    .mode-btn {
        padding: 6px var(--space-4);
        background: none;
        border: none;
        border-radius: calc(var(--radius-md) - 2px);
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 500;
        cursor: pointer;
        transition: all var(--transition-fast);
    }
    .mode-btn:hover { color: var(--color-text-primary); }
    .mode-btn.active {
        background: var(--color-accent);
        color: #fff;
        font-weight: 600;
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

    /* ── Hit count badge ── */
    .hit-badge {
        font-size: var(--font-size-xs);
        font-weight: 700;
        color: var(--color-accent);
        background: var(--color-accent-subtle);
        border-radius: var(--radius-full);
        padding: 1px 6px;
    }

    /* ── Lexicon ── */
    .search-hint-sub {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        opacity: 0.7;
        margin-top: calc(-1 * var(--space-2));
    }

    .lex-card {
        display: block;
        width: 100%;
        text-align: left;
        padding: var(--space-3) var(--space-4);
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border-subtle);
        border-radius: var(--radius-sm);
        transition: all var(--transition-fast);
    }
    /* The expand/collapse control - a real button, kept separate from the
       card so the occurrences button below isn't nested inside it */
    .lex-toggle {
        display: block;
        width: 100%;
        text-align: left;
        padding: 0;
        background: none;
        border: none;
        color: inherit;
        font: inherit;
        cursor: pointer;
    }
    .lex-card:hover {
        background: var(--color-bg-hover);
        border-color: var(--color-border);
        box-shadow: var(--shadow-sm);
    }
    .lex-card.lex-selected {
        border-color: var(--color-accent);
        box-shadow: var(--shadow-glow);
    }

    .lex-header {
        display: flex;
        align-items: baseline;
        gap: var(--space-2);
        margin-bottom: var(--space-1);
        flex-wrap: wrap;
    }
    .lex-strongs {
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
        font-weight: 700;
        color: var(--color-accent);
    }
    .lex-lang-badge {
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: 600;
        padding: 1px 6px;
        border-radius: var(--radius-full);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
    .lex-hebrew {
        background: rgba(139, 92, 246, 0.12);
        color: #7c3aed;
    }
    :global([data-theme="dark"]) .lex-hebrew {
        background: rgba(139, 92, 246, 0.2);
        color: #a78bfa;
    }
    .lex-greek {
        background: rgba(14, 165, 233, 0.12);
        color: #0284c7;
    }
    :global([data-theme="dark"]) .lex-greek {
        background: rgba(14, 165, 233, 0.2);
        color: #38bdf8;
    }
    .lex-lemma {
        font-size: var(--font-size-lg);
        font-weight: 500;
        color: var(--color-text-primary);
        direction: rtl;
    }
    .lex-translit {
        font-size: var(--font-size-sm);
        color: var(--color-text-muted);
        font-style: italic;
    }
    .lex-gloss {
        font-family: var(--font-ui);
        font-size: var(--font-size-base);
        color: var(--color-text-secondary);
        line-height: 1.5;
        margin: 0;
    }
    .lex-detail {
        margin-top: var(--space-3);
        padding-top: var(--space-3);
        border-top: 1px solid var(--color-border-subtle);
        animation: xrefSlideIn 0.15s ease-out;
    }
    @keyframes xrefSlideIn {
        from { opacity: 0; transform: translateY(-4px); }
        to   { opacity: 1; transform: translateY(0); }
    }
    .lex-description {
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
        line-height: 1.7;
        white-space: pre-line;
        margin: 0;
    }

    .lex-occ-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        margin-top: var(--space-3);
        padding: var(--space-1) var(--space-3);
        background: var(--color-accent-subtle);
        border: 1px solid transparent;
        border-radius: var(--radius-sm);
        color: var(--color-accent);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 600;
        cursor: pointer;
        transition: all var(--transition-fast);
    }
    .lex-occ-btn:hover {
        border-color: var(--color-accent);
        color: var(--color-accent-hover);
    }

    /* ── Strong's concordance header ── */
    .strongs-entry-card {
        padding: var(--space-3) var(--space-4);
        background: var(--color-accent-subtle);
        border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
        border-radius: var(--radius-sm);
        margin-bottom: var(--space-1);
    }
    .strongs-note {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        margin: 0 0 var(--space-1);
    }
</style>
