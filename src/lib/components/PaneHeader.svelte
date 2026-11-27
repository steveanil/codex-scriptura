<script lang="ts">
    import PassagePicker from '$lib/components/PassagePicker.svelte';
    import SelectTrigger from '$lib/components/ui/SelectTrigger.svelte';
    import ChapterPills from '$lib/components/ChapterPills.svelte';
    import TranslationSelect from '$lib/components/TranslationSelect.svelte';
    import { chapterStripMode } from '$lib/utils/chapterStrip';
    import { bookDisplayName } from '@codex-scriptura/core';
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

    // Pill strip only when it fits (issue #246); otherwise the trigger is the chapter control.
    let centerWidth = $state(0);
    const stripMode = $derived(chapterStripMode(pane.availableChapters.length, centerWidth));
</script>

<div class="pane-header">
    <!-- Locate zone: prev/next and the one book-and-chapter trigger -->
    <div class="pane-nav-section pane-nav-left">
        <button class="nav-btn" onclick={() => pane.prevChapter()} aria-label="Previous chapter" title="Previous chapter">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
            </svg>
        </button>
        <button class="nav-btn" onclick={() => pane.nextChapter()} aria-label="Next chapter" title="Next chapter">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M9 18l6-6-6-6" />
            </svg>
        </button>
        <SelectTrigger
            expanded={pane.bookSelectorOpen}
            onclick={() => pane.bookSelectorOpen = !pane.bookSelectorOpen}
            title="Go to a passage"
        >
            <span class="book-name">{bookDisplayName(pane.book)}</span>
            <span class="chapter-badge">{pane.chapter}</span>
        </SelectTrigger>
    </div>

    <div class="pane-nav-section pane-nav-center" bind:clientWidth={centerWidth}>
        {#if stripMode === 'pills'}
            <ChapterPills {pane} />
        {/if}
    </div>

    <div class="pane-nav-section pane-nav-right">
        <button
            class="nav-btn rail-toggle-btn"
            onclick={() => pane.rail.toggle()}
            aria-label="Study rail"
            title="Study rail: who's here, lookups, lineage"
            aria-pressed={pane.rail.open}
        >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M15 3v18" />
            </svg>
        </button>
        <TranslationSelect value={pane.translation} {translations} onchange={(id) => requestPaneTranslation(pane, id)} />
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

<PassagePicker {pane} {translations} inPane />

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
        min-width: 0;
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
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-sm);
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: all var(--transition-fast);
        flex-shrink: 0;
    }
    .nav-btn:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
    }

    .pane-close-btn:hover {
        color: var(--color-error, #ef4444);
        border-color: var(--color-error, #ef4444);
    }

    @media (max-width: 768px) {
        .pane-header {
            height: 48px;
            padding: 0 var(--space-2);
            gap: var(--space-1);
        }
        .pane-nav-center { display: none; }
        .pane-nav-left {
            flex: 1 1 auto;
            min-width: 0;
        }
        .pane-nav-left :global(.select-trigger) {
            flex: 1 1 auto;
            min-width: 0;
            height: 44px;
        }
        .nav-btn {
            width: 44px;
            height: 44px;
        }
        .book-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
    }
</style>
