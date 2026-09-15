<script lang="ts">
    import BookSelector from '$lib/components/BookSelector.svelte';
    import SelectTrigger from '$lib/components/ui/SelectTrigger.svelte';
    import { findBook } from '@codex-scriptura/core';
    import type { Translation } from '@codex-scriptura/core';
    import type { PaneState } from '$lib/stores/splitPanes.svelte';
    import { requestPaneTranslation } from '$lib/stores/translationLibrary.svelte';

    let {
        pane,
        translations,
        canClose = false,
        onClose,
    }: {
        pane: PaneState;
        translations: Translation[];
        /** The primary pane cannot be closed. */
        canClose?: boolean;
        onClose?: () => void;
    } = $props();

    function getBookDisplayName(bookId: string): string {
        return findBook(bookId)?.name ?? bookId;
    }
    // Coverage labeling for partial translations (known-issues #30)
    function translationLabel(t: Translation): string {
        return t.coverage ? `${t.abbreviation} (partial)` : t.abbreviation;
    }
    function translationTitle(t: Translation): string {
        return t.coverage ? `${t.name}: ${t.coverage} (in-progress translation)` : t.name;
    }
</script>

<div class="pane-header">
    <div class="pane-nav-section pane-nav-left">
        <SelectTrigger
            expanded={pane.bookSelectorOpen}
            onclick={() => pane.bookSelectorOpen = !pane.bookSelectorOpen}
        >
            <span class="book-name">{getBookDisplayName(pane.book)}</span>
            <span class="chapter-badge">{pane.chapter}</span>
        </SelectTrigger>
    </div>

    <div class="pane-nav-section pane-nav-center">
        <button class="nav-btn" onclick={() => pane.prevChapter()} aria-label="Previous chapter">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 18l-6-6 6-6" />
            </svg>
        </button>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="chapter-pills" bind:this={pane.chapterPillsEl} onwheel={(e) => pane.handleChapterWheel(e)}>
            {#each pane.availableChapters as ch}
                <button
                    class="chapter-pill"
                    class:active={ch === pane.chapter}
                    onclick={() => pane.navigateToChapter(ch)}
                >{ch}</button>
            {/each}
        </div>
        <button class="nav-btn" onclick={() => pane.nextChapter()} aria-label="Next chapter">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6" />
            </svg>
        </button>
    </div>

    <div class="pane-nav-section pane-nav-right">
        {#if pane.enrichment && (pane.enrichment.persons.length > 0 || pane.enrichment.places.length > 0 || pane.enrichment.events.length > 0)}
            <button
                class="nav-btn"
                onclick={() => pane.panelMode = pane.panelMode === 'list' ? 'none' : 'list'}
                aria-label="Toggle Insights Panel"
                aria-pressed={pane.panelMode === 'list'}
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                </svg>
            </button>
        {/if}
        {#if translations.length > 1}
            <select
                class="translation-picker"
                value={pane.translation}
                onchange={(e) => requestPaneTranslation(pane, (e.target as HTMLSelectElement).value)}
                title={translationTitle(translations.find((t) => t.id === pane.translation) ?? translations[0])}
            >
                {#each translations as t}
                    <option value={t.id} title={translationTitle(t)}>{translationLabel(t)}</option>
                {/each}
            </select>
        {:else}
            <span class="translation-badge">{pane.translation}</span>
        {/if}
        {#if canClose}
            <button
                class="nav-btn pane-close-btn"
                onclick={() => onClose?.()}
                aria-label="Close pane"
                title="Close pane"
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                </svg>
            </button>
        {/if}
    </div>
</div>

<BookSelector {pane} {translations} inPane />

<style>
    .pane-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-2) var(--space-3);
        background: var(--color-bg-elevated);
        border-bottom: 1px solid var(--color-border);
        height: var(--header-height);
        flex-shrink: 0;
        gap: var(--space-2);
    }

    .pane-nav-section {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        flex-shrink: 0;
    }
    .pane-nav-center {
        flex: 1;
        justify-content: center;
        overflow: hidden;
    }

    .chapter-badge {
        background: var(--color-accent-subtle);
        color: var(--color-accent);
        padding: 0 var(--space-2);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-xs);
        font-weight: 700;
    }

    .nav-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        background: none;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: all var(--transition-fast);
        flex-shrink: 0;
    }
    .nav-btn:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
        border-color: var(--color-accent);
    }

    .chapter-pills {
        display: flex;
        flex: 0 1 auto;
        min-width: 0;
        gap: 2px;
        overflow-x: auto;
        overflow-y: hidden;
        padding: var(--space-1) 0;
        scrollbar-width: none;
    }
    .chapter-pills::-webkit-scrollbar { display: none; }

    .chapter-pill {
        padding: var(--space-1) var(--space-2);
        background: none;
        border: none;
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 500;
        cursor: pointer;
        transition: all var(--transition-fast);
        flex-shrink: 0;
        min-width: 28px;
    }
    .chapter-pill:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
    }
    .chapter-pill.active {
        color: var(--color-accent);
        background: var(--color-accent-subtle);
        font-weight: 700;
    }

    .translation-picker {
        /* appearance: none drops the UA form-control chrome (border + arrow),
           which clashes with the theme now that color-scheme is set */
        appearance: none;
        padding: var(--space-1) var(--space-2);
        padding-right: calc(var(--space-2) + 16px);
        /* Solid, not the translucent surface wash: Chromium derives the
           popup's light/dark rendering from this color */
        background-color: var(--color-bg-control);
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%237a8494' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right var(--space-2) center;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 600;
        cursor: pointer;
        transition: border-color var(--transition-fast), background-color var(--transition-fast);
    }
    .translation-picker:hover {
        background-color: var(--color-bg-control-hover);
    }
    .translation-picker:focus {
        outline: none;
        border-color: var(--color-accent);
    }
    .translation-badge {
        padding: var(--space-1) var(--space-3);
        background: var(--color-accent-subtle);
        color: var(--color-accent);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-xs);
        font-weight: 700;
    }

    .pane-close-btn:hover {
        color: var(--color-error, #ef4444);
        border-color: var(--color-error, #ef4444);
    }

    @media (max-width: 768px) {
        .chapter-pills { display: none; }
        .pane-nav-center { min-width: max-content; }
        .book-name {
            max-width: 11ch;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
    }
</style>
