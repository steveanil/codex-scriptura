<script lang="ts">
    import type { Translation, LexiconEntry } from '@codex-scriptura/core';
    import { parseAlignment, getLexiconEntry } from '@codex-scriptura/db';
    import type { PaneState } from '$lib/stores/splitPanes.svelte';
    import { formatOsisLabel } from '$lib/utils/verse-render';
    import { translationColor } from '$lib/utils/translation-colors';
    import { buildChapterRows, buildDivergenceCards, type Divergence } from '$lib/engines/divergence';

    let {
        panes,
        translations,
        divergence,
        onJump,
    }: {
        /** Panes being compared - lead first, one per translation, all on the lead's passage. */
        panes: PaneState[];
        translations: Translation[];
        divergence: Map<string, Divergence>;
        onJump: (verseNum: number) => void;
    } = $props();

    let lead = $derived(panes[0]);

    // Rows and cards are pure engine data (buildChapterRows /
    // buildDivergenceCards); this component only adds display identity.
    let rows = $derived(buildChapterRows(panes.map((p) => ({ translation: p.translation, verses: p.verses }))));
    let cards = $derived(buildDivergenceCards(rows, divergence));

    function abbrOf(id: string): string {
        return translations.find((t) => t.id === id)?.abbreviation ?? id;
    }

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
                const leadVerse = rows.find((r) => r.osisId === osisId)?.cells[0]?.verse;
                const span = lead ? d?.spans[lead.translation]?.[0] : undefined;
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
</script>

<aside class="dv-map" aria-label="Divergence map">
    <div class="dv-map-header">
        <h3 class="dv-map-title">Divergence Map</h3>
        <span class="dv-map-count">{cards.length}</span>
    </div>
    {#if panes.length < 2}
        <p class="dv-map-empty">Show the same chapter in a second translation to compare renderings.</p>
    {:else if cards.length === 0}
        <p class="dv-map-empty">No significant divergence in this chapter - the open translations render it almost identically.</p>
    {:else}
        <div class="dv-cards">
            {#each cards as card (card.osisId)}
                <button class="dv-card" onclick={() => onJump(card.num)}>
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
                    {#each card.renders as render (render.translation)}
                        <div class="dv-render" style="--col-color: {translationColor(render.translation)}">
                            <span class="dv-render-abbr">{abbrOf(render.translation)}</span>
                            <span class="dv-render-text">{render.text}</span>
                        </div>
                    {/each}
                </button>
            {/each}
        </div>
    {/if}
</aside>

<style>
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

    /* Split panes stack on phones; the map is desktop furniture */
    @media (max-width: 768px) {
        .dv-map { display: none; }
    }
</style>
