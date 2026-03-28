<script lang="ts">
    import { onMount } from 'svelte';
    import { afterNavigate } from '$app/navigation';
    import AnnotationSidebar from '$lib/components/AnnotationSidebar.svelte';
    import ReaderPane from '$lib/components/ReaderPane.svelte';
    import { getChapter, getTranslations, getBookList, getChapterList, getAnnotationsForBook, saveAnnotation, deleteAnnotation, getEntitiesForChapter } from '@codex-scriptura/db';
    import { findBook } from '@codex-scriptura/core';
    import type { VerseRecord, Translation, Annotation, Person, Place, BibleEvent } from '@codex-scriptura/core';
    import { preferences } from '$lib/stores/preferences.svelte';
    import { ui } from '$lib/stores/ui.svelte';

    // ─── Navigation & data state ──────────────────────────────
    let translations = $state<Translation[]>([]);
    let activeTranslation = $state('KJV');
    let currentBook = $state('Gen');
    let currentChapter = $state(1);
    let verses = $state<VerseRecord[]>([]);
    let availableBooks = $state<string[]>([]);
    let availableChapters = $state<number[]>([]);
    let loading = $state(true);
    let bookSelectorOpen = $state(false);
    let chapterPillsEl: HTMLDivElement | undefined = $state();

    // Annotation state (workspace-owned, passed to pane)
    let allBookAnnotations = $state<Annotation[]>([]);

    // Theographic enrichment for the current chapter
    let enrichment = $state<{ persons: Person[]; places: Place[]; events: BibleEvent[] } | null>(null);

    // Pane-bound state (workspace holds reference, two-way bound with ReaderPane)
    let selectedVerses = $state<number[]>([]);
    let panelMode = $state<'none' | 'detail' | 'list'>('none');

    // Pane component reference for imperative calls (e.g. flashVerse)
    let paneRef: ReturnType<typeof ReaderPane> | undefined = $state();

    // ─── Derived values ───────────────────────────────────────
    function hexToRgba(hex: string, alpha: number): string {
        if (!hex || !hex.startsWith('#')) return hex || 'transparent';
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        if (isNaN(r) || isNaN(g) || isNaN(b)) return hex;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    let showVerseNumbers = $derived(preferences.value?.reader.showVerseNumbers ?? true);
    let paragraphMode = $derived(preferences.value?.reader.paragraphMode ?? false);

    let highlightColors = $derived(
        (preferences.value?.highlightPresets ?? []).map(p => ({
            name: p.name,
            id: p.id,
            value: hexToRgba(p.color, 0.4),
        }))
    );

    // ─── Data loading ─────────────────────────────────────────
    async function loadChapter() {
        loading = true;
        selectedVerses = [];
        panelMode = 'none';
        verses = await getChapter(activeTranslation, currentBook, currentChapter);

        // If this chapter is empty, try to find a non-empty one
        if (verses.length === 0 && availableChapters.length > 0) {
            const curIdx = availableChapters.indexOf(currentChapter);
            for (let i = curIdx + 1; i < availableChapters.length; i++) {
                const tryVs = await getChapter(activeTranslation, currentBook, availableChapters[i]);
                if (tryVs.length > 0) {
                    currentChapter = availableChapters[i];
                    verses = tryVs;
                    break;
                }
            }
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

        // Fetch Theographic enrichment for this chapter
        const osisIds = verses.map(v => v.osisId);
        enrichment = await getEntitiesForChapter(osisIds);
    }

    async function loadNavigation() {
        availableBooks = await getBookList(activeTranslation);
        availableChapters = await getChapterList(activeTranslation, currentBook);
    }

    // ─── Navigation actions ───────────────────────────────────
    async function navigateToBook(bookId: string) {
        currentBook = bookId;
        bookSelectorOpen = false;
        await loadNavigation();
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
            currentChapter = availableChapters[curIdx - 1];
        } else {
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
            currentChapter = availableChapters[curIdx + 1];
        } else {
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

    function persistSettings() {
        preferences.update({ activeTranslation });
    }

    // ─── Annotation callbacks for pane ────────────────────────
    async function handleSaveAnnotation(ann: Annotation) {
        await saveAnnotation(ann);
        allBookAnnotations = await getAnnotationsForBook(currentBook);
    }

    async function handleDeleteAnnotations(ids: string[]) {
        for (const id of ids) await deleteAnnotation(id);
        allBookAnnotations = await getAnnotationsForBook(currentBook);
    }

    // ─── Annotation sidebar callbacks ─────────────────────────
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
            tags: [...tags],
            created: Date.now(),
            modified: Date.now(),
            synced: false
        };

        await saveAnnotation(ann);
        allBookAnnotations = await getAnnotationsForBook(currentBook);
        selectedVerses = [];
    }

    async function handleDeleteAnnotation(id: string) {
        await deleteAnnotation(id);
        allBookAnnotations = await getAnnotationsForBook(currentBook);
    }

    async function navigateToAnnotation(book: string, chapter: number, verse: number) {
        if (book !== currentBook) {
            currentBook = book;
            await loadNavigation();
        }
        currentChapter = chapter;
        await loadChapter();
        await persistSettings();
        ui.annotationSidebarOpen = false;
        requestAnimationFrame(() => {
            paneRef?.flashVerse(verse);
        });
    }

    // ─── Header helpers ───────────────────────────────────────
    function getBookDisplayName(bookId: string): string {
        return findBook(bookId)?.name ?? bookId;
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

    // ─── Route / URL integration ──────────────────────────────
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
                    paneRef?.flashVerse(verseNum);
                }, 100);
            }
        }
    });

    onMount(async () => {
        translations = await getTranslations();
        activeTranslation = preferences.value?.activeTranslation ?? 'KJV';
        applyUrlParams(new URL(window.location.href));
        await loadNavigation();
        await loadChapter();

        const hash = window.location.hash;
        if (hash.startsWith('#verse-')) {
            const verseNum = hash.slice(7);
            requestAnimationFrame(() => {
                paneRef?.flashVerse(verseNum);
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
            <button
                class="nav-btn"
                class:active={paragraphMode}
                onclick={() => {
                    if (!preferences.value) return;
                    preferences.update({ reader: { ...preferences.value.reader, paragraphMode: !paragraphMode } });
                }}
                aria-label={paragraphMode ? 'Switch to verse-per-line' : 'Switch to paragraph mode'}
                title={paragraphMode ? 'Verse per line' : 'Paragraph mode'}
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M13 4v16" /><path d="M17 4v16" /><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13" />
                </svg>
            </button>
            {#if enrichment && (enrichment.persons.length > 0 || enrichment.places.length > 0 || enrichment.events.length > 0)}
            <button
                class="entity-toggle-btn nav-btn"
                onclick={() => panelMode = panelMode === 'list' ? 'none' : 'list'}
                aria-label="Toggle Insights Panel"
                aria-pressed={panelMode === 'list'}
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                </svg>
            </button>
            {/if}
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

    <!-- Reader Pane -->
    <ReaderPane
        bind:this={paneRef}
        {verses}
        {loading}
        bookId={currentBook}
        bookName={getBookDisplayName(currentBook)}
        chapter={currentChapter}
        {enrichment}
        {allBookAnnotations}
        {highlightColors}
        {showVerseNumbers}
        {paragraphMode}
        bind:selectedVerses
        bind:panelMode
        onSaveAnnotation={handleSaveAnnotation}
        onDeleteAnnotations={handleDeleteAnnotations}
        onOpenAnnotationSidebar={() => ui.annotationSidebarOpen = true}
    />

    <!-- Annotation Sidebar -->
    <AnnotationSidebar
        bind:isOpen={ui.annotationSidebarOpen}
        book={currentBook}
        chapter={currentChapter}
        {selectedVerses}
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
    .nav-btn.active {
        color: var(--color-accent);
        background: var(--color-accent-subtle);
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

    /* ─── Mobile ────────────────────────────────────── */
    @media (max-width: 768px) {
        .reader-header {
            padding: var(--space-2) var(--space-3);
        }
        .chapter-pills { display: none; }
        .book-selector-dropdown {
            left: var(--space-3);
            right: var(--space-3);
            width: auto;
        }
    }
</style>
