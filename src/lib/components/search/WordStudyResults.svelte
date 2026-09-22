<script lang="ts">
    import { untrack } from 'svelte';
    import { strongsSearch, parseStrongsQuery, getLexiconEntry, searchLexicon } from '@codex-scriptura/db';
    import { compareCanonical, strongsIndexDatasetId } from '@codex-scriptura/core';
    import type { Translation, ConcordanceSearchResult, LexicalMatch, LexiconEntry, LemmaGroup, LemmaSearchResult } from '@codex-scriptura/core';
    import type { Testament } from '$lib/search/fulltext';
    import { searchWord, searchWordByLemma } from '$lib/search/concordance';
    import { highlightSurfaces } from '$lib/search/highlight';
    import { datasetStatus } from '$lib/stores/datasetStatus.svelte';
    import SearchStatus from './SearchStatus.svelte';
    import VerseResultCard from './VerseResultCard.svelte';

    /**
     * Word Study mode: every occurrence of an English word, grouped by the
     * Strong's lemma behind it when an aligned translation is selected
     * (issue #27), or the full concordance of a Strong's number. The shell
     * bumps `seq` when a search should run; a lexicon or Strong's postings
     * dataset landing behind a live reader (issue #244) re-runs it on its own.
     */
    let {
        query,
        testament,
        translations,
        available,
        includeVariants,
        seq,
        onOpenOccurrences,
    }: {
        query: string;
        testament: Testament;
        /** Selected translation ids. */
        translations: string[];
        /** Every installed translation; decides which are tagged and aligned. */
        available: Translation[];
        includeVariants: boolean;
        seq: number;
        /** Jump to the full concordance of a Strong's number (all renderings). */
        onOpenOccurrences: (strongsId: string) => void;
    } = $props();

    let results = $state<ConcordanceSearchResult[]>([]);
    let searching = $state(false);
    let totalVerses = $derived(results.length);
    let totalHits = $derived(results.reduce((s, r) => s + r.hitCount, 0));
    // Result lists are paged (issue #165): "lord" or H3068 is thousands of
    // cards, and mounting them in one flush froze the page for seconds.
    const PAGE_SIZE = 50;
    let flatVisible = $state(PAGE_SIZE);
    let groupVisible = $state<Record<string, number>>({});
    function visibleIn(key: string): number {
        return groupVisible[key] ?? PAGE_SIZE;
    }
    function showMoreInGroup(key: string) {
        groupVisible = { ...groupVisible, [key]: visibleIn(key) + PAGE_SIZE };
    }
    // Strong's-number queries: the matched lexicon entry shown above the
    // results, an explanatory note when the search had to leave the user's
    // selected translations, and which translations the results came from
    // (drives the per-result translation badge).
    let strongsEntry = $state<LexiconEntry | null>(null);
    let strongsNote = $state<string | null>(null);
    let targets = $state<string[]>([]);

    // Lemma grouping (issue #27): groupedMode distinguishes "grouped search
    // ran" from the flat fallback for untagged translations. expandedGroups
    // is reassigned (never mutated) so Svelte's $state tracks it.
    let groupedMode = $state(false);
    let lemmaGroups = $state<LemmaGroup[]>([]);
    let groupedTotals = $state<{ hits: number; verses: number } | null>(null);
    let expandedGroups = $state<Set<string>>(new Set());
    let lexiconExtras = $state<LexiconEntry[]>([]);
    let expandedExtraId = $state<string | null>(null);
    let taggedGroupCount = $derived(lemmaGroups.filter((g) => g.strongsId !== null).length);

    // The datasets this mode answers from, as one string that changes only
    // when one of them lands or leaves.
    let datasetsKey = $derived.by(() => {
        const postings = [...datasetStatus.installed].filter((id) => id.startsWith('strongs-index:')).sort();
        return [datasetStatus.isInstalled('lexicon-hebrew'), datasetStatus.isInstalled('lexicon-greek'), ...postings].join();
    });

    // Generation counter (same pattern as PaneState.#loadGeneration): pill
    // toggles re-run the search immediately, and a slower older run must not
    // overwrite a newer run's results after it resolves (issue #159).
    let generation = 0;

    $effect(() => {
        void seq;
        void datasetsKey;
        untrack(() => { void run(); });
    });

    function reset() {
        results = [];
        flatVisible = PAGE_SIZE;
        groupVisible = {};
        strongsEntry = null;
        strongsNote = null;
        groupedMode = false;
        lemmaGroups = [];
        groupedTotals = null;
        expandedGroups = new Set();
        lexiconExtras = [];
        expandedExtraId = null;
    }

    async function run() {
        const q = query.trim();
        if (!q) {
            reset();
            return;
        }
        const gen = ++generation;
        searching = true;
        reset();
        try {
            await search(q, gen);
        } finally {
            // A stale run must not clear the spinner the newer run owns; a
            // thrown query must not leave it spinning forever (issue #158).
            if (gen === generation) searching = false;
        }
    }

    async function search(q: string, gen: number) {
        const strongsId = parseStrongsQuery(q);
        const tagged = available.filter((t) => t.strongs).map((t) => t.id);
        // Lemma GROUPING needs word-alignment spans, not just verse-level
        // lemmas: the WEB is tagged (derived, issue #134) but not aligned,
        // so it answers Strong's-number queries yet can't attribute an
        // English word to a lemma.
        const aligned = available.filter((t) => t.aligned).map((t) => t.id);

        let merged: ConcordanceSearchResult[];
        if (strongsId) {
            // Strong's-number query: search lemma tokens instead of English
            // text. Only tagged translations can answer; when none of the
            // user's selected translations are tagged, fall back to every
            // tagged one and say so rather than showing zero results. All of
            // them, not just one: the upstream tagging is uneven (ASV/BSB
            // lack whole Greek ranges that DBY carries, e.g. G26).
            let chosen = translations.filter((t) => tagged.includes(t));
            if (chosen.length === 0 && tagged.length > 0) {
                chosen = tagged;
                strongsNote = `${translations.join(', ')} ${translations.length === 1 ? "isn't" : "aren't"} Strong's-tagged - showing occurrences from ${chosen.join(', ')}.`;
            }
            targets = chosen;
            // Postings arrive after their translation's verses; until then that translation cannot answer
            const waiting = chosen.filter((tid) => !datasetStatus.isInstalled(strongsIndexDatasetId(tid)));
            if (waiting.length > 0) {
                strongsNote = [strongsNote, `The Strong's index for ${waiting.join(', ')} is still installing - search again in a moment.`].filter(Boolean).join(' ');
            }
            const entry = (await getLexiconEntry(strongsId)) ?? null;
            const perTranslation = await Promise.all(chosen.map((tid) => strongsSearch(tid, strongsId, testament)));
            if (gen !== generation) return;
            strongsEntry = entry;
            merged = perTranslation.flat();
        } else {
            const groupTargets = translations.filter((t) => aligned.includes(t));
            if (groupTargets.length > 0) {
                // Lemma-grouped word study (issue #27): every occurrence of
                // the English word, grouped by the Strong's lemma behind it,
                // with the lexicon entry as the group header.
                groupedMode = true;
                targets = groupTargets;
                const unalignedSelected = translations.filter((t) => !aligned.includes(t));
                if (unalignedSelected.length > 0) {
                    strongsNote = `${unalignedSelected.join(', ')} ${unalignedSelected.length === 1 ? "isn't" : "aren't"} word-aligned - lemma groups drawn from ${groupTargets.join(', ')}.`;
                }
                const perTranslation = await Promise.all(
                    groupTargets.map((tid) => searchWordByLemma(tid, q, includeVariants, testament)),
                );
                if (gen !== generation) return;
                const combined = mergeLemmaResults(perTranslation);
                lemmaGroups = combined.groups;
                groupedTotals = { hits: combined.totalHits, verses: combined.totalVerses };
                if (combined.groups.length === 1) {
                    expandedGroups = new Set([groupKey(combined.groups[0])]);
                }
                // The retired Lexicon tab lives on here: gloss/transliteration
                // matches (agape, elohim, "mercy") whose lemma didn't already
                // appear as a group above.
                const covered = new Set(combined.groups.map((g) => g.strongsId));
                const lexResults = await searchLexicon(q);
                if (gen !== generation) return;
                lexiconExtras = lexResults.filter((e) => !covered.has(e.strongsNumber)).slice(0, 8);
                return;
            }
            // No aligned translation selected: flat scan of the English text.
            if (aligned.length > 0) {
                strongsNote = `${translations.join(', ')} ${translations.length === 1 ? "isn't" : "aren't"} word-aligned - showing a flat list. Add ${aligned.join(' or ')} to group by original word.`;
            }
            targets = [...translations];
            const perTranslation = await Promise.all(translations.map((tid) => searchWord(tid, q, includeVariants, testament)));
            if (gen !== generation) return;
            merged = perTranslation.flat();
        }

        // Sort canonically: book position, chapter, verse, translation (the
        // engines applied the testament filter before reading any verse)
        results = merged.sort((a, b) =>
            compareCanonical(a.verse, b.verse) || a.verse.translationId.localeCompare(b.verse.translationId),
        );
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
        const shown = surfaces.slice(0, 4).map((s) => `${s.surface} ${s.count}×`).join(', ');
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
                const sm = new Map(existing.surfaces.map((s) => [s.surface, s.count]));
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
            g.results.sort((a, b) =>
                compareCanonical(a.verse, b.verse) || a.verse.translationId.localeCompare(b.verse.translationId),
            );
        }
        groups.sort((a, b) =>
            (a.strongsId === null ? 1 : 0) - (b.strongsId === null ? 1 : 0) ||
            b.hitCount - a.hitCount,
        );
        return { groups, totalHits, totalVerses };
    }

    function resultHtml(result: ConcordanceSearchResult): string {
        return highlightSurfaces(result.verse.text, result.matches.map((m: LexicalMatch) => m.surface));
    }
</script>

{#snippet showMore(remaining: number, reveal: () => void)}
    {#if remaining > 0}
        <button class="show-more-btn" onclick={reveal}>
            Show {Math.min(PAGE_SIZE, remaining)} more · {remaining} remaining
        </button>
    {/if}
{/snippet}

{#snippet lexHeader(entry: LexiconEntry)}
    <span class="lex-strongs">{entry.strongsNumber}</span>
    <span class="lex-lang-badge" class:lex-hebrew={entry.language === 'hebrew'} class:lex-greek={entry.language === 'greek'}>{entry.language === 'hebrew' ? 'Heb' : 'Grk'}</span>
    <span class="lex-lemma" class:lex-lemma-heb={entry.language === 'hebrew'}>{entry.lemma}</span>
    <span class="lex-translit">{entry.transliteration}</span>
    {#if entry.pronunciation}
        <span class="lex-pron">{entry.pronunciation}</span>
    {/if}
{/snippet}

{#snippet occurrencesButton(strongsId: string, label: string)}
    <button class="lex-occ-btn" onclick={() => onOpenOccurrences(strongsId)}>
        {label}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 12h14" /><path d="M12 5l7 7-7 7" />
        </svg>
    </button>
{/snippet}

{#if query && (groupedTotals !== null || totalVerses > 0 || searching)}
    <p class="search-meta">
        {#if searching}
            Searching…
        {:else if groupedTotals !== null}
            {groupedTotals.hits} occurrence{groupedTotals.hits !== 1 ? 's' : ''} in {groupedTotals.verses} verse{groupedTotals.verses !== 1 ? 's' : ''}{#if taggedGroupCount > 0}&nbsp;· {taggedGroupCount} original word{taggedGroupCount !== 1 ? 's' : ''}{/if}
        {:else}
            {totalHits} occurrence{totalHits !== 1 ? 's' : ''} in {totalVerses} verse{totalVerses !== 1 ? 's' : ''}
        {/if}
    </p>
{/if}

{#if searching}
    <SearchStatus loading>
        <p>Scanning {translations.join(', ')}…</p>
    </SearchStatus>
{:else if !query}
    <SearchStatus>
        <p class="search-hint">Type a word to see every occurrence grouped by the original Hebrew or Greek word - or a Strong's number (H7225, G26) for its full concordance</p>
        <p class="search-hint-sub">8,674 Hebrew and 5,523 Greek lexicon entries back the groups</p>
    </SearchStatus>
{:else}
    {#if strongsEntry}
        <div class="strongs-entry-card">
            <div class="lex-header">
                {@render lexHeader(strongsEntry)}
            </div>
            <p class="lex-gloss">{strongsEntry.gloss}</p>
        </div>
    {/if}
    {#if strongsNote}
        <p class="strongs-note">{strongsNote}</p>
    {/if}
    {#if groupedMode}
        {#if lemmaGroups.length === 0 && lexiconExtras.length === 0}
            <SearchStatus>
                <p>No occurrences of "{query}"</p>
            </SearchStatus>
        {:else}
            {#each lemmaGroups as group (groupKey(group))}
                {@const key = groupKey(group)}
                <div class="lex-card" class:lex-selected={expandedGroups.has(key)}>
                    <button class="lex-toggle" onclick={() => toggleGroup(key)}>
                        <div class="lex-header">
                            {#if group.strongsId !== null}
                                <span class="lex-strongs">{group.strongsId}</span>
                                {#if group.entry}
                                    <span class="lex-lang-badge" class:lex-hebrew={group.entry.language === 'hebrew'} class:lex-greek={group.entry.language === 'greek'}>{group.entry.language === 'hebrew' ? 'Heb' : 'Grk'}</span>
                                    <span class="lex-lemma" class:lex-lemma-heb={group.entry.language === 'hebrew'}>{group.entry.lemma}</span>
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
                    {#if expandedGroups.has(key)}
                        <div class="group-results">
                            {#if group.strongsId !== null}
                                {@render occurrencesButton(group.strongsId, `Every ${group.strongsId} occurrence, all renderings`)}
                            {/if}
                            {#each group.results.slice(0, visibleIn(key)) as result (result.verse.id)}
                                <VerseResultCard verse={result.verse} html={resultHtml(result)} hitCount={result.hitCount} showTranslation={targets.length > 1} />
                            {/each}
                            {@render showMore(group.results.length - visibleIn(key), () => showMoreInGroup(key))}
                        </div>
                    {/if}
                </div>
            {/each}
            {#if lexiconExtras.length > 0}
                <h2 class="section-heading extras-heading">From the lexicon</h2>
                {#each lexiconExtras as entry (entry.id)}
                    <div class="lex-card" class:lex-selected={expandedExtraId === entry.id}>
                        <button
                            class="lex-toggle"
                            onclick={() => expandedExtraId = expandedExtraId === entry.id ? null : entry.id}
                        >
                            <div class="lex-header">
                                {@render lexHeader(entry)}
                            </div>
                            <p class="lex-gloss">{entry.gloss}</p>
                        </button>
                        {#if expandedExtraId === entry.id}
                            <div class="lex-detail">
                                {#if entry.description}
                                    <p class="lex-description">{entry.description}</p>
                                {/if}
                                {@render occurrencesButton(entry.strongsNumber, 'See every occurrence')}
                            </div>
                        {/if}
                    </div>
                {/each}
            {/if}
        {/if}
    {:else if results.length === 0}
        <SearchStatus>
            <p>No {parseStrongsQuery(query) ? 'tagged occurrences' : 'occurrences'} of "{query}"</p>
        </SearchStatus>
    {:else}
        {#each results.slice(0, flatVisible) as result (result.verse.id)}
            <VerseResultCard verse={result.verse} html={resultHtml(result)} hitCount={result.hitCount} showTranslation={targets.length > 1} />
        {/each}
        {@render showMore(results.length - flatVisible, () => flatVisible += PAGE_SIZE)}
    {/if}
{/if}

<style>
    .search-meta {
        font-size: var(--font-size-sm);
        color: var(--color-text-muted);
        margin: 0 0 var(--space-2);
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

    .hit-badge {
        font-size: var(--font-size-xs);
        font-weight: 700;
        color: var(--color-accent);
        background: var(--color-accent-subtle);
        border-radius: var(--radius-pill);
        padding: 1px 6px;
    }

    /* ── Lexicon cards ── */
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
        font-size: var(--font-size-2xs);
        font-weight: 600;
        padding: 1px 6px;
        border-radius: var(--radius-pill);
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
        /* User-selected original-language fonts (Settings); the system
           falls through to any face with the glyphs when absent. */
        font-family: var(--font-greek), serif;
    }
    .lex-lemma-heb {
        font-family: var(--font-hebrew), serif;
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
        background: color-mix(in srgb, var(--color-accent) 24%, transparent);
        color: var(--color-accent-hover);
    }

    /* ── Lemma groups (issue #27) ── */
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
    .extras-heading {
        margin: var(--space-4) 0 0;
        padding-top: var(--space-4);
        border-top: 1px solid var(--color-border);
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
