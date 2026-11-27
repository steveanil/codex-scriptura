<script lang="ts">
    import { goto } from '$app/navigation';
    import type { Annotation, ScratchPadVerseBlock } from '@codex-scriptura/core';
    import { bookDisplayName } from '@codex-scriptura/core';
    import { getThemes, themeSlug, type ThemeSummary } from '@codex-scriptura/db';
    import { coveringAnnotations, planHighlight } from '$lib/annotations/selection';
    import { themeTagsForSelection } from '$lib/annotations/create';
    import { verseToScratchBlock } from '$lib/utils/scratchPad';
    import { isVerseInAnnotation } from '$lib/utils/verse-render';
    import { formatVersesForCopy } from '$lib/utils/copy-verses';
    import { ui } from '$lib/stores/ui.svelte';
    import { toast } from '$lib/stores/toast.svelte';
    import type { PaneState } from '$lib/stores/splitPanes.svelte';

    type HighlightColor = { name: string; id: string; value: string };

    let {
        pane,
        highlightColors,
        paneAnnotations,
        onSaveAnnotation,
        onDeleteAnnotations,
        onOpenAnnotationSidebar,
        onSendToScratchPad,
    }: {
        /** The pane whose selection this acts on; actions clear pane.selectedVerses. */
        pane: PaneState;
        highlightColors: HighlightColor[];
        /** The annotations the pane shows: its book's, with other translations' highlights left out. */
        paneAnnotations: Annotation[];
        onSaveAnnotation: (ann: Annotation) => Promise<void>;
        onDeleteAnnotations: (ids: string[]) => Promise<void>;
        onOpenAnnotationSidebar: () => void;
        /** Quotes the selected verses into the workspace scratch pad (issue #23). */
        onSendToScratchPad?: (blocks: ScratchPadVerseBlock[]) => void;
    } = $props();

    const bookId = $derived(pane.book);
    const bookName = $derived(bookDisplayName(pane.book));
    const chapter = $derived(pane.chapter);
    const translationId = $derived(pane.translation);
    const allBookAnnotations = $derived(pane.allBookAnnotations);

    async function copySelection() {
        const selected = pane.verses.filter((v) => pane.selectedVerses.includes(v.verse));
        const text = formatVersesForCopy(bookName, chapter, translationId, selected);
        try {
            await navigator.clipboard.writeText(text);
            toast.show(selected.length === 1 ? 'Copied 1 verse' : `Copied ${selected.length} verses`);
        } catch {
            toast.show('Copy failed - clipboard not available');
        }
    }

    function sendSelectionToScratchPad() {
        const blocks: ScratchPadVerseBlock[] = [];
        for (const num of pane.selectedVerses) {
            const rec = pane.verses.find((v) => v.verse === num);
            if (rec) blocks.push(verseToScratchBlock(rec, bookId, chapter, translationId));
        }
        onSendToScratchPad?.(blocks);
    }

    async function applyHighlight(colorValue: string) {
        if (pane.selectedVerses.length === 0) return;
        const records = planHighlight({
            book: bookId,
            chapter,
            verses: pane.selectedVerses,
            color: colorValue,
            translation: translationId,
            visible: $state.snapshot(paneAnnotations),
        });
        for (const r of records) await onSaveAnnotation(r);
        pane.selectedVerses = [];
    }

    let selectionNotes = $derived(coveringAnnotations(chapter, pane.selectedVerses, allBookAnnotations, 'note'));

    /** One note: open it in edit mode. Several: open the sidebar so the user picks. */
    function editSelectionNote() {
        const only = selectionNotes.length === 1 ? selectionNotes[0].id : null;
        onOpenAnnotationSidebar();
        if (only) ui.requestNoteEdit(only);
        pane.selectedVerses = [];
    }

    // ─── Theme threading (issue #22) ──────────────────────────

    let themeInputOpen = $state(false);
    let themeInput = $state('');
    let knownThemes = $state<ThemeSummary[]>([]);

    async function openThemeInput() {
        themeInputOpen = !themeInputOpen;
        if (themeInputOpen) knownThemes = await getThemes();
    }

    async function applyTheme() {
        const label = themeInput.trim();
        if (!label || pane.selectedVerses.length === 0) return;
        const slug = themeSlug(label);
        if (!slug) return;

        const tags = themeTagsForSelection({ book: bookId, chapter, verses: pane.selectedVerses, label, slug, existing: allBookAnnotations });
        for (const t of tags) await onSaveAnnotation(t);
        const tagged = tags.length;
        themeInput = '';
        themeInputOpen = false;
        pane.selectedVerses = [];
        toast.show(tagged > 0 ? `Tagged with "${label}"` : `Already tagged with "${label}"`);
    }

    async function removeHighlightsOnSelection() {
        if (pane.selectedVerses.length === 0) return;
        // Erase only what this pane shows - another translation's
        // highlights on the same verses are not visible here.
        const toDelete = paneAnnotations.filter(a =>
            a.type === 'highlight' &&
            pane.selectedVerses.some(v => isVerseInAnnotation(chapter, v, a))
        );
        if (toDelete.length > 0) {
            await onDeleteAnnotations(toDelete.map(a => a.id));
        }
        pane.selectedVerses = [];
    }
</script>

{#if pane.selectedVerses.length > 0}
    <div class="selection-toolbar">
        <span class="selection-count">{pane.selectedVerses.length} verses selected</span>

        <div class="toolbar-divider"></div>

        <div class="color-picker">
            {#each highlightColors as color}
                <button
                    class="color-btn"
                    style="background-color: {color.value}"
                    aria-label="Highlight {color.name}"
                    title="Highlight {color.name}"
                    onclick={() => applyHighlight(color.value)}
                ></button>
            {/each}
            <button
                class="color-btn eraser-btn"
                aria-label="Remove highlight"
                title="Remove highlight"
                onclick={removeHighlightsOnSelection}
            >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M20 20H7L3 16l11-11 6 6-4 4" /><path d="M6.0001 10L14 18" />
                </svg>
            </button>
        </div>

        <div class="toolbar-divider"></div>

        <button class="action-btn" onclick={onOpenAnnotationSidebar}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            Note
        </button>

        {#if selectionNotes.length > 0}
            <button class="action-btn" onclick={editSelectionNote} title="Edit the note on these verses">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9" />
                    <path d="M18.4 2.6a2 2 0 0 1 3 3L12 15l-4 1 1-4z" />
                </svg>
                {selectionNotes.length === 1 ? 'Edit note' : 'Edit notes'}
            </button>
        {/if}

        <button class="action-btn" class:active={themeInputOpen} onclick={openThemeInput} title="Tag with a theme and thread it across the whole Bible">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
            Theme
        </button>

        <button class="action-btn" onclick={copySelection}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Copy
        </button>

        {#if onSendToScratchPad}
            <button class="action-btn" id="scratch-pad-send" title="Quote the selected verses in the scratch pad" onclick={sendSelectionToScratchPad}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9l-5-6z" />
                    <path d="M16 3v6h5" />
                    <path d="M8 13h8M8 17h5" />
                </svg>
                Scratch
            </button>
        {/if}

        <button
            class="action-btn"
            title="Explore this verse's connections in the Scripture Graph"
            onclick={() => goto(`/graph?verse=${bookId}.${chapter}.${pane.selectedVerses[0]}`)}
        >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
                <path d="M8.5 8.5l7 7" /><path d="M15.5 8.5l-7 7" /><path d="M8.5 6h7" /><path d="M6 8.5v7" />
            </svg>
            Graph
        </button>

        <button class="action-btn" onclick={() => pane.selectedVerses = []}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12" />
            </svg>
            Clear
        </button>
    </div>

    {#if themeInputOpen}
        <div class="theme-popover">
            <!-- svelte-ignore a11y_autofocus -->
            <input
                class="theme-input"
                type="text"
                placeholder="Theme, e.g. covenant"
                autofocus
                bind:value={themeInput}
                list="theme-suggestions"
                onkeydown={(e) => {
                    if (e.key === 'Enter') applyTheme();
                    if (e.key === 'Escape') { themeInputOpen = false; themeInput = ''; }
                }}
            />
            <datalist id="theme-suggestions">
                {#each knownThemes as t}
                    <option value={t.label}>{t.count} tagged</option>
                {/each}
            </datalist>
            <button class="theme-apply-btn" onclick={applyTheme} disabled={!themeInput.trim()}>Tag</button>
        </div>
    {/if}
{/if}

<style>
    .selection-toolbar {
        position: fixed;
        bottom: var(--space-6);
        left: 50%;
        transform: translateX(-50%);
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-pill);
        box-shadow: var(--shadow-floating);
        padding: var(--space-2) var(--space-4);
        display: flex;
        align-items: center;
        gap: var(--space-3);
        z-index: 100;
        animation: slideUp 0.2s ease-out;
    }

    @keyframes slideUp {
        from { opacity: 0; transform: translate(-50%, 20px); }
        to { opacity: 1; transform: translate(-50%, 0); }
    }

    .selection-count {
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 600;
        color: var(--color-text-secondary);
        white-space: nowrap;
    }

    .toolbar-divider {
        width: 1px;
        height: 20px;
        background: var(--color-border);
    }

    .color-picker {
        display: flex;
        gap: var(--space-2);
    }

    .color-btn {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 2px solid transparent;
        cursor: pointer;
        transition: transform 0.1s;
    }
    .color-btn:hover {
        transform: scale(1.1);
        border-color: var(--color-text-primary);
    }

    .eraser-btn {
        background: var(--color-bg-surface) !important;
        border-color: var(--color-border-control) !important;
        color: var(--color-text-muted);
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .eraser-btn:hover {
        color: var(--color-danger);
        border-color: var(--color-danger) !important;
    }

    .theme-popover {
        position: fixed;
        bottom: calc(var(--space-6) + 56px);
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: var(--space-2);
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: var(--space-2) var(--space-3);
        box-shadow: var(--shadow-lg);
        z-index: 60;
    }
    .theme-input {
        width: 220px;
        background: var(--color-bg);
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        padding: var(--space-1) var(--space-2);
    }
    .theme-apply-btn {
        background: var(--color-accent);
        border: none;
        border-radius: var(--radius-sm);
        color: var(--color-on-accent, #fff);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 600;
        padding: var(--space-1) var(--space-3);
        cursor: pointer;
    }
    .theme-apply-btn:disabled {
        opacity: 0.5;
        cursor: default;
    }
    .action-btn.active {
        color: var(--color-accent);
    }
    .action-btn {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        background: none;
        border: none;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 500;
        cursor: pointer;
        padding: var(--space-1) var(--space-2);
        border-radius: var(--radius-sm);
        transition: background 0.1s;
    }
    .action-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }

    @media (max-width: 768px) {
        .selection-toolbar {
            bottom: var(--space-4);
            width: calc(100% - var(--space-8));
            justify-content: space-between;
            padding: var(--space-3) var(--space-4);
            border-radius: var(--radius-md);
            /* More actions than a phone is wide: scroll them instead of clipping. */
            overflow-x: auto;
        }
        .selection-toolbar > :global(*) { flex-shrink: 0; }
    }
</style>
