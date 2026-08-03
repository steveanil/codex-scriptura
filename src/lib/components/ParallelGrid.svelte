<script lang="ts">
    import type { VerseRecord, Translation, CrossReference, LexiconEntry } from '@codex-scriptura/core';
    import { getCrossReferencesForChapter, parseAlignment, getLexiconEntry } from '@codex-scriptura/db';
    import type { PaneState } from '$lib/stores/splitPanes.svelte';
    import { renderVerseHtmlWithDivergence, getEntitiesForVerse, parseWjRanges, formatOsisLabel, verseHighlightColor } from '$lib/utils/verse-render';
    import { scrollFraction, fractionToScrollTop } from '$lib/utils/splitLayout';
    import { computeChapterDivergence, chapterDivergenceKey, hasDivergence, type Divergence, type Severity } from '$lib/engines/divergence';
    import { verseHover } from '$lib/actions/verseHover';

    let {
        panes,
        translations,
        bookName,
        showVerseNumbers,
        showRedLetters,
        showRefs,
        showDivergence,
        mapOpen,
        onCloseColumn,
        onSwitchTranslation,
        onNavigateToVerse,
        onScrollFraction,
    }: {
        /** Lead pane first; every pane shows the lead's book+chapter in its own translation. */
        panes: PaneState[];
        translations: Translation[];
        bookName: string;
        showVerseNumbers: boolean;
        showRedLetters: boolean;
        showRefs: boolean;
        showDivergence: boolean;
        mapOpen: boolean;
        onCloseColumn: (paneIdx: number) => void;
        onSwitchTranslation: (paneIdx: number, translationId: string) => void;
        onNavigateToVerse: (book: string, chapter: number, verse: number) => void;
        onScrollFraction?: (fraction: number) => void;
    } = $props();

    let lead = $derived(panes[0]);

    // ─── Per-translation identity (stable colors + published metadata) ─
    const COLUMN_COLORS: Record<string, string> = {
        KJV: '#d4a054', ASV: '#60a5fa', WEB: '#34d399', DBY: '#a78bfa', BSB: '#f472b6', OEB: '#2dd4bf',
    };
    const PALETTE = Object.values(COLUMN_COLORS);
    function colorFor(id: string): string {
        if (COLUMN_COLORS[id]) return COLUMN_COLORS[id];
        let h = 0;
        for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        return PALETTE[h % PALETTE.length];
    }
    const TRANSLATION_META: Record<string, { year: string; philosophy: string }> = {
        KJV: { year: '1611', philosophy: 'formal equivalence' },
        ASV: { year: '1901', philosophy: 'formal equivalence' },
        WEB: { year: '2000', philosophy: 'formal equivalence' },
        DBY: { year: '1890', philosophy: 'literal' },
        BSB: { year: '2016', philosophy: 'optimal equivalence' },
        OEB: { year: 'in progress', philosophy: 'open, modern' },
    };
    function identityLine(id: string): string {
        const abbr = translations.find((t) => t.id === id)?.abbreviation ?? id;
        const meta = TRANSLATION_META[id];
        return meta ? `${abbr} · ${meta.year} · ${meta.philosophy}` : abbr;
    }

    // ─── Column availability (never silently fall back, issue spec) ─
    type ColState = { ok: boolean; notice: string };
    let colStates = $derived(panes.map((pane): ColState => {
        if (pane.loading) return { ok: true, notice: '' };
        const abbr = translations.find((t) => t.id === pane.translation)?.abbreviation ?? pane.translation;
        if (pane.availableBooks.length === 0) return { ok: false, notice: `${abbr} not installed - import it` };
        if (!pane.availableBooks.includes(lead.book)) return { ok: false, notice: `${bookName} is not in ${abbr}` };
        return { ok: true, notice: '' };
    }));

    // ─── Row model: union of verse numbers, aligned by construction ─
    type Row = { num: number; osisId: string; cells: (VerseRecord | undefined)[] };
    let rows = $derived.by((): Row[] => {
        const maps = panes.map((p) => new Map(p.verses.map((v) => [v.verse, v])));
        const nums = new Set<number>();
        for (const p of panes) for (const v of p.verses) nums.add(v.verse);
        return [...nums].sort((a, b) => a - b).map((num) => ({
            num,
            osisId: `${lead.book}.${lead.chapter}.${num}`,
            cells: maps.map((m) => m.get(num)),
        }));
    });

    // ─── Cross-references (lead column only, behind showRefs) ─────
    let chapterXrefs = $state<Map<string, CrossReference[]>>(new Map());
    let expandedXref = $state<number | null>(null);
    $effect(() => {
        const book = lead.book;
        const chapter = lead.chapter;
        let active = true;
        expandedXref = null;
        getCrossReferencesForChapter(book, chapter).then((map) => {
            if (active) chapterXrefs = map;
        });
        return () => { active = false; };
    });

    function handleXrefClick(osisId: string) {
        const parts = osisId.split('.');
        if (parts.length < 3) return;
        const ch = parseInt(parts[1], 10);
        const v = parseInt(parts[2], 10);
        if (!isNaN(ch) && !isNaN(v)) onNavigateToVerse(parts[0], ch, v);
    }

    // ─── Divergence (computed off-frame, memoized per chapter) ────
    let divergence = $state<Map<string, Divergence>>(new Map());
    $effect(() => {
        const currentRows = rows;
        const ids = panes.map((p) => p.translation);
        if (panes.length < 2 || panes.some((p) => p.loading)) {
            divergence = new Map();
            return;
        }
        const key = chapterDivergenceKey(lead.book, lead.chapter, ids);
        let active = true;
        const rowRecords = currentRows.map((row) => {
            const rec: Record<string, VerseRecord> = {};
            row.cells.forEach((v, i) => { if (v) rec[ids[i]] = v; });
            return rec;
        });
        computeChapterDivergence(key, rowRecords).then((map) => {
            if (active) divergence = map;
        });
        return () => { active = false; };
    });

    function dotTitle(d: Divergence, row: Row): string {
        const leadSpans = d.spans[lead.translation] ?? Object.values(d.spans)[0] ?? [];
        const source = d.spans[lead.translation] ? row.cells[0]?.text : undefined;
        const words = source
            ? leadSpans.slice(0, 3).map(([s, e]) => `"${source.slice(s, e)}"`).join(', ')
            : '';
        const grade = d.severity === 'high' ? 'High' : d.severity === 'med' ? 'Medium' : 'Low';
        return words ? `${grade} divergence - renderings differ at ${words}` : `${grade} divergence between translations`;
    }

    function cellHtml(v: VerseRecord, translationId: string): string {
        const d = divergence.get(v.osisId);
        return renderVerseHtmlWithDivergence(
            v.text,
            getEntitiesForVerse(v, lead.enrichment, lead.book),
            parseWjRanges(v.wj),
            { redLetters: showRedLetters },
            d?.spans[translationId]
        );
    }

    // ─── Divergence Map cards ─────────────────────────────────────
    type Card = {
        osisId: string;
        num: number;
        severity: Severity;
        renders: { id: string; abbr: string; color: string; text: string }[];
    };
    let cards = $derived.by((): Card[] => {
        const list: Card[] = [];
        for (const row of rows) {
            const d = divergence.get(row.osisId);
            if (!d || !hasDivergence(d) || d.severity === 'low') continue;
            list.push({
                osisId: row.osisId,
                num: row.num,
                severity: d.severity,
                renders: panes.map((pane, i) => ({
                    id: pane.translation,
                    abbr: translations.find((t) => t.id === pane.translation)?.abbreviation ?? pane.translation,
                    color: colorFor(pane.translation),
                    text: row.cells[i]?.text ?? '',
                })).filter((r) => r.text),
            });
        }
        // Highest severity first, then canonical order
        const rank: Record<Severity, number> = { high: 0, med: 1, low: 2 };
        return list.sort((a, b) => rank[a.severity] - rank[b.severity] || a.num - b.num);
    });

    // Lemma headers: only when the lead's word alignment covers the first
    // divergent span AND the lexicon has the entry - never a placeholder.
    let cardLex = $state<Record<string, { lemma: string; translit: string; strongs: string }>>({});
    $effect(() => {
        const wanted = cards.map((c) => c.osisId);
        const dv = divergence;
        let active = true;
        (async () => {
            const found: Record<string, { lemma: string; translit: string; strongs: string }> = {};
            for (const osisId of wanted) {
                const d = dv.get(osisId);
                const leadVerse = rows.find((r) => r.osisId === osisId)?.cells[0];
                const span = d?.spans[lead.translation]?.[0];
                if (!leadVerse?.align || !span) continue;
                const aligned = parseAlignment(leadVerse.align).find((a) => a.start < span[1] && a.end > span[0]);
                const strongs = aligned?.strongs[0];
                if (!strongs) continue;
                const entry: LexiconEntry | undefined = await getLexiconEntry(strongs);
                if (entry) found[osisId] = { lemma: entry.lemma, translit: entry.transliteration, strongs };
            }
            if (active) cardLex = found;
        })();
        return () => { active = false; };
    });

    // ─── Scroll (single container; fraction only for persistence) ─
    let scrollEl: HTMLDivElement | undefined = $state();
    let suppressScrollEvent = false;

    function handleScroll() {
        if (suppressScrollEvent) {
            suppressScrollEvent = false;
            return;
        }
        if (!scrollEl) return;
        onScrollFraction?.(scrollFraction(scrollEl.scrollTop, scrollEl.scrollHeight, scrollEl.clientHeight));
    }

    export function setScrollFraction(fraction: number) {
        if (!scrollEl) return;
        const target = fractionToScrollTop(fraction, scrollEl.scrollHeight, scrollEl.clientHeight);
        if (Math.abs(scrollEl.scrollTop - target) < 1) return;
        suppressScrollEvent = true;
        scrollEl.scrollTop = target;
    }

    export function flashVerse(verseNum: number) {
        const el = scrollEl?.querySelector(`#verse-${verseNum}`) as HTMLElement | null;
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.remove('verse-flash');
        void el.offsetWidth;
        el.classList.add('verse-flash');
        el.addEventListener('animationend', () => el.classList.remove('verse-flash'), { once: true });
    }

    let anyLoading = $derived(panes.some((p) => p.loading));
</script>

<div class="parallel-wrap">
    <div class="parallel-scroll" bind:this={scrollEl} onscroll={handleScroll}>
        <div
            class="parallel-grid"
            class:dv-off={!showDivergence}
            class:cols-3={panes.length >= 3}
            style="--cols: 46px repeat({panes.length}, 1fr)"
        >
            <!-- Sticky identity headers: translation identity ONLY -->
            <div class="col-headers">
                <div class="gutter-head"></div>
                {#each panes as pane, i (pane.id)}
                    <div class="col-head" style="--col-color: {colorFor(pane.translation)}">
                        <div class="col-head-top">
                            {#if i === 0}<span class="lead-pill">LEAD</span>{/if}
                            <select
                                class="col-translation"
                                value={pane.translation}
                                onchange={(e) => onSwitchTranslation(i, (e.target as HTMLSelectElement).value)}
                                aria-label="Column translation"
                            >
                                {#each translations as t (t.id)}
                                    <option value={t.id}>{t.name}</option>
                                {/each}
                            </select>
                            {#if i > 0}
                                <button class="col-close" onclick={() => onCloseColumn(i)} aria-label="Close column" title="Close column">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M18 6L6 18M6 6l12 12" />
                                    </svg>
                                </button>
                            {/if}
                        </div>
                        <div class="col-head-meta">{identityLine(pane.translation)}</div>
                        {#if !colStates[i].ok}
                            <div class="col-notice">{colStates[i].notice}</div>
                        {/if}
                    </div>
                {/each}
            </div>

            {#if anyLoading}
                <div class="grid-loading">
                    <div class="loading-shimmer"></div>
                    <div class="loading-shimmer short"></div>
                    <div class="loading-shimmer"></div>
                </div>
            {:else}
                <h1 class="grid-heading">{bookName} {lead.chapter}</h1>
                {#each rows as row (row.num)}
                    {@const refs = chapterXrefs.get(row.osisId)}
                    {@const refCount = refs?.length ?? 0}
                    {@const d = divergence.get(row.osisId)}
                    {@const highlight = verseHighlightColor(lead.chapter, row.num, lead.allBookAnnotations)}
                    <div class="verse-row" id="verse-{row.num}" style={highlight ? `background-color: ${highlight};` : ''}>
                        <div class="gutter">
                            {#if showVerseNumbers}
                                <span class="gutter-num">{row.cells[0]?.verseEnd ? `${row.num}–${row.cells[0].verseEnd}` : row.num}</span>
                            {/if}
                            {#if showDivergence && d && hasDivergence(d)}
                                <span class="dv-dot dv-{d.severity}" title={dotTitle(d, row)}></span>
                            {/if}
                        </div>
                        {#each panes as pane, i (pane.id)}
                            {@const v = row.cells[i]}
                            <div class="verse-cell" style="--col-color: {colorFor(pane.translation)}">
                                {#if v}
                                    {@html cellHtml(v, pane.translation)}{#if i === 0 && showRefs && refCount > 0}<span
                                        class="xref-toggle"
                                        class:active={expandedXref === row.num}
                                        role="button"
                                        tabindex="0"
                                        title="{refCount} cross-reference{refCount === 1 ? '' : 's'}"
                                        onclick={() => expandedXref = expandedXref === row.num ? null : row.num}
                                        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); expandedXref = expandedXref === row.num ? null : row.num; } }}
                                    >{'⁠'}{refCount}</span>{/if}
                                {:else if !colStates[i].ok}
                                    <span class="cell-empty" aria-hidden="true"></span>
                                {:else}
                                    <span class="cell-missing" title="No corresponding verse">–</span>
                                {/if}
                            </div>
                        {/each}
                    </div>
                    {#if expandedXref === row.num && refs && refs.length > 0}
                        <div class="xref-strip">
                            <span class="xref-strip-label">Cross-refs</span>
                            {#each refs.slice(0, 8) as ref (ref.id)}
                                <button
                                    class="xref-pill"
                                    use:verseHover={{ osisId: ref.targetVerse, translationId: lead.translation }}
                                    onclick={() => handleXrefClick(ref.targetVerse)}
                                >{formatOsisLabel(ref.targetVerse)}</button>
                            {/each}
                            {#if refs.length > 8}
                                <span class="xref-strip-more">+{refs.length - 8} more</span>
                            {/if}
                        </div>
                    {/if}
                {/each}
            {/if}
        </div>
    </div>

    {#if mapOpen}
        <aside class="dv-map" aria-label="Divergence map">
            <div class="dv-map-header">
                <h3 class="dv-map-title">Divergence Map</h3>
                <span class="dv-map-count">{cards.length}</span>
            </div>
            {#if panes.length < 2}
                <p class="dv-map-empty">Open a second translation to compare renderings.</p>
            {:else if cards.length === 0}
                <p class="dv-map-empty">No significant divergence in this chapter - the open translations render it almost identically.</p>
            {:else}
                <div class="dv-cards">
                    {#each cards as card (card.osisId)}
                        <button class="dv-card" onclick={() => flashVerse(card.num)}>
                            <div class="dv-card-head">
                                <span class="dv-card-ref">{formatOsisLabel(card.osisId)}</span>
                                <span class="dv-pill dv-{card.severity}">{card.severity}</span>
                            </div>
                            {#if cardLex[card.osisId]}
                                <div class="dv-card-lex">
                                    <span class="dv-lex-lemma">{cardLex[card.osisId].lemma}</span>
                                    <span class="dv-lex-translit">{cardLex[card.osisId].translit}</span>
                                    <span class="dv-lex-strongs">{cardLex[card.osisId].strongs}</span>
                                </div>
                            {/if}
                            {#each card.renders as render (render.id)}
                                <div class="dv-render" style="--col-color: {render.color}">
                                    <span class="dv-render-abbr">{render.abbr}</span>
                                    <span class="dv-render-text">{render.text}</span>
                                </div>
                            {/each}
                        </button>
                    {/each}
                </div>
            {/if}
        </aside>
    {/if}
</div>

<style>
    .parallel-wrap {
        display: flex;
        flex: 1;
        min-height: 0;
        overflow: hidden;
    }

    .parallel-scroll {
        flex: 1;
        min-width: 0;
        overflow-y: auto;
    }

    .parallel-grid {
        /* Divergence shading is a custom property so the toolbar toggle
           flips it with zero re-render */
        --dv-shade: color-mix(in srgb, var(--color-accent) 16%, transparent);
        padding: 0 var(--space-4) var(--space-8);
    }
    .parallel-grid.dv-off {
        --dv-shade: transparent;
    }
    .parallel-grid :global(.dv) {
        background: var(--dv-shade);
        border-radius: 2px;
    }

    .grid-heading {
        font-family: var(--font-scripture);
        font-size: var(--font-size-2xl);
        font-weight: 600;
        color: var(--color-text-primary);
        letter-spacing: -0.01em;
        margin: var(--space-5) 0 var(--space-4);
        padding-left: 46px;
    }

    /* ─── Sticky identity headers ───────────────────── */
    .col-headers {
        display: grid;
        grid-template-columns: var(--cols);
        position: sticky;
        top: 0;
        z-index: 5;
        background: var(--color-bg-base);
        border-bottom: 1px solid var(--color-border);
    }

    .col-head {
        min-width: 0;
        padding: var(--space-2) var(--space-3);
        border-left: 2.5px solid var(--col-color);
        margin-right: var(--space-2);
    }

    .col-head-top {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-width: 0;
    }

    .lead-pill {
        flex: none;
        padding: 1px 6px;
        border-radius: 999px;
        background: var(--color-accent-subtle);
        color: var(--color-accent);
        font-family: var(--font-ui);
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.08em;
    }

    .col-translation {
        appearance: none;
        min-width: 0;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        background: transparent;
        border: none;
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 650;
        cursor: pointer;
        padding: 0;
    }
    .col-translation:hover,
    .col-translation:focus {
        color: var(--color-accent);
        outline: none;
    }

    .col-close {
        flex: none;
        margin-left: auto;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        background: none;
        border: none;
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
        cursor: pointer;
    }
    .col-close:hover {
        color: var(--color-error, #ef4444);
        background: var(--color-bg-hover);
    }

    .col-head-meta {
        margin-top: 2px;
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .col-notice {
        margin-top: var(--space-2);
        padding: var(--space-1) var(--space-2);
        border-radius: var(--radius-sm);
        background: var(--color-bg-surface);
        border: 1px dashed var(--color-border);
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
    }

    /* ─── Verse rows ────────────────────────────────── */
    .verse-row {
        display: grid;
        grid-template-columns: var(--cols);
        border-radius: var(--radius-sm);
        transition: background var(--transition-fast);
    }
    .verse-row:hover {
        background: var(--color-accent-subtle);
    }

    .gutter {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
        padding: var(--space-2) var(--space-2) 0 0;
        user-select: none;
    }
    .gutter-num {
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 700;
        color: var(--color-verse-number);
        line-height: 1.6;
    }

    .dv-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex: none;
    }
    .dv-dot.dv-low { background: var(--color-text-faint, #6b7280); opacity: 0.5; }
    .dv-dot.dv-med { background: var(--color-warning, #f59e0b); }
    .dv-dot.dv-high { background: var(--color-error, #ef4444); }

    .verse-cell {
        min-width: 0;
        padding: var(--space-2) var(--space-3);
        border-left: 2.5px solid color-mix(in srgb, var(--col-color) 42%, transparent);
        margin-right: var(--space-2);
        font-family: var(--font-scripture);
        font-size: var(--font-reader-size, var(--font-size-lg));
        line-height: var(--reader-line-height, 1.8);
        color: var(--color-text-primary);
        overflow-wrap: break-word;
    }
    /* Three translations up: step the reader size down one notch */
    .parallel-grid.cols-3 .verse-cell {
        font-size: calc(var(--font-reader-size, 18px) - 2px);
    }

    .verse-cell :global(.wj) {
        color: var(--color-red-letter, #dc2626);
    }
    :global([data-theme='dark']) .verse-cell :global(.wj) {
        color: var(--color-red-letter-dark, #ef4444);
    }

    .cell-missing {
        color: var(--color-text-faint);
    }

    /* ─── Cross-reference toggle (lead column only) ─── */
    .xref-toggle {
        white-space: nowrap;
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: 600;
        line-height: 1;
        vertical-align: super;
        cursor: pointer;
        padding: 0 3px;
        color: var(--color-text-muted);
        opacity: 0.55;
        transition: opacity var(--transition-fast), color var(--transition-fast);
    }
    .xref-toggle:hover,
    .xref-toggle.active {
        opacity: 1;
        color: var(--color-accent);
    }
    .xref-toggle:focus-visible {
        opacity: 1;
        outline: 1px solid var(--color-accent);
        outline-offset: 2px;
        border-radius: 3px;
    }

    .xref-strip {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: var(--space-1) var(--space-2);
        padding: var(--space-1) var(--space-2) var(--space-2) 46px;
    }
    .xref-strip-label {
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--color-text-faint);
    }
    .xref-pill {
        padding: 2px 8px;
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: 999px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        cursor: pointer;
        transition: all var(--transition-fast);
    }
    .xref-pill:hover {
        color: var(--color-accent);
        border-color: var(--color-accent);
    }
    .xref-strip-more {
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        color: var(--color-text-faint);
    }

    /* ─── Loading ───────────────────────────────────── */
    .grid-loading {
        padding: var(--space-8) var(--space-4);
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
    }
    .loading-shimmer {
        height: 16px;
        border-radius: var(--radius-sm);
        background: linear-gradient(90deg, var(--color-bg-surface) 25%, var(--color-bg-hover) 50%, var(--color-bg-surface) 75%);
        background-size: 200% 100%;
        animation: gridShimmer 1.4s infinite;
    }
    .loading-shimmer.short { width: 60%; }
    @keyframes gridShimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
    }

    /* ─── Divergence Map panel ──────────────────────── */
    .dv-map {
        flex: none;
        width: 320px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        border-left: 1px solid var(--color-border);
        background: var(--color-bg-elevated);
        overflow: hidden;
    }
    .dv-map-header {
        display: flex;
        align-items: baseline;
        gap: var(--space-2);
        padding: var(--space-3) var(--space-4);
        border-bottom: 1px solid var(--color-border);
    }
    .dv-map-title {
        margin: 0;
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 650;
        color: var(--color-text-primary);
    }
    .dv-map-count {
        font-family: var(--font-mono, monospace);
        font-size: var(--font-size-xs);
        color: var(--color-text-faint);
    }
    .dv-map-empty {
        padding: var(--space-4);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
    }
    .dv-cards {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        padding: var(--space-3);
    }
    .dv-card {
        text-align: left;
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-2) var(--space-3);
        cursor: pointer;
        transition: border-color var(--transition-fast);
        font-family: var(--font-ui);
    }
    .dv-card:hover {
        border-color: var(--color-accent);
    }
    .dv-card-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
    }
    .dv-card-ref {
        font-size: var(--font-size-sm);
        font-weight: 650;
        color: var(--color-text-primary);
    }
    .dv-pill {
        padding: 1px 8px;
        border-radius: 999px;
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
    }
    .dv-pill.dv-med { background: color-mix(in srgb, var(--color-warning, #f59e0b) 18%, transparent); color: var(--color-warning, #f59e0b); }
    .dv-pill.dv-high { background: color-mix(in srgb, var(--color-error, #ef4444) 18%, transparent); color: var(--color-error, #ef4444); }

    .dv-card-lex {
        display: flex;
        align-items: baseline;
        gap: var(--space-2);
        margin-top: var(--space-1);
    }
    .dv-lex-lemma {
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
    }
    .dv-lex-translit {
        font-size: var(--font-size-xs);
        font-style: italic;
        color: var(--color-text-muted);
    }
    .dv-lex-strongs {
        font-family: var(--font-mono, monospace);
        font-size: 10px;
        color: var(--color-text-faint);
    }

    .dv-render {
        display: flex;
        gap: var(--space-2);
        margin-top: var(--space-2);
        padding-left: var(--space-2);
        border-left: 2.5px solid var(--col-color);
    }
    .dv-render-abbr {
        flex: none;
        font-size: 10px;
        font-weight: 700;
        color: var(--col-color);
        line-height: 1.7;
    }
    .dv-render-text {
        font-family: var(--font-scripture);
        font-size: var(--font-size-xs);
        line-height: 1.55;
        color: var(--color-text-secondary);
    }

    /* Stack columns on phones; the workspace hides aligned extras there anyway */
    @media (max-width: 768px) {
        .dv-map { display: none; }
    }
</style>
