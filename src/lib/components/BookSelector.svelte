<script lang="ts">
    import { BOOKS } from '@codex-scriptura/core';
    import type { Translation } from '@codex-scriptura/core';
    import type { PaneState } from '$lib/stores/splitPanes.svelte';

    let {
        pane,
        translations,
        inPane = false,
    }: {
        /** The pane whose book/translation the dropdown navigates. */
        pane: PaneState;
        translations: Translation[];
        /** Compact positioning inside a pane wrapper (vs the solo header). */
        inPane?: boolean;
    } = $props();

    let available = $derived(new Set(pane.availableBooks));

    function translationName(id: string): string {
        return translations.find((t) => t.id === id)?.name ?? id;
    }
    // Coverage labeling for partial translations (known-issues #30): books
    // the translation doesn't have are greyed out instead of hidden.
    function coverageOf(id: string): string | undefined {
        return translations.find((t) => t.id === id)?.coverage;
    }
</script>

{#if pane.bookSelectorOpen}
    <div class="book-selector-overlay" onclick={() => pane.bookSelectorOpen = false} role="presentation"></div>
    <div class="book-selector-dropdown" class:pane-book-dropdown={inPane}>
        {#if coverageOf(pane.translation)}
            <p class="book-coverage-note">
                {translationName(pane.translation)} is an in-progress translation ({coverageOf(pane.translation)}). Greyed books aren't available in it yet.
            </p>
        {/if}
        {#each ['OT', 'NT', 'AP'] as testament}
            {@const testamentBooks = BOOKS.filter((b) => b.testament === testament)}
            {#if testamentBooks.some((b) => available.has(b.osisId))}
                <div class="book-group">
                    <h3 class="book-group-label">
                        {testament === 'OT' ? 'Old Testament' : testament === 'NT' ? 'New Testament' : 'Apocrypha'}
                    </h3>
                    <div class="book-grid">
                        {#each testamentBooks as bookMeta}
                            {#if available.has(bookMeta.osisId)}
                                <button
                                    class="book-btn"
                                    class:active={bookMeta.osisId === pane.book}
                                    onclick={() => pane.navigateToBook(bookMeta.osisId)}
                                >{bookMeta.abbrev}</button>
                            {:else}
                                <button
                                    class="book-btn unavailable"
                                    disabled
                                    title="{bookMeta.name} is not in {translationName(pane.translation)}"
                                >{bookMeta.abbrev}</button>
                            {/if}
                        {/each}
                    </div>
                </div>
            {/if}
        {/each}
    </div>
{/if}

<style>
    .book-selector-overlay {
        position: fixed;
        inset: 0;
        z-index: 49;
    }
    /* Positioned by the nearest relative ancestor: .reader-page for the
       solo header, the pane's own .pane-wrapper when inPane. */
    .book-selector-dropdown {
        position: absolute;
        top: var(--header-height);
        left: var(--space-6);
        z-index: 50;
        width: 400px;
        max-height: 70vh;
        overflow-y: auto;
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg);
        padding: var(--space-4);
    }
    .book-selector-dropdown.pane-book-dropdown {
        left: var(--space-3);
        z-index: 51;
    }

    .book-group {
        margin-bottom: var(--space-4);
    }
    .book-group-label {
        font-size: var(--font-size-xs);
        font-weight: 600;
        color: var(--color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin-bottom: var(--space-2);
    }
    .book-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
        gap: 4px;
    }
    .book-btn {
        padding: var(--space-1) var(--space-2);
        background: var(--color-bg-surface);
        border: 1px solid transparent;
        border-radius: var(--radius-sm);
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 500;
        cursor: pointer;
        transition: all var(--transition-fast);
        text-align: center;
    }
    .book-btn:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
        border-color: var(--color-border);
    }
    .book-btn.active {
        color: var(--color-accent);
        background: var(--color-accent-subtle);
        border-color: var(--color-accent);
        font-weight: 700;
    }
    .book-btn.unavailable {
        opacity: 0.32;
        cursor: default;
    }
    .book-btn.unavailable:hover {
        color: var(--color-text-secondary);
        background: var(--color-bg-surface);
        border-color: transparent;
    }

    .book-coverage-note {
        margin: 0 0 var(--space-3);
        padding: var(--space-2) var(--space-3);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
        font-size: var(--font-size-xs);
    }

    @media (max-width: 768px) {
        .book-selector-dropdown {
            left: var(--space-3);
            right: var(--space-3);
            width: auto;
        }
    }
</style>
