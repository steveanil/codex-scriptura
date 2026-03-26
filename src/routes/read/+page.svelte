<script lang="ts">
    import { onMount } from 'svelte';
    import { afterNavigate } from '$app/navigation';
    import AnnotationSidebar from '$lib/components/AnnotationSidebar.svelte';
    import { getChapter, getTranslations, getBookList, getChapterList, getSettings, saveSettings, getAnnotationsForBook, saveAnnotation, deleteAnnotation } from '@codex-scriptura/db';
    import { BOOKS, findBook } from '@codex-scriptura/core';
    import type { VerseRecord, Translation, UserSettings, Annotation } from '@codex-scriptura/core';

    let translations = $state<Translation[]>([]);
    let activeTranslation = $state('KJV');
    let currentBook = $state('Gen');
    let currentChapter = $state(1);
    let verses = $state<VerseRecord[]>([]);
    let availableBooks = $state<string[]>([]);
    let availableChapters = $state<number[]>([]);
    
    // Annotation state
    let allBookAnnotations = $state<Annotation[]>([]);
    let selectedVerses = $state<number[]>([]);

    let loading = $state(true);
    let bookSelectorOpen = $state(false);
    let sidebarOpen = $state(false);
    let chapterPillsEl: HTMLDivElement | undefined = $state();
    let lastSelectedVerse: number | null = $state(null);

    // Highlight colors
    const COLORS = [
        { name: 'Yellow', value: 'rgba(251, 191, 36, 0.3)' },  // #fbbf24
        { name: 'Green', value: 'rgba(52, 211, 153, 0.3)' },   // #34d399
        { name: 'Blue', value: 'rgba(96, 165, 250, 0.3)' },    // #60a5fa
        { name: 'Red', value: 'rgba(248, 113, 113, 0.3)' }     // #f87171
    ];

    function isVerseInAnnotation(ch: number, v: number, ann: Annotation): boolean {
        const partsStart = ann.verseStart.split('.');
        const partsEnd = ann.verseEnd.split('.');
        if (partsStart.length < 3 || partsEnd.length < 3) return false;

        const sCh = Number(partsStart[1]);
        const sV = Number(partsStart[2]);
        const eCh = Number(partsEnd[1]);
        const eV = Number(partsEnd[2]);
        
        if (ch < sCh || ch > eCh) return false;
        if (ch === sCh && v < sV) return false;
        if (ch === eCh && v > eV) return false;
        return true;
    }

    let verseStyles = $derived.by(() => {
        const styles: Record<number, string> = {};
        for (const v of verses) {
            // Find the most recently modified highlight for this verse
            const highlights = allBookAnnotations.filter(a => a.type === 'highlight' && isVerseInAnnotation(currentChapter, v.verse, a));
            if (highlights.length > 0) {
                // Sort descending by modified date and pick the latest 
                highlights.sort((a, b) => b.modified - a.modified);
                const color = highlights[0].color;
                if (color) {
                    styles[v.verse] = `background-color: ${color};`;
                }
            }
        }
        return styles;
    });

    let versesWithNotes = $derived(allBookAnnotations.filter(a => a.type === 'note'));

    function verseHasNote(v: number): boolean {
        return versesWithNotes.some(a => isVerseInAnnotation(currentChapter, v, a));
    }

    function toggleVerseSelection(v: number, event?: MouseEvent) {
        // Shift-click: select range from last selected to current
        if (event?.shiftKey && lastSelectedVerse !== null) {
            const min = Math.min(lastSelectedVerse, v);
            const max = Math.max(lastSelectedVerse, v);
            const range: number[] = [];
            for (let i = min; i <= max; i++) range.push(i);
            // Merge with existing selection
            const merged = new Set([...selectedVerses, ...range]);
            selectedVerses = Array.from(merged).sort((a, b) => a - b);
        } else if (selectedVerses.includes(v)) {
            selectedVerses = selectedVerses.filter(num => num !== v);
        } else {
            selectedVerses = [...selectedVerses, v].sort((a, b) => a - b);
        }
        lastSelectedVerse = v;
    }

    async function applyHighlight(colorValue: string) {
        if (selectedVerses.length === 0) return;

        const startV = selectedVerses[0];
        const endV = selectedVerses[selectedVerses.length - 1];

        const ann: Annotation = {
            id: crypto.randomUUID(),
            type: 'highlight',
            book: currentBook,
            verseStart: `${currentBook}.${currentChapter}.${startV}`,
            verseEnd: `${currentBook}.${currentChapter}.${endV}`,
            data: '',
            color: colorValue,
            tags: [],  // highlights don't have tags
            created: Date.now(),
            modified: Date.now(),
            synced: false
        };

        await saveAnnotation(ann);
        allBookAnnotations = await getAnnotationsForBook(currentBook);
        selectedVerses = []; // Clear selection
    }

    async function saveNote(text: string, tags: string[]) {
        if (selectedVerses.length === 0) return;

        const startV = selectedVerses[0];
        const endV = selectedVerses[selectedVerses.length - 1];

        const ann: Annotation = {
            id: crypto.randomUUID(),
            type: 'note',
            book: currentBook,
            verseStart: `${currentBook}.${currentChapter}.${startV}`,
            verseEnd: `${currentBook}.${currentChapter}.${endV}`,
            data: text,
            tags: [...tags],  // Spread to unwrap Svelte $state Proxy for IndexedDB
            created: Date.now(),
            modified: Date.now(),
            synced: false
        };

        await saveAnnotation(ann);
        allBookAnnotations = await getAnnotationsForBook(currentBook);
        selectedVerses = []; // Clear selection after saving note
    }

    async function handleDeleteAnnotation(id: string) {
        await deleteAnnotation(id);
        allBookAnnotations = await getAnnotationsForBook(currentBook);
    }

    async function removeHighlightsOnSelection() {
        if (selectedVerses.length === 0) return;
        const toDelete = allBookAnnotations.filter(a =>
            a.type === 'highlight' &&
            selectedVerses.some(v => isVerseInAnnotation(currentChapter, v, a))
        );
        for (const ann of toDelete) await deleteAnnotation(ann.id);
        allBookAnnotations = await getAnnotationsForBook(currentBook);
        selectedVerses = [];
    }

    async function navigateToAnnotation(book: string, chapter: number, verse: number) {
        if (book !== currentBook) {
            currentBook = book;
            await loadNavigation();
        }
        currentChapter = chapter;
        await loadChapter();
        await persistSettings();
        sidebarOpen = false;
        requestAnimationFrame(() => {
            document.getElementById(`verse-${verse}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }

    async function loadChapter() {
        loading = true;
        selectedVerses = [];
        lastSelectedVerse = null;
        verses = await getChapter(activeTranslation, currentBook, currentChapter);
        
        // If this chapter is empty, try to find a non-empty one (forward first, then backward)
        if (verses.length === 0 && availableChapters.length > 0) {
            const curIdx = availableChapters.indexOf(currentChapter);
            // Look forward
            for (let i = curIdx + 1; i < availableChapters.length; i++) {
                const tryVs = await getChapter(activeTranslation, currentBook, availableChapters[i]);
                if (tryVs.length > 0) {
                    currentChapter = availableChapters[i];
                    verses = tryVs;
                    break;
                }
            }
            // If still empty, look backward
            if (verses.length === 0) {
                for (let i = curIdx - 1; i >= 0; i--) {
                    const tryVs = await getChapter(activeTranslation, currentBook, availableChapters[i]);
                    if (tryVs.length > 0) {
                        currentChapter = availableChapters[i];
                        verses = tryVs;
                        break;
                    }
                }
            }
        }
        
        allBookAnnotations = await getAnnotationsForBook(currentBook);
        loading = false;
        requestAnimationFrame(() => scrollActiveChapterIntoView());
    }

    function scrollActiveChapterIntoView() {
        if (!chapterPillsEl) return;
        const active = chapterPillsEl.querySelector('.chapter-pill.active') as HTMLElement;
        if (active) {
            active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }

    function handleChapterWheel(e: WheelEvent) {
        if (!chapterPillsEl) return;
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.preventDefault();
            chapterPillsEl.scrollLeft += e.deltaY;
        }
    }

    async function loadNavigation() {
        availableBooks = await getBookList(activeTranslation);
        availableChapters = await getChapterList(activeTranslation, currentBook);
    }

    async function navigateToBook(bookId: string) {
        currentBook = bookId;
        bookSelectorOpen = false;
        await loadNavigation();
        // Start at first non-empty chapter
        currentChapter = availableChapters[0] ?? 1;
        await loadChapter();
        await persistSettings();
    }

    async function navigateToChapter(ch: number) {
        currentChapter = ch;
        await loadChapter();
        await persistSettings();
    }

    async function prevChapter() {
        const curIdx = availableChapters.indexOf(currentChapter);
        if (curIdx > 0) {
            // Try previous chapters in this book
            currentChapter = availableChapters[curIdx - 1];
        } else {
            // Go to previous book's last chapter
            const bookIdx = availableBooks.indexOf(currentBook);
            if (bookIdx > 0) {
                currentBook = availableBooks[bookIdx - 1];
                await loadNavigation();
                currentChapter = availableChapters[availableChapters.length - 1] ?? 1;
            }
        }
        await loadChapter();
        await persistSettings();
    }

    async function nextChapter() {
        const curIdx = availableChapters.indexOf(currentChapter);
        if (curIdx < availableChapters.length - 1) {
            // Try next chapter in this book
            currentChapter = availableChapters[curIdx + 1];
        } else {
            // Go to next book's first chapter
            const bookIdx = availableBooks.indexOf(currentBook);
            if (bookIdx < availableBooks.length - 1) {
                currentBook = availableBooks[bookIdx + 1];
                await loadNavigation();
                currentChapter = availableChapters[0] ?? 1;
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

    function applyUrlParams(url: URL) {
        const bookParam = url.searchParams.get('book');
        const chapterParam = url.searchParams.get('chapter');
        if (bookParam) currentBook = bookParam;
        if (chapterParam) currentChapter = parseInt(chapterParam, 10) || 1;
        return { bookParam, chapterParam, hash: url.hash };
    }

    afterNavigate(async ({ to }) => {
        if (!to) return;
        const { bookParam, chapterParam, hash } = applyUrlParams(to.url);
        if (bookParam || chapterParam) {
            await loadNavigation();
            await loadChapter();
            if (hash.startsWith('#verse-')) {
                const verseNum = hash.slice(7);
                setTimeout(() => {
                    document.getElementById(`verse-${verseNum}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 100);
            }
        }
    });

    onMount(async () => {
        translations = await getTranslations();

        const settings = await getSettings();
        activeTranslation = settings.activeTranslation;

        // Apply URL params from initial load (command palette / search result links)
        applyUrlParams(new URL(window.location.href));

        await loadNavigation();
        await loadChapter();

        // Scroll to verse from hash on initial load
        const hash = window.location.hash;
        if (hash.startsWith('#verse-')) {
            const verseNum = hash.slice(7);
            requestAnimationFrame(() => {
                document.getElementById(`verse-${verseNum}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        }
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
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="chapter-pills" bind:this={chapterPillsEl} onwheel={handleChapterWheel}>
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

        <div class="reader-nav-right" style="display:flex; gap: 8px; align-items: center;">
            <button class="nav-btn" aria-label="View Notes" onclick={() => sidebarOpen = true}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
            </button>
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
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <span 
                            class="verse" 
                            class:selected={selectedVerses.includes(verse.verse)}
                            id="verse-{verse.verse}"
                            style={verseStyles[verse.verse] || ''}
                            onclick={(e) => toggleVerseSelection(verse.verse, e)}
                        >
                            <sup class="verse-num" class:has-note={verseHasNote(verse.verse)}>{verse.verse}</sup>
                            <span class="verse-text">{verse.text}</span>
                        </span>
                        {' '}
                    {/each}
                </div>
            </article>
        {/if}
    </div>

    <!-- Floating Selection Toolbar -->
    {#if selectedVerses.length > 0}
        <div class="selection-toolbar">
            <span class="selection-count">{selectedVerses.length} verses selected</span>
            
            <div class="toolbar-divider"></div>
            
            <div class="color-picker">
                {#each COLORS as color}
                    <button
                        class="color-btn"
                        style="background-color: {color.value}"
                        aria-label="Highlight {color.name}"
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

            <button class="action-btn" onclick={() => sidebarOpen = true}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                Note
            </button>

            <button class="action-btn" onclick={() => navigator.clipboard.writeText(selectedVerses.map(v => verses.find(ver => ver.verse === v)?.text).join(' '))}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                Copy
            </button>

            <button class="action-btn" onclick={() => selectedVerses = []}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                </svg>
                Clear
            </button>
        </div>
    {/if}

    <AnnotationSidebar
        bind:isOpen={sidebarOpen}
        book={currentBook}
        chapter={currentChapter}
        selectedVerses={selectedVerses}
        bookAnnotations={allBookAnnotations}
        onSaveNote={saveNote}
        onDeleteAnnotation={handleDeleteAnnotation}
        onNavigate={navigateToAnnotation}
    />
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
        padding: 1px 2px;
        cursor: pointer;
    }
    .verse:hover {
        background: var(--color-accent-subtle);
    }
    .verse.selected {
        background: rgba(96, 165, 250, 0.15) !important;
        outline: 2px solid rgba(96, 165, 250, 0.4);
        outline-offset: 1px;
        border-radius: 3px;
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
    .verse-num.has-note {
        color: var(--color-accent);
        text-decoration: underline;
        text-decoration-thickness: 2px;
        text-underline-offset: 2px;
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

    /* ─── Selection Toolbar ─────────────────────────── */
    .selection-toolbar {
        position: fixed;
        bottom: var(--space-6);
        left: 50%;
        transform: translateX(-50%);
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-full);
        box-shadow: var(--shadow-xl);
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
        border-color: var(--color-border) !important;
        color: var(--color-text-muted);
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .eraser-btn:hover {
        color: var(--color-danger);
        border-color: var(--color-danger) !important;
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
        .selection-toolbar {
            bottom: var(--space-4);
            width: calc(100% - var(--space-8));
            justify-content: space-between;
            padding: var(--space-3) var(--space-4);
            border-radius: var(--radius-md);
        }
    }
</style>
