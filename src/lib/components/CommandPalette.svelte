<script lang="ts">
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import { parseReference, formatReference, findBook, BOOKS } from '@codex-scriptura/core';
    import { db } from '@codex-scriptura/db';
    import type { VerseRecord } from '@codex-scriptura/core';
    import MiniSearch from 'minisearch';

    // ── State ─────────────────────────────────────────────
    let isOpen = $state(false);
    let query = $state('');
    let inputEl = $state<HTMLInputElement | undefined>();
    let selectedIndex = $state(0);

    // Lazy search index (built once on first open)
    let searchIndex = $state<MiniSearch<VerseRecord> | null>(null);
    let indexBuilding = $state(false);

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    type PaletteResult = {
        id: string;
        type: 'navigate' | 'verse' | 'note';
        label: string;
        sublabel: string;
        url: string;
    };

    let navResults = $state<PaletteResult[]>([]);
    let verseResults = $state<PaletteResult[]>([]);
    let noteResults = $state<PaletteResult[]>([]);

    let allResults = $derived([...navResults, ...verseResults, ...noteResults]);

    const STOP_WORDS = new Set(['the','and','of','in','to','a','is','was','that','it','for','his','he','she','her','with','be','not','but','they','shall','unto','upon','from','by','as','all','are','this','them','which','their','were']);

    // ── Index ─────────────────────────────────────────────
    async function buildIndex() {
        if (searchIndex || indexBuilding) return;
        indexBuilding = true;
        try {
            const allVerses = await db.verses.where('translationId').equals('KJV').toArray();
            const idx = new MiniSearch<VerseRecord>({
                fields: ['text'],
                storeFields: ['book', 'chapter', 'verse', 'text'],
                idField: 'id',
                processTerm: (term) => {
                    const t = term.toLowerCase();
                    return STOP_WORDS.has(t) ? null : t;
                },
            });
            idx.addAll(allVerses);
            searchIndex = idx;
        } finally {
            indexBuilding = false;
        }
        if (query.trim().length >= 3) computeResults();
    }

    // ── Open / Close ──────────────────────────────────────
    function open() {
        isOpen = true;
        query = '';
        navResults = [];
        verseResults = [];
        noteResults = [];
        selectedIndex = 0;
        requestAnimationFrame(() => inputEl?.focus());
        buildIndex();
    }

    function close() {
        isOpen = false;
        query = '';
        navResults = [];
        verseResults = [];
        noteResults = [];
    }

    // ── Keyboard ──────────────────────────────────────────
    function handleGlobalKeydown(e: KeyboardEvent) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            isOpen ? close() : open();
        }
    }

    function handlePaletteKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') { close(); return; }
        const total = allResults.length;
        if (total === 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = (selectedIndex + 1) % total;
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = (selectedIndex - 1 + total) % total;
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const r = allResults[selectedIndex];
            if (r) navigate(r);
        }
    }

    // ── Search ────────────────────────────────────────────
    async function computeResults() {
        const q = query.trim();
        if (!q) {
            navResults = [];
            verseResults = [];
            noteResults = [];
            return;
        }

        const qlc = q.toLowerCase();
        const nav: PaletteResult[] = [];

        // 1. Bible reference parse (e.g. "John 3:16", "Gen 1")
        const ref = parseReference(q);
        if (ref && findBook(ref.book)) {
            const hash = ref.verse ? `#verse-${ref.verse}` : '';
            nav.push({
                id: `ref-${ref.book}-${ref.chapter}-${ref.verse ?? ''}`,
                type: 'navigate',
                label: formatReference(ref),
                sublabel: 'Jump to reference',
                url: `/read?book=${ref.book}&chapter=${ref.chapter}${hash}`,
            });
        }

        // 2. Book name prefix match (e.g. "john", "gen")
        const bookMatches = BOOKS.filter(b =>
            b.name.toLowerCase().startsWith(qlc) ||
            b.abbrev.toLowerCase().startsWith(qlc) ||
            b.osisId.toLowerCase().startsWith(qlc)
        ).slice(0, 3);

        for (const b of bookMatches) {
            if (ref?.book === b.osisId) continue;
            nav.push({
                id: `book-${b.osisId}`,
                type: 'navigate',
                label: b.name,
                sublabel: b.testament === 'OT' ? 'Old Testament' : b.testament === 'NT' ? 'New Testament' : 'Apocrypha',
                url: `/read?book=${b.osisId}&chapter=1`,
            });
        }

        navResults = nav;

        // 3. Verse text search (MiniSearch, lazy)
        if (q.length >= 3 && searchIndex) {
            const raw = searchIndex.search(q, {
                prefix: true,
                fuzzy: (t) => t.length > 4 ? 0.2 : 0,
            }).slice(0, 5);
            verseResults = raw.map(r => {
                const bookMeta = findBook(r.book as string);
                const text = r.text as string;
                return {
                    id: `verse-${r.book}-${r.chapter}-${r.verse}`,
                    type: 'verse' as const,
                    label: `${bookMeta?.name ?? r.book} ${r.chapter}:${r.verse}`,
                    sublabel: text.length > 90 ? text.slice(0, 90) + '…' : text,
                    url: `/read?book=${r.book}&chapter=${r.chapter}#verse-${r.verse}`,
                };
            });
        } else if (q.length < 3) {
            verseResults = [];
        }

        // 4. Note text search (DB, fast because annotation count is small)
        if (q.length >= 3) {
            const notes = await db.annotations
                .where('type').equals('note')
                .filter(a => a.data.toLowerCase().includes(qlc))
                .limit(3)
                .toArray();
            noteResults = notes.map(n => {
                const parts = n.verseStart.split('.');
                const bookMeta = findBook(parts[0]);
                return {
                    id: `note-${n.id}`,
                    type: 'note' as const,
                    label: `${bookMeta?.name ?? parts[0]} ${parts[1]}:${parts[2]}`,
                    sublabel: n.data.length > 90 ? n.data.slice(0, 90) + '…' : n.data,
                    url: `/read?book=${parts[0]}&chapter=${parts[1]}#verse-${parts[2]}`,
                };
            });
        } else {
            noteResults = [];
        }

        selectedIndex = 0;
    }

    function handleInput() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(computeResults, 100);
    }

    function navigate(r: PaletteResult) {
        goto(r.url);
        close();
    }

    onMount(() => {
        window.addEventListener('keydown', handleGlobalKeydown);
        return () => window.removeEventListener('keydown', handleGlobalKeydown);
    });
</script>

{#if isOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="palette-backdrop" onclick={close}></div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="palette" onkeydown={handlePaletteKeydown} role="dialog" tabindex="-1" aria-modal="true" aria-label="Command palette">
        <div class="palette-input-wrap">
            <svg class="palette-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
                bind:this={inputEl}
                class="palette-input"
                type="text"
                placeholder="Search verses, books, or notes…"
                bind:value={query}
                oninput={handleInput}
                autocomplete="off"
                spellcheck="false"
            />
            <kbd class="palette-esc-hint">Esc</kbd>
        </div>

        {#if allResults.length > 0}
            <div class="palette-results">
                {#if navResults.length > 0}
                    <div class="result-group">
                        <span class="result-group-label">Navigate</span>
                        {#each navResults as result, i}
                            {@const globalIdx = i}
                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <div
                                class="result-item"
                                class:selected={selectedIndex === globalIdx}
                                onclick={() => navigate(result)}
                                onmouseenter={() => selectedIndex = globalIdx}
                            >
                                <svg class="result-icon nav-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                                </svg>
                                <div class="result-text">
                                    <span class="result-label">{result.label}</span>
                                    <span class="result-sublabel">{result.sublabel}</span>
                                </div>
                                <svg class="result-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M5 12h14M12 5l7 7-7 7" />
                                </svg>
                            </div>
                        {/each}
                    </div>
                {/if}

                {#if verseResults.length > 0}
                    <div class="result-group">
                        <span class="result-group-label">
                            Verses
                            {#if indexBuilding}<span class="building-hint">(building index…)</span>{/if}
                        </span>
                        {#each verseResults as result, i}
                            {@const globalIdx = navResults.length + i}
                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <div
                                class="result-item"
                                class:selected={selectedIndex === globalIdx}
                                onclick={() => navigate(result)}
                                onmouseenter={() => selectedIndex = globalIdx}
                            >
                                <svg class="result-icon verse-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" />
                                </svg>
                                <div class="result-text">
                                    <span class="result-label">{result.label}</span>
                                    <span class="result-sublabel scripture">{result.sublabel}</span>
                                </div>
                            </div>
                        {/each}
                    </div>
                {:else if indexBuilding && query.length >= 3}
                    <div class="result-group">
                        <span class="result-group-label">Verses <span class="building-hint">(building index…)</span></span>
                    </div>
                {/if}

                {#if noteResults.length > 0}
                    <div class="result-group">
                        <span class="result-group-label">Notes</span>
                        {#each noteResults as result, i}
                            {@const globalIdx = navResults.length + verseResults.length + i}
                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <div
                                class="result-item"
                                class:selected={selectedIndex === globalIdx}
                                onclick={() => navigate(result)}
                                onmouseenter={() => selectedIndex = globalIdx}
                            >
                                <svg class="result-icon note-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                                </svg>
                                <div class="result-text">
                                    <span class="result-label">{result.label}</span>
                                    <span class="result-sublabel">{result.sublabel}</span>
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        {:else if query.length > 0}
            <div class="palette-empty">No results for "{query}"</div>
        {:else}
            <div class="palette-hint">
                <span>Type a reference like <strong>John 3:16</strong>, a book name, or any scripture text</span>
            </div>
        {/if}

        <div class="palette-footer">
            <span><kbd>↑↓</kbd> navigate</span>
            <span><kbd>↵</kbd> open</span>
            <span><kbd>Esc</kbd> close</span>
        </div>
    </div>
{/if}

<style>
    .palette-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(2px);
        z-index: 500;
    }

    .palette {
        position: fixed;
        top: 15vh;
        left: 50%;
        transform: translateX(-50%);
        width: 620px;
        max-width: calc(100vw - var(--space-8));
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg), 0 0 0 1px rgba(139, 124, 246, 0.1);
        z-index: 501;
        overflow: hidden;
        animation: paletteIn 0.15s ease-out;
    }

    @keyframes paletteIn {
        from { opacity: 0; transform: translateX(-50%) scale(0.96) translateY(-8px); }
        to   { opacity: 1; transform: translateX(-50%) scale(1) translateY(0); }
    }

    /* ── Input ── */
    .palette-input-wrap {
        display: flex;
        align-items: center;
        padding: var(--space-1) var(--space-4);
        border-bottom: 1px solid var(--color-border);
        gap: var(--space-3);
    }

    .palette-search-icon {
        color: var(--color-text-muted);
        flex-shrink: 0;
    }

    .palette-input {
        flex: 1;
        background: none;
        border: none;
        outline: none;
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-base);
        padding: var(--space-3) 0;
        caret-color: var(--color-accent);
    }

    .palette-input::placeholder {
        color: var(--color-text-muted);
    }

    .palette-esc-hint {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: 2px var(--space-2);
        flex-shrink: 0;
    }

    /* ── Results ── */
    .palette-results {
        max-height: 400px;
        overflow-y: auto;
        padding: var(--space-2) 0;
    }

    .result-group {
        padding: var(--space-1) 0;
    }

    .result-group + .result-group {
        border-top: 1px solid var(--color-border-subtle);
        margin-top: var(--space-1);
        padding-top: var(--space-2);
    }

    .result-group-label {
        display: block;
        font-size: var(--font-size-xs);
        font-weight: 600;
        color: var(--color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding: var(--space-1) var(--space-4);
        margin-bottom: var(--space-1);
    }

    .building-hint {
        font-weight: 400;
        text-transform: none;
        letter-spacing: 0;
        font-style: italic;
        color: var(--color-text-muted);
        opacity: 0.7;
    }

    .result-item {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-2) var(--space-4);
        cursor: pointer;
        transition: background var(--transition-fast);
    }

    .result-item.selected,
    .result-item:hover {
        background: var(--color-bg-hover);
    }

    .result-item.selected .result-label {
        color: var(--color-accent);
    }

    .result-icon {
        flex-shrink: 0;
        color: var(--color-text-muted);
    }
    .result-item.selected .result-icon,
    .result-item:hover .result-icon {
        color: var(--color-accent);
    }

    .result-text {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
        overflow: hidden;
    }

    .result-label {
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 500;
        color: var(--color-text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .result-sublabel {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .result-sublabel.scripture {
        font-family: var(--font-scripture);
        font-size: var(--font-size-sm);
    }

    .result-arrow {
        flex-shrink: 0;
        color: var(--color-text-muted);
        opacity: 0;
        transition: opacity var(--transition-fast);
    }
    .result-item.selected .result-arrow,
    .result-item:hover .result-arrow {
        opacity: 1;
    }

    /* ── States ── */
    .palette-empty,
    .palette-hint {
        padding: var(--space-6) var(--space-6);
        text-align: center;
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
    }

    .palette-hint strong {
        color: var(--color-text-secondary);
    }

    /* ── Footer ── */
    .palette-footer {
        display: flex;
        gap: var(--space-4);
        padding: var(--space-2) var(--space-4);
        border-top: 1px solid var(--color-border-subtle);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
    }

    .palette-footer span {
        display: flex;
        align-items: center;
        gap: var(--space-1);
    }

    .palette-footer kbd {
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: 4px;
        padding: 1px 5px;
        font-size: 11px;
    }
</style>
