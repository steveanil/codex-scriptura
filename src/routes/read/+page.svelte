<script lang="ts">
    import { onMount } from 'svelte';
    import { getChapter, getTranslations, getBookList, getChapterList, getSettings, saveSettings } from '@codex-scriptura/db';
    import { BOOKS, findBook } from '@codex-scriptura/core';
    import type { VerseRecord, Translation, UserSettings } from '@codex-scriptura/core';

    let translations = $state<Translation[]>([]);
    let activeTranslation = $state('KJV');
    let currentBook = $state('Gen');
    let currentChapter = $state(1);
    let verses = $state<VerseRecord[]>([]);
    let availableBooks = $state<string[]>([]);
    let availableChapters = $state<number[]>([]);
    let loading = $state(true);
    let bookSelectorOpen = $state(false);

    async function loadChapter() {
        loading = true;
        verses = await getChapter(activeTranslation, currentBook, currentChapter);
        loading = false;
    }

    async function loadNavigation() {
        availableBooks = await getBookList(activeTranslation);
        availableChapters = await getChapterList(activeTranslation, currentBook);
    }

    async function navigateToBook(bookId: string) {
        currentBook = bookId;
        currentChapter = 1;
        bookSelectorOpen = false;
        await loadNavigation();
        await loadChapter();
        await persistSettings();
    }

    async function navigateToChapter(ch: number) {
        currentChapter = ch;
        await loadChapter();
        await persistSettings();
    }

    async function prevChapter() {
        if (currentChapter > 1) {
            currentChapter--;
        } else {
            // Go to previous book's last chapter
            const idx = availableBooks.indexOf(currentBook);
            if (idx > 0) {
                currentBook = availableBooks[idx - 1];
                await loadNavigation();
                currentChapter = availableChapters[availableChapters.length - 1] ?? 1;
            }
        }
        await loadChapter();
        await persistSettings();
    }

    async function nextChapter() {
        const maxCh = availableChapters[availableChapters.length - 1] ?? 1;
        if (currentChapter < maxCh) {
            currentChapter++;
        } else {
            // Go to next book's first chapter
            const idx = availableBooks.indexOf(currentBook);
            if (idx < availableBooks.length - 1) {
                currentBook = availableBooks[idx + 1];
                await loadNavigation();
                currentChapter = 1;
            }
        }
        await loadChapter();
        await persistSettings();
    }

    async function switchTranslation(id: string) {
        activeTranslation = id;
        await loadNavigation();
        await loadChapter();
        await persistSettings();
    }

    async function persistSettings() {
        const settings: UserSettings = {
            id: 'default',
            activeTranslation,
            theme: 'system',
            fontSize: 16,
            readerLayout: 'single',
        };
        await saveSettings(settings);
    }

    function getBookDisplayName(bookId: string): string {
        return findBook(bookId)?.name ?? bookId;
    }

    onMount(async () => {
        translations = await getTranslations();

        const settings = await getSettings();
        activeTranslation = settings.activeTranslation;

        await loadNavigation();
        await loadChapter();
    });
</script>

<svelte:head>
    <title>{getBookDisplayName(currentBook)} {currentChapter} — Codex Scriptura</title>
</svelte:head>

<div class="reader-page">
    <!-- Header Bar -->
    <header class="reader-header">
        <div class="reader-nav-left">
            <button class="book-selector-btn" onclick={() => bookSelectorOpen = !bookSelectorOpen} id="book-selector-toggle">
                <span class="book-name">{getBookDisplayName(currentBook)}</span>
                <span class="chapter-badge">{currentChapter}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M6 9l6 6 6-6" />
                </svg>
            </button>
        </div>

        <div class="reader-nav-center">
            <button class="nav-btn" onclick={prevChapter} aria-label="Previous chapter" id="prev-chapter">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M15 18l-6-6 6-6" />
                </svg>
            </button>
            <div class="chapter-pills">
                {#each availableChapters as ch}
                    <button
                        class="chapter-pill"
                        class:active={ch === currentChapter}
                        onclick={() => navigateToChapter(ch)}
                    >{ch}</button>
                {/each}
            </div>
            <button class="nav-btn" onclick={nextChapter} aria-label="Next chapter" id="next-chapter">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 18l6-6-6-6" />
                </svg>
            </button>
        </div>

        <div class="reader-nav-right">
            {#if translations.length > 1}
                <select
                    class="translation-picker"
                    bind:value={activeTranslation}
                    onchange={(e) => switchTranslation((e.target as HTMLSelectElement).value)}
                    id="translation-picker"
                >
                    {#each translations as t}
                        <option value={t.id}>{t.abbreviation}</option>
                    {/each}
                </select>
            {:else}
                <span class="translation-badge">{activeTranslation}</span>
            {/if}
        </div>
    </header>

    <!-- Book Selector Dropdown -->
    {#if bookSelectorOpen}
        <div class="book-selector-overlay" onclick={() => bookSelectorOpen = false} role="presentation"></div>
        <div class="book-selector-dropdown">
            {#each ['OT', 'NT', 'AP'] as testament}
                {@const testamentBooks = availableBooks.filter(b => {
                    const meta = findBook(b);
                    return meta?.testament === testament;
                })}
                {#if testamentBooks.length > 0}
                    <div class="book-group">
                        <h3 class="book-group-label">
                            {testament === 'OT' ? 'Old Testament' : testament === 'NT' ? 'New Testament' : 'Apocrypha'}
                        </h3>
                        <div class="book-grid">
                            {#each testamentBooks as bookId}
                                <button
                                    class="book-btn"
                                    class:active={bookId === currentBook}
                                    onclick={() => navigateToBook(bookId)}
                                >{findBook(bookId)?.abbrev ?? bookId}</button>
                            {/each}
                        </div>
                    </div>
                {/if}
            {/each}
        </div>
    {/if}

    <!-- Verse Content -->
    <div class="reader-content">
        {#if loading}
            <div class="reader-loading">
                <div class="loading-shimmer"></div>
                <div class="loading-shimmer short"></div>
                <div class="loading-shimmer"></div>
            </div>
        {:else if verses.length === 0}
            <div class="reader-empty">
                <p>No verses found for {getBookDisplayName(currentBook)} {currentChapter}</p>
            </div>
        {:else}
            <article class="scripture-text">
                <h1 class="chapter-heading">{getBookDisplayName(currentBook)} {currentChapter}</h1>
                <div class="verse-flow">
                    {#each verses as verse}
                        <span class="verse" id="verse-{verse.verse}">
                            <sup class="verse-num">{verse.verse}</sup>
                            <span class="verse-text">{verse.text}</span>
                        </span>
                        {' '}
                    {/each}
                </div>
            </article>
        {/if}
    </div>
</div>

<style>
    /* ─── Reader Page ───────────────────────────────── */
    .reader-page {
        display: flex;
        flex-direction: column;
        height: 100vh;
        position: relative;
    }

    /* ─── Header Bar ────────────────────────────────── */
    .reader-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-3) var(--space-6);
        background: var(--color-bg-elevated);
        border-bottom: 1px solid var(--color-border);
        height: var(--header-height);
        flex-shrink: 0;
        gap: var(--space-4);
    }

    .reader-nav-left, .reader-nav-right {
        flex-shrink: 0;
    }

    .book-selector-btn {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 600;
        cursor: pointer;
        transition: all var(--transition-fast);
    }
    .book-selector-btn:hover {
        background: var(--color-bg-hover);
        border-color: var(--color-accent);
    }

    .chapter-badge {
        background: var(--color-accent-subtle);
        color: var(--color-accent);
        padding: 0 var(--space-2);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-xs);
        font-weight: 700;
    }

    /* ─── Chapter Navigation ────────────────────────── */
    .reader-nav-center {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex: 1;
        justify-content: center;
        overflow: hidden;
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
        gap: 2px;
        overflow-x: auto;
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

    /* ─── Translation Picker ────────────────────────── */
    .translation-picker {
        padding: var(--space-1) var(--space-2);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 600;
        cursor: pointer;
    }
    .translation-badge {
        padding: var(--space-1) var(--space-3);
        background: var(--color-accent-subtle);
        color: var(--color-accent);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-xs);
        font-weight: 700;
    }

    /* ─── Book Selector ─────────────────────────────── */
    .book-selector-overlay {
        position: fixed;
        inset: 0;
        z-index: 49;
    }
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

    /* ─── Scripture Content ─────────────────────────── */
    .reader-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--space-8) var(--space-6);
        display: flex;
        justify-content: center;
    }

    .scripture-text {
        max-width: var(--content-max-width);
        width: 100%;
    }

    .chapter-heading {
        font-family: var(--font-scripture);
        font-size: var(--font-size-3xl);
        font-weight: 600;
        color: var(--color-text-primary);
        margin-bottom: var(--space-8);
        letter-spacing: -0.01em;
    }

    .verse-flow {
        font-family: var(--font-scripture);
        font-size: var(--font-size-lg);
        line-height: 2;
        color: var(--color-text-primary);
    }

    .verse {
        transition: background var(--transition-fast);
        border-radius: 2px;
        padding: 1px 0;
    }
    .verse:hover {
        background: var(--color-accent-subtle);
    }

    .verse-num {
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 700;
        color: var(--color-verse-number);
        margin-right: 2px;
        vertical-align: super;
        line-height: 1;
        user-select: none;
    }

    .verse-text {
        cursor: default;
    }

    /* ─── Loading State ─────────────────────────────── */
    .reader-loading {
        max-width: var(--content-max-width);
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        padding-top: var(--space-8);
    }
    .loading-shimmer {
        height: 18px;
        background: linear-gradient(90deg, var(--color-bg-surface) 25%, var(--color-bg-hover) 50%, var(--color-bg-surface) 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
        border-radius: var(--radius-sm);
        width: 100%;
    }
    .loading-shimmer.short { width: 60%; }
    @keyframes shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
    }

    .reader-empty {
        max-width: var(--content-max-width);
        width: 100%;
        text-align: center;
        padding-top: var(--space-12);
        color: var(--color-text-muted);
    }

    /* ─── Mobile ────────────────────────────────────── */
    @media (max-width: 768px) {
        .reader-header {
            padding: var(--space-2) var(--space-3);
        }
        .chapter-pills { display: none; }
        .reader-content {
            padding: var(--space-4) var(--space-4);
        }
        .book-selector-dropdown {
            left: var(--space-3);
            right: var(--space-3);
            width: auto;
        }
    }
</style>
