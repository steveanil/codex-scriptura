<script lang="ts">
    import { onMount } from 'svelte';
    import { page } from '$app/state';
    import { db, getTranslations, getSavedSearches, saveSearch, deleteSavedSearch, wordSearch, strongsSearch, lemmaGroupSearch, parseStrongsQuery, getLexiconEntry, getCachedSearchIndex, saveCachedSearchIndex, searchLexicon } from '@codex-scriptura/db';
    import { findBook, BOOKS } from '@codex-scriptura/core';
    import type { VerseRecord, Translation, SavedSearch, ConcordanceSearchResult, LexicalMatch, LexiconEntry, LemmaGroup, LemmaSearchResult } from '@codex-scriptura/core';
    import MiniSearch from 'minisearch';
    import { STOP_WORDS, FULL_SEARCH_OPTIONS } from '$lib/search-config';

    // ── Search mode ───────────────────────────────────────
    // The standalone Lexicon mode was folded into Word Study (issue #27):
    // lexicon entry cards are now the lemma group headers, and gloss/
    // transliteration matches surface under "From the lexicon" below the
    // groups. mode=lexicon deep links and saved searches map to concordance.
    let searchMode = $state<'fulltext' | 'concordance'>('fulltext');
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

    // ── Lemma grouping (issue #27) ────────────────────────
    // English Word Study queries against tagged translations group by the
    // underlying Strong's lemma. groupedMode distinguishes "grouped search
    // ran" from the flat fallback for untagged translations. expandedGroups
    // is reassigned (never mutated) so Svelte's $state tracks it.
    let groupedMode = $state(false);
    let lemmaGroups = $state<LemmaGroup[]>([]);
    let groupedTotals = $state<{ hits: number; verses: number } | null>(null);
    let expandedGroups = $state<Set<string>>(new Set());
    let lexiconExtras = $state<LexiconEntry[]>([]);
    let expandedExtraId = $state<string | null>(null);

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
    function resetResultState() {
        results = [];
        concordanceResults = [];
        strongsEntry = null;
        strongsNote = null;
        groupedMode = false;
        lemmaGroups = [];
        groupedTotals = null;
        expandedGroups = new Set();
        lexiconExtras = [];
        expandedExtraId = null;
    }

    function runCurrentSearch() {
        if (!query.trim()) {
            resetResultState();
            return;
        }
        if (searchMode === 'concordance') {
            doConcordanceSearch();
        } else {
            doSearch();
        }
    }

    function handleInput() {
        if (debounceTimer) clearTimeout(debounceTimer);
        const delay = searchMode === 'concordance' ? 400 : 150;
        debounceTimer = setTimeout(runCurrentSearch, delay);
    }

    function switchMode(mode: 'fulltext' | 'concordance') {
        searchMode = mode;
        resetResultState();
        if (query.trim()) runCurrentSearch();
    }

    /** Jump to the full concordance of a Strong's number (all renderings). */
    function openOccurrences(strongsNumber: string) {
        query = strongsNumber;
        switchMode('concordance');
    }

    function groupKey(g: LemmaGroup): string {
        return g.strongsId ?? '__untagged__';
    }

    function toggleGroup(key: string) {
        const next = new Set(expandedGroups);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        expandedGroups = next;
    }

    /** "loved 45×, love 12×, loveth 3×" - top surface forms of a group. */
    function formatSurfaces(surfaces: LexicalMatch[]): string {
        const shown = surfaces.slice(0, 4).map(s => `${s.surface} ${s.count}×`).join(', ');
        return surfaces.length > 4 ? `${shown}, …` : shown;
    }

    /** Merge per-translation lemma results into one canonical group list. */
    function mergeLemmaResults(per: LemmaSearchResult[]): LemmaSearchResult {
        if (per.length === 1) return per[0];
        const map = new Map<string | null, LemmaGroup>();
        let totalHits = 0, totalVerses = 0;
        for (const r of per) {
            totalHits += r.totalHits;
            totalVerses += r.totalVerses;
            for (const g of r.groups) {
                const existing = map.get(g.strongsId);
                if (!existing) {
                    map.set(g.strongsId, { ...g, surfaces: [...g.surfaces], results: [...g.results] });
                    continue;
                }
                existing.hitCount += g.hitCount;
                const sm = new Map(existing.surfaces.map(s => [s.surface, s.count]));
                for (const s of g.surfaces) sm.set(s.surface, (sm.get(s.surface) ?? 0) + s.count);
                existing.surfaces = Array.from(sm.entries())
                    .map(([surface, count]) => ({ surface, count }))
                    .sort((a, b) => b.count - a.count);
                existing.results = existing.results.concat(g.results);
                if (!existing.entry && g.entry) existing.entry = g.entry;
            }
        }
        const groups = Array.from(map.values());
        for (const g of groups) {
            g.results.sort((a, b) => {
                const ai = BOOKS.findIndex(bk => bk.osisId === a.verse.book);
                const bi = BOOKS.findIndex(bk => bk.osisId === b.verse.book);
                if (ai !== bi) return ai - bi;
                if (a.verse.chapter !== b.verse.chapter) return a.verse.chapter - b.verse.chapter;
                if (a.verse.verse !== b.verse.verse) return a.verse.verse - b.verse.verse;
                return a.verse.translationId.localeCompare(b.verse.translationId);
            });
        }
        groups.sort((a, b) =>
            (a.strongsId === null ? 1 : 0) - (b.strongsId === null ? 1 : 0) ||
            b.hitCount - a.hitCount
        );
        return { groups, totalHits, totalVerses };
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
        resetResultState();

        const strongsId = parseStrongsQuery(qtr);
        const tagged = availableTranslations.filter(t => t.strongs).map(t => t.id);

        let merged: ConcordanceSearchResult[];
        if (strongsId) {
            // Strong's-number query: search lemma tokens instead of English
            // text. Only tagged translations can answer; when none of the
            // user's selected translations are tagged, fall back to every
            // tagged one and say so rather than showing zero results. All of
            // them, not just one: the upstream tagging is uneven (ASV/BSB
            // lack whole Greek ranges that DBY carries, e.g. G26).
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
            const groupTargets = selectedTranslations.filter(t => tagged.includes(t));
            if (groupTargets.length > 0) {
                // Lemma-grouped word study (issue #27): every occurrence of
                // the English word, grouped by the Strong's lemma behind it,
                // with the lexicon entry as the group header.
                groupedMode = true;
                concordanceTargets = groupTargets;
                const untaggedSelected = selectedTranslations.filter(t => !tagged.includes(t));
                if (untaggedSelected.length > 0) {
                    strongsNote = `${untaggedSelected.join(', ')} ${untaggedSelected.length === 1 ? "isn't" : "aren't"} Strong's-tagged - lemma groups drawn from ${groupTargets.join(', ')}.`;
                }
                const perTranslation = await Promise.all(
                    groupTargets.map(tid => lemmaGroupSearch(tid, qtr, includeVariants, testamentFilter))
                );
                const combined = mergeLemmaResults(perTranslation);
                lemmaGroups = combined.groups;
                groupedTotals = { hits: combined.totalHits, verses: combined.totalVerses };
                if (combined.groups.length === 1) {
                    expandedGroups = new Set([groupKey(combined.groups[0])]);
                }
                // The retired Lexicon tab lives on here: gloss/transliteration
                // matches (agape, elohim, "mercy") whose lemma didn't already
                // appear as a group above.
                const covered = new Set(combined.groups.map(g => g.strongsId));
                lexiconExtras = (await searchLexicon(qtr))
                    .filter(e => !covered.has(e.strongsNumber))
                    .slice(0, 8);
                concordanceSearching = false;
                return;
            }
            // No tagged translation selected: flat scan of the English text.
            if (tagged.length > 0) {
                strongsNote = `${selectedTranslations.join(', ')} ${selectedTranslations.length === 1 ? "isn't" : "aren't"} Strong's-tagged - showing a flat list. Add ${tagged.join(' or ')} to group by original word.`;
            }
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
            // Saved lexicon searches predate the fold into Word Study (issue #27)
            searchMode = s.mode === 'lexicon' ? 'concordance' : s.mode;
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

        // Deep link: /search?q=word[&mode=fulltext|concordance].
        // The reader's dictionary card links here; single words from that
        // entry point default to Word Study (an exhaustive concordance is
        // what "search this word in the Bible" means), phrases to Full Text.
        // mode=lexicon predates the fold into Word Study (issue #27).
        const q = page.url.searchParams.get('q')?.trim();
        if (q) {
            query = q;
            const mode = page.url.searchParams.get('mode');
            if (mode === 'fulltext' || mode === 'concordance') {
                searchMode = mode;
            } else if (mode === 'lexicon' || !q.includes(' ')) {
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
            <h1 class="search-title">Search Scripture</h1>

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
            </div>

            <!-- One-line explanation of the active mode (known-issues #29) -->
            <p class="mode-desc">
                {#if searchMode === 'fulltext'}
                    Find the most relevant verses for a phrase or topic, best matches first.
                {:else}
                    See every occurrence of one word or Strong&rsquo;s number (H7225), grouped by the original Hebrew or Greek word behind it.
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
                        : allIndexesReady
                            ? `Search phrases and topics across ${selectedTranslations.join(', ')}…`
                            : anyIndexBuilding ? 'Building index…' : 'Loading…'}
                    bind:value={query}
                    oninput={handleInput}
                    id="search-input"
                />
                {#if query}
                    <button class="search-clear" onclick={() => { query = ''; resetResultState(); }} aria-label="Clear search">
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
            {#if searchMode === 'concordance' && query && (groupedTotals !== null || concordanceTotalVerses > 0 || concordanceSearching)}
                <p class="search-meta">
                    {#if concordanceSearching}
                        Searching…
                    {:else if groupedTotals !== null}
                        {groupedTotals.hits} occurrence{groupedTotals.hits !== 1 ? 's' : ''} in {groupedTotals.verses} verse{groupedTotals.verses !== 1 ? 's' : ''}{#if lemmaGroups.filter(g => g.strongsId !== null).length > 0}&nbsp;· {lemmaGroups.filter(g => g.strongsId !== null).length} original word{lemmaGroups.filter(g => g.strongsId !== null).length !== 1 ? 's' : ''}{/if}
                    {:else}
                        {concordanceTotalHits} occurrence{concordanceTotalHits !== 1 ? 's' : ''} in {concordanceTotalVerses} verse{concordanceTotalVerses !== 1 ? 's' : ''}
                    {/if}
                </p>
            {:else if searchMode === 'fulltext' && query && results.length > 0}
                <p class="search-meta">{results.length} results{results.length >= 50 ? ' (top 50)' : ''}</p>
            {/if}
        </div>

        <!-- Results -->
        <div class="search-results">
            {#snippet resultCard(result: ConcordanceSearchResult)}
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
            {/snippet}

            {#if searchMode === 'concordance'}
                <!-- ── Word Study (concordance) results ── -->
                {#if concordanceSearching}
                    <div class="search-state">
                        <div class="loading-spinner"></div>
                        <p>Scanning {selectedTranslations.join(', ')}…</p>
                    </div>
                {:else if !query}
                    <div class="search-state">
                        <p class="search-hint">Type a word to see every occurrence grouped by the original Hebrew or Greek word - or a Strong's number (H7225, G26) for its full concordance</p>
                        <p class="search-hint-sub">8,674 Hebrew and 5,523 Greek lexicon entries back the groups</p>
                    </div>
                {:else}
                    {#if strongsEntry}
                        <div class="strongs-entry-card">
                            <div class="lex-header">
                                <span class="lex-strongs">{strongsEntry.strongsNumber}</span>
                                <span class="lex-lang-badge" class:lex-hebrew={strongsEntry.language === 'hebrew'} class:lex-greek={strongsEntry.language === 'greek'}>{strongsEntry.language === 'hebrew' ? 'Heb' : 'Grk'}</span>
                                <span class="lex-lemma">{strongsEntry.lemma}</span>
                                <span class="lex-translit">{strongsEntry.transliteration}</span>
                                {#if strongsEntry.pronunciation}
                                    <span class="lex-pron">{strongsEntry.pronunciation}</span>
                                {/if}
                            </div>
                            <p class="lex-gloss">{strongsEntry.gloss}</p>
                        </div>
                    {/if}
                    {#if strongsNote}
                        <p class="strongs-note">{strongsNote}</p>
                    {/if}
                    {#if groupedMode}
                        <!-- ── Lemma-grouped results (issue #27) ── -->
                        {#if lemmaGroups.length === 0 && lexiconExtras.length === 0}
                            <div class="search-state">
                                <p>No occurrences of "{query}"</p>
                            </div>
                        {:else}
                            {#each lemmaGroups as group (groupKey(group))}
                                <div class="lex-card" class:lex-selected={expandedGroups.has(groupKey(group))}>
                                    <button class="lex-toggle" onclick={() => toggleGroup(groupKey(group))}>
                                        <div class="lex-header">
                                            {#if group.strongsId !== null}
                                                <span class="lex-strongs">{group.strongsId}</span>
                                                {#if group.entry}
                                                    <span class="lex-lang-badge" class:lex-hebrew={group.entry.language === 'hebrew'} class:lex-greek={group.entry.language === 'greek'}>{group.entry.language === 'hebrew' ? 'Heb' : 'Grk'}</span>
                                                    <span class="lex-lemma">{group.entry.lemma}</span>
                                                    <span class="lex-translit">{group.entry.transliteration}</span>
                                                {/if}
                                            {:else}
                                                <span class="untagged-label">No Strong's tag</span>
                                            {/if}
                                            <span class="hit-badge group-hits">{group.hitCount}×</span>
                                        </div>
                                        {#if group.entry}
                                            <p class="lex-gloss">{group.entry.gloss}</p>
                                        {:else if group.strongsId === null}
                                            <p class="lex-gloss">Occurrences the source leaves untagged - often words supplied by the translators.</p>
                                        {/if}
                                        <p class="group-surfaces">{formatSurfaces(group.surfaces)} · {group.results.length} verse{group.results.length === 1 ? '' : 's'}</p>
                                    </button>
                                    {#if expandedGroups.has(groupKey(group))}
                                        <div class="group-results">
                                            {#if group.strongsId !== null}
                                                {@const gid = group.strongsId}
                                                <button class="lex-occ-btn" onclick={() => openOccurrences(gid)}>
                                                    Every {gid} occurrence, all renderings
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                                        <path d="M5 12h14" /><path d="M12 5l7 7-7 7" />
                                                    </svg>
                                                </button>
                                            {/if}
                                            {#each group.results as result (result.verse.id)}
                                                {@render resultCard(result)}
                                            {/each}
                                        </div>
                                    {/if}
                                </div>
                            {/each}
                            {#if lexiconExtras.length > 0}
                                <p class="extras-label">From the lexicon</p>
                                {#each lexiconExtras as entry (entry.id)}
                                    <div class="lex-card" class:lex-selected={expandedExtraId === entry.id}>
                                        <button
                                            class="lex-toggle"
                                            onclick={() => expandedExtraId = expandedExtraId === entry.id ? null : entry.id}
                                        >
                                            <div class="lex-header">
                                                <span class="lex-strongs">{entry.strongsNumber}</span>
                                                <span class="lex-lang-badge" class:lex-hebrew={entry.language === 'hebrew'} class:lex-greek={entry.language === 'greek'}>{entry.language === 'hebrew' ? 'Heb' : 'Grk'}</span>
                                                <span class="lex-lemma">{entry.lemma}</span>
                                                <span class="lex-translit">{entry.transliteration}</span>
                                                {#if entry.pronunciation}
                                                    <span class="lex-pron">{entry.pronunciation}</span>
                                                {/if}
                                            </div>
                                            <p class="lex-gloss">{entry.gloss}</p>
                                        </button>
                                        {#if expandedExtraId === entry.id}
                                            <div class="lex-detail">
                                                {#if entry.description}
                                                    <p class="lex-description">{entry.description}</p>
                                                {/if}
                                                <button class="lex-occ-btn" onclick={() => openOccurrences(entry.strongsNumber)}>
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
                        {/if}
                    {:else if concordanceResults.length === 0}
                        <div class="search-state">
                            <p>No {parseStrongsQuery(query) ? 'tagged occurrences' : 'occurrences'} of "{query}"</p>
                        </div>
                    {:else}
                        {#each concordanceResults as result}
                            {@render resultCard(result)}
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
    .lex-pron {
        font-size: var(--font-size-sm);
        color: var(--color-text-muted);
    }
    .lex-pron::before {
        content: "\00B7";
        margin-right: var(--space-2);
        opacity: 0.6;
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

    /* ── Lemma groups (Word Study, issue #27) ── */
    .untagged-label {
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: var(--color-text-muted);
    }
    .group-hits {
        margin-left: auto;
    }
    .group-surfaces {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        margin: var(--space-1) 0 0;
    }
    .group-results {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        margin-top: var(--space-3);
        padding-top: var(--space-3);
        border-top: 1px solid var(--color-border-subtle);
        animation: xrefSlideIn 0.15s ease-out;
    }
    .group-results .lex-occ-btn {
        margin-top: 0;
        align-self: flex-start;
    }
    .extras-label {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin: var(--space-3) 0 0;
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
