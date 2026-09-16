<script lang="ts">
    import { BOOKS, findBook } from '@codex-scriptura/core';
    import type { Translation } from '@codex-scriptura/core';
    import type { PaneState } from '$lib/stores/splitPanes.svelte';
    import { enterTarget, filterBooks, stepHighlight } from '$lib/utils/passagePicker';

    /**
     * The combined book-and-chapter picker (issue #246): one trigger in the
     * passage bar opens this, whether or not the chapter pills fit. Type a
     * book to filter, or a reference ("Ps 23", "John 3:16") and press Enter;
     * arrows move the highlighted book and the chapter grid follows it.
     */
    let {
        pane,
        translations,
        inPane = false,
        readingTimeMinutes = null,
    }: {
        /** The pane whose book/translation the picker navigates. */
        pane: PaneState;
        translations: Translation[];
        /** Compact positioning inside a pane wrapper (vs the solo header). */
        inPane?: boolean;
        /** Estimated reading time of the current chapter, shown next to the location. */
        readingTimeMinutes?: number | null;
    } = $props();

    let query = $state('');
    let highlighted = $state<string | null>(null);
    let inputEl: HTMLInputElement | undefined = $state();

    const available = $derived(new Set(pane.availableBooks));
    const visible = $derived(filterBooks(query));
    const highlightedBook = $derived(findBook(highlighted ?? pane.book));
    const chapters = $derived.by(() => {
        const id = highlighted ?? pane.book;
        if (id === pane.book && pane.availableChapters.length > 0) return pane.availableChapters;
        const n = findBook(id)?.chapters ?? 0;
        return Array.from({ length: n }, (_, i) => i + 1);
    });

    // Fresh query and highlight every time the picker opens; the highlight
    // follows the filter so the chapter grid always shows a visible book.
    $effect(() => {
        if (!pane.bookSelectorOpen) return;
        query = '';
        highlighted = pane.book;
        requestAnimationFrame(() => inputEl?.focus());
    });
    $effect(() => {
        const list = visible;
        if (!query.trim()) return;
        if (!list.some((b) => b.osisId === highlighted)) highlighted = list[0]?.osisId ?? null;
    });

    function translationName(id: string): string {
        return translations.find((t) => t.id === id)?.name ?? id;
    }
    // Coverage labeling for partial translations (known-issues #30): books
    // the translation doesn't have are greyed out instead of hidden.
    function coverageOf(id: string): string | undefined {
        return translations.find((t) => t.id === id)?.coverage;
    }

    function go(book: string, chapter: number) {
        if (!available.has(book)) return;
        pane.navigateTo(book, chapter);
    }

    function onKey(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            e.preventDefault();
            pane.bookSelectorOpen = false;
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            highlighted = stepHighlight(visible, highlighted, e.key === 'ArrowDown' ? 1 : -1);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const target = enterTarget(query, highlighted, pane.book);
            if (target) go(target.book, target.chapter);
            else pane.bookSelectorOpen = false;
        }
    }
</script>

{#if pane.bookSelectorOpen}
    <div class="picker-overlay" onclick={() => pane.bookSelectorOpen = false} role="presentation"></div>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
        class="passage-picker"
        class:pane-picker={inPane}
        role="dialog"
        aria-label="Go to a passage"
        tabindex="-1"
        onkeydown={(e) => { if (e.key === 'Escape') { e.preventDefault(); pane.bookSelectorOpen = false; } }}
    >
        <div class="picker-head">
            <span class="picker-current">{findBook(pane.book)?.name ?? pane.book} {pane.chapter}</span>
            {#if readingTimeMinutes}
                <span class="reading-time" title="Estimated reading time at your reading speed">~{readingTimeMinutes} min</span>
            {/if}
        </div>
        <input
            class="picker-input"
            type="text"
            placeholder="Book, or a reference like Ps 23 or John 3:16"
            aria-label="Book or reference"
            autocomplete="off"
            spellcheck="false"
            bind:this={inputEl}
            bind:value={query}
            onkeydown={onKey}
        />
        {#if coverageOf(pane.translation)}
            <p class="book-coverage-note">
                {translationName(pane.translation)} is an in-progress translation ({coverageOf(pane.translation)}). Greyed books aren't available in it yet.
            </p>
        {/if}
        <div class="picker-body">
            <div class="picker-books" role="listbox" aria-label="Books">
                {#each ['OT', 'NT', 'AP'] as testament}
                    {@const testamentBooks = visible.filter((b) => b.testament === testament)}
                    {#if testamentBooks.some((b) => available.has(b.osisId))}
                        <div class="book-group">
                            <h3 class="data-label book-group-label">
                                {testament === 'OT' ? 'Old Testament' : testament === 'NT' ? 'New Testament' : 'Apocrypha'}
                            </h3>
                            <div class="book-grid">
                                {#each testamentBooks as bookMeta (bookMeta.osisId)}
                                    {#if available.has(bookMeta.osisId)}
                                        <button
                                            class="book-btn"
                                            role="option"
                                            aria-selected={bookMeta.osisId === highlighted}
                                            class:active={bookMeta.osisId === pane.book}
                                            title={bookMeta.name}
                                            onclick={() => { highlighted = bookMeta.osisId; }}
                                            ondblclick={() => go(bookMeta.osisId, 1)}
                                        >{bookMeta.abbrev}</button>
                                    {:else}
                                        <button
                                            class="book-btn unavailable"
                                            role="option"
                                            aria-selected="false"
                                            disabled
                                            title="{bookMeta.name} is not in {translationName(pane.translation)}"
                                        >{bookMeta.abbrev}</button>
                                    {/if}
                                {/each}
                            </div>
                        </div>
                    {/if}
                {/each}
                {#if visible.length === 0}
                    <p class="picker-none">No book matches "{query}"</p>
                {/if}
            </div>
            <div class="picker-chapters">
                <h3 class="data-label book-group-label">{highlightedBook?.name ?? ''}</h3>
                <div class="chapter-grid">
                    {#each chapters as ch (ch)}
                        <button
                            class="chapter-btn"
                            class:active={(highlighted ?? pane.book) === pane.book && ch === pane.chapter}
                            disabled={!available.has(highlighted ?? pane.book)}
                            onclick={() => go(highlighted ?? pane.book, ch)}
                        >{ch}</button>
                    {/each}
                </div>
            </div>
        </div>
        <p class="picker-hint">Type to filter, <kbd>↑</kbd><kbd>↓</kbd> to move, <kbd>Enter</kbd> to go, <kbd>Esc</kbd> to close</p>
    </div>
{/if}

<style>
    .picker-overlay {
        position: fixed;
        inset: 0;
        z-index: 49;
    }
    /* Floating: positioned by the nearest relative ancestor (.reader-page
       for the solo header, the pane's own .pane-wrapper when inPane). */
    .passage-picker {
        position: absolute;
        top: var(--header-height);
        left: var(--space-6);
        z-index: 50;
        width: 560px;
        max-width: calc(100vw - 2 * var(--space-6));
        max-height: 70vh;
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-floating);
        padding: var(--space-4);
    }
    .passage-picker.pane-picker {
        left: var(--space-3);
        z-index: 51;
    }

    .picker-head {
        display: flex;
        align-items: baseline;
        gap: var(--space-3);
    }
    .picker-current {
        font-size: var(--font-size-md);
        font-weight: 600;
        color: var(--color-text-primary);
    }
    .reading-time {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        font-weight: 500;
        white-space: nowrap;
    }

    .picker-input {
        width: 100%;
        height: var(--row-h-md);
        padding: 0 var(--space-3);
        background: var(--color-bg-control);
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
    }
    .picker-input::placeholder { color: var(--color-text-muted); }

    .picker-body {
        display: flex;
        gap: var(--space-4);
        min-height: 0;
        flex: 1;
    }
    .picker-books {
        flex: 1 1 60%;
        min-width: 0;
        overflow-y: auto;
        padding-right: var(--space-1);
    }
    .picker-chapters {
        flex: 1 1 40%;
        min-width: 0;
        overflow-y: auto;
        border-left: 1px solid var(--color-border-subtle);
        padding-left: var(--space-4);
    }

    .book-group {
        margin-bottom: var(--space-3);
    }
    .book-group-label {
        display: block;
        margin-bottom: var(--space-2);
    }
    .book-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
        gap: 4px;
    }
    .book-btn,
    .chapter-btn {
        height: var(--row-h-sm);
        padding: 0 var(--space-1);
        background: var(--color-bg-surface);
        border: 1px solid transparent;
        border-radius: var(--radius-sm);
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 500;
        cursor: pointer;
        transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
        text-align: center;
    }
    .book-btn:hover,
    .chapter-btn:hover:not(:disabled) {
        color: var(--color-text-primary);
        background: var(--color-bg-control-hover);
        border-color: var(--color-border-control);
    }
    /* Highlighted (keyboard) vs active (where the reader is) */
    .book-btn[aria-selected='true'] {
        border-color: var(--color-accent);
        color: var(--color-text-primary);
    }
    .book-btn.active,
    .chapter-btn.active {
        color: var(--color-accent);
        background: var(--color-accent-subtle);
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
    .chapter-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
        gap: 4px;
    }
    .chapter-btn:disabled {
        opacity: 0.4;
        cursor: default;
    }
    .picker-none {
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
        padding: var(--space-2) 0;
    }

    .book-coverage-note {
        margin: 0;
        padding: var(--space-2) var(--space-3);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
        font-size: var(--font-size-xs);
    }

    .picker-hint {
        font-size: var(--font-size-2xs);
        color: var(--color-text-muted);
    }
    .picker-hint kbd {
        padding: 0 var(--space-1);
        margin: 0 1px;
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-xs);
        font-family: var(--font-ui);
        font-size: var(--font-size-2xs);
    }

    @media (max-width: 768px) {
        .passage-picker {
            left: var(--space-3);
            right: var(--space-3);
            width: auto;
            max-width: none;
        }
        .picker-body { flex-direction: column; }
        .picker-chapters {
            border-left: none;
            padding-left: 0;
            border-top: 1px solid var(--color-border-subtle);
            padding-top: var(--space-3);
        }
        .picker-hint { display: none; }
    }
</style>
