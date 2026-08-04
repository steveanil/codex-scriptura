<script module lang="ts">
    export type DivergenceClickTarget = {
        osisId: string;
        verse: number;
        /** Char span of the clicked shaded word in the SOURCE pane's verse text. */
        start: number;
        end: number;
        /** Translation of the pane that was clicked. */
        translation: string;
        /** Screen anchor (center-bottom of the clicked word). */
        x: number;
        y: number;
    };
</script>

<script lang="ts">
    import type { Translation, LexiconEntry } from '@codex-scriptura/core';
    import { parseAlignment, getLexiconEntry } from '@codex-scriptura/db';
    import type { PaneState } from '$lib/stores/splitPanes.svelte';
    import { escapeHtml, formatOsisLabel } from '$lib/utils/verse-render';
    import { translationColor } from '$lib/utils/translation-colors';
    import type { Divergence } from '$lib/engines/divergence';

    let {
        target,
        panes,
        translations,
        divergence,
        onClose,
    }: {
        target: DivergenceClickTarget;
        /** The compared panes (lead first), all on the target's passage. */
        panes: PaneState[];
        translations: Translation[];
        divergence: Map<string, Divergence>;
        onClose: () => void;
    } = $props();

    let popoverEl: HTMLDivElement | undefined = $state();
    let pos = $state({ left: 0, top: 0 });

    function verseFor(pane: PaneState) {
        return pane.verses.find((v) => v.osisId === target.osisId);
    }

    let sourceVerse = $derived.by(() => {
        const pane = panes.find((p) => p.translation === target.translation);
        return pane ? verseFor(pane) : undefined;
    });
    let clickedWord = $derived(sourceVerse ? sourceVerse.text.slice(target.start, target.end).trim() : '');

    /** The verse text with this translation's divergent spans emphasized. */
    function emphasize(text: string, spans: [number, number][] | undefined): string {
        if (!spans?.length) return escapeHtml(text);
        let html = '';
        let p = 0;
        for (const [s, e] of spans) {
            html += escapeHtml(text.slice(p, Math.max(p, s)));
            html += `<mark>${escapeHtml(text.slice(Math.max(p, s), e))}</mark>`;
            p = Math.max(p, e);
        }
        return html + escapeHtml(text.slice(p));
    }

    let renders = $derived.by(() => {
        const d = divergence.get(target.osisId);
        return panes
            .map((pane) => {
                const v = verseFor(pane);
                if (!v) return null;
                return {
                    id: pane.translation,
                    abbr: translations.find((t) => t.id === pane.translation)?.abbreviation ?? pane.translation,
                    color: translationColor(pane.translation),
                    html: emphasize(v.text, d?.spans[pane.translation]),
                };
            })
            .filter((r) => r !== null);
    });

    // Original-language header: only when the clicked pane's word alignment
    // covers the span AND the lexicon has the entry - never a placeholder.
    let lex = $state<{ lemma: string; translit: string; strongs: string } | null>(null);
    $effect(() => {
        const v = sourceVerse;
        const { start, end } = target;
        lex = null;
        if (!v?.align) return;
        const aligned = parseAlignment(v.align).find((a) => a.start < end && a.end > start);
        const strongs = aligned?.strongs[0];
        if (!strongs) return;
        let active = true;
        getLexiconEntry(strongs).then((entry: LexiconEntry | undefined) => {
            if (active && entry) lex = { lemma: entry.lemma, translit: entry.transliteration, strongs };
        });
        return () => { active = false; };
    });

    // Anchor under the clicked word, clamped to the viewport; flip above
    // when there is no room below.
    $effect(() => {
        void target;
        if (!popoverEl) return;
        const r = popoverEl.getBoundingClientRect();
        let left = target.x - r.width / 2;
        left = Math.min(Math.max(10, left), window.innerWidth - r.width - 10);
        let top = target.y + 8;
        if (top + r.height > window.innerHeight - 10) top = Math.max(10, target.y - r.height - 30);
        pos = { left, top };
    });

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') onClose();
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="dv-popover-overlay" onclick={onClose} role="presentation"></div>
<div class="dv-popover" bind:this={popoverEl} style="left: {pos.left}px; top: {pos.top}px" role="dialog" aria-label="Compare renderings">
    <div class="dv-popover-head">
        <span class="dv-popover-ref">{formatOsisLabel(target.osisId)}</span>
        {#if clickedWord}<span class="dv-popover-word">"{clickedWord}"</span>{/if}
        <button class="dv-popover-close" onclick={onClose} aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12" />
            </svg>
        </button>
    </div>

    {#if lex}
        <div class="dv-popover-lex">
            <span class="dv-lex-lemma">{lex.lemma}</span>
            <span class="dv-lex-translit">{lex.translit}</span>
            <a
                class="dv-word-study-link"
                href="/search?q={encodeURIComponent(lex.strongs)}&mode=concordance"
                title="Every rendering of {lex.strongs} across your translations"
            >Word Study {lex.strongs} &rarr;</a>
        </div>
    {/if}

    <div class="dv-popover-renders">
        {#each renders as render (render.id)}
            <div class="dv-render" style="--col-color: {render.color}">
                <span class="dv-render-abbr">{render.abbr}</span>
                <span class="dv-render-text">{@html render.html}</span>
            </div>
        {/each}
    </div>
</div>

<style>
    .dv-popover-overlay {
        position: fixed;
        inset: 0;
        z-index: 99;
    }

    .dv-popover {
        position: fixed;
        z-index: 100;
        width: 380px;
        max-width: calc(100vw - 20px);
        max-height: 60vh;
        overflow-y: auto;
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-xl);
        padding: var(--space-3) var(--space-4);
        animation: dvPopIn 0.12s ease-out;
    }
    @keyframes dvPopIn {
        from { opacity: 0; transform: translateY(-4px); }
        to   { opacity: 1; transform: translateY(0); }
    }

    .dv-popover-head {
        display: flex;
        align-items: baseline;
        gap: var(--space-2);
    }
    .dv-popover-ref {
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 650;
        color: var(--color-text-primary);
    }
    .dv-popover-word {
        font-family: var(--font-scripture);
        font-size: var(--font-size-sm);
        font-style: italic;
        color: var(--color-text-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }
    .dv-popover-close {
        margin-left: auto;
        display: flex;
        align-items: center;
        justify-content: center;
        flex: none;
        width: 22px;
        height: 22px;
        background: none;
        border: none;
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
        cursor: pointer;
    }
    .dv-popover-close:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
    }

    .dv-popover-lex {
        display: flex;
        align-items: baseline;
        gap: var(--space-2);
        margin-top: var(--space-2);
        padding-bottom: var(--space-2);
        border-bottom: 1px solid var(--color-border);
    }
    .dv-lex-lemma {
        font-size: var(--font-size-base);
        color: var(--color-text-primary);
    }
    .dv-lex-translit {
        font-size: var(--font-size-xs);
        font-style: italic;
        color: var(--color-text-muted);
    }
    .dv-word-study-link {
        margin-left: auto;
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 600;
        color: var(--color-accent);
        text-decoration: none;
        white-space: nowrap;
    }
    .dv-word-study-link:hover {
        text-decoration: underline;
    }

    .dv-popover-renders {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        margin-top: var(--space-2);
    }
    .dv-render {
        display: flex;
        gap: var(--space-2);
        padding-left: var(--space-2);
        border-left: 2.5px solid var(--col-color);
    }
    .dv-render-abbr {
        flex: none;
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: 700;
        color: var(--col-color);
        line-height: 1.8;
    }
    .dv-render-text {
        font-family: var(--font-scripture);
        font-size: var(--font-size-sm);
        line-height: 1.6;
        color: var(--color-text-secondary);
    }
    .dv-render-text :global(mark) {
        background: color-mix(in srgb, var(--col-color) 22%, transparent);
        color: var(--color-text-primary);
        border-radius: 2px;
        padding: 0 1px;
    }
</style>
