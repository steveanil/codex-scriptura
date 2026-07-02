<script lang="ts">
    import { onMount } from 'svelte';
    import { afterNavigate } from '$app/navigation';
    import AnnotationSidebar from '$lib/components/AnnotationSidebar.svelte';
    import ReaderPane from '$lib/components/ReaderPane.svelte';
    import VersePreviewCard from '$lib/components/VersePreviewCard.svelte';
    import { getChapter, getTranslations, getBookList, getChapterList, getAnnotationsForBook, saveAnnotation, deleteAnnotation, getEntitiesForChapter } from '@codex-scriptura/db';
    import { findBook } from '@codex-scriptura/core';
    import type { VerseRecord, Translation, Annotation, Person, Place, BibleEvent } from '@codex-scriptura/core';
    import { preferences } from '$lib/stores/preferences.svelte';
    import { ui } from '$lib/stores/ui.svelte';
    import { navHistory, type NavEntry } from '$lib/stores/navHistory.svelte';
    import { PaneState, type PaneLocation, persistSplitPanes, restoreExtraPaneLocations } from '$lib/stores/splitPanes.svelte';
    import { getContiguousGroups } from '$lib/utils/verse-groups';

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

    // ─── Split pane state ─────────────────────────────────────
    // pane 0 is managed by the existing workspace state above.
    // extraPanes holds the state for panes 1 and 2.
    let extraPanes = $state<PaneState[]>([]);
    let extraPaneRefs = $state<(ReturnType<typeof ReaderPane> | undefined)[]>([]);

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
    let showRedLetters = $derived(preferences.value?.reader.showRedLetters ?? true);

    let readingTimeMinutes = $derived.by(() => {
        if (verses.length === 0) return 0;
        const totalWords = verses.reduce((sum, v) => sum + v.text.split(/\s+/).length, 0);
        const wpm = preferences.value?.readingSpeed ?? 200;
        return Math.max(1, Math.round(totalWords / wpm));
    });

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

    // ─── Navigation history helpers ─────────────────────────────
    function getReaderScrollTop(): number {
        const el = document.querySelector('.reader-content');
        return el ? el.scrollTop : 0;
    }

    /** Record current location in the breadcrumb trail. */
    function visitCurrent() {
        navHistory.visit({
            book: currentBook,
            chapter: currentChapter,
            scrollTop: getReaderScrollTop(),
        });
    }

    async function goBack() {
        const entry = navHistory.goBack();
        if (!entry) return;
        if (entry.book !== currentBook) {
            currentBook = entry.book;
            await loadNavigation();
        }
        currentChapter = entry.chapter;
        await loadChapter();
        requestAnimationFrame(() => {
            const scrollEl = document.querySelector('.reader-content');
            if (scrollEl) scrollEl.scrollTop = entry.scrollTop;
            if (entry.verseId) paneRef?.flashVerse(entry.verseId);
        });
    }

    async function jumpToHistoryEntry(entry: NavEntry) {
        if (entry.book === currentBook && entry.chapter === currentChapter) return;
        visitCurrent();
        if (entry.book !== currentBook) {
            currentBook = entry.book;
            await loadNavigation();
        }
        currentChapter = entry.chapter;
        await loadChapter();
        // Record the destination as visited so backStack knows where we are
        visitCurrent();
        requestAnimationFrame(() => {
            const scrollEl = document.querySelector('.reader-content');
            if (scrollEl) scrollEl.scrollTop = entry.scrollTop;
            if (entry.verseId) paneRef?.flashVerse(entry.verseId);
        });
    }

    // ─── Navigation actions ───────────────────────────────────
    async function navigateToBook(bookId: string) {
        if (bookId === currentBook) return;
        visitCurrent();
        currentBook = bookId;
        bookSelectorOpen = false;
        await loadNavigation();
        currentChapter = availableChapters[0] ?? 1;
        await loadChapter();
        visitCurrent();
        await persistSettings();
    }

    async function navigateToChapter(ch: number) {
        if (ch === currentChapter) return;
        visitCurrent();
        currentChapter = ch;
        await loadChapter();
        visitCurrent();
        await persistSettings();
    }

    async function prevChapter() {
        const curIdx = availableChapters.indexOf(currentChapter);
        if (curIdx > 0) {
            visitCurrent();
            currentChapter = availableChapters[curIdx - 1];
        } else {
            const bookIdx = availableBooks.indexOf(currentBook);
            if (bookIdx > 0) {
                visitCurrent();
                currentBook = availableBooks[bookIdx - 1];
                await loadNavigation();
                currentChapter = availableChapters[availableChapters.length - 1] ?? 1;
            } else {
                return;
            }
        }
        await loadChapter();
        visitCurrent();
        await persistSettings();
    }

    async function nextChapter() {
        const curIdx = availableChapters.indexOf(currentChapter);
        if (curIdx < availableChapters.length - 1) {
            visitCurrent();
            currentChapter = availableChapters[curIdx + 1];
        } else {
            const bookIdx = availableBooks.indexOf(currentBook);
            if (bookIdx < availableBooks.length - 1) {
                visitCurrent();
                currentBook = availableBooks[bookIdx + 1];
                await loadNavigation();
                currentChapter = availableChapters[0] ?? 1;
            } else {
                return;
            }
        }
        await loadChapter();
        visitCurrent();
        await persistSettings();
    }

    async function switchTranslation(id: string) {
        activeTranslation = id;
        await loadNavigation();
        await loadChapter();
        await persistSettings();
    }

    function persistSettings() {
        preferences.update({
            activeTranslation,
            lastBook: currentBook,
            lastChapter: currentChapter
        });

        // Update URL to reflect current reading location so user can refresh or share
        const url = new URL(window.location.href);
        if (url.searchParams.get('book') !== currentBook || url.searchParams.get('chapter') !== currentChapter.toString()) {
            url.searchParams.set('book', currentBook);
            url.searchParams.set('chapter', currentChapter.toString());
            history.replaceState(history.state, '', url.toString());
        }

        persistSplitLayout();
    }

    // ─── Split pane helpers ───────────────────────────────────

    function persistSplitLayout() {
        const locations: PaneLocation[] = [
            { book: currentBook, chapter: currentChapter, translation: activeTranslation },
            ...extraPanes.map((p) => p.toLocation()),
        ];
        persistSplitPanes(locations);
    }

    async function addPane() {
        if (extraPanes.length >= 2) return; // max 3 panes total
        const pane = new PaneState({ book: currentBook, chapter: currentChapter, translation: activeTranslation });
        extraPanes = [...extraPanes, pane];
        extraPaneRefs = [...extraPaneRefs, undefined];
        await pane.loadNavigation();
        await pane.loadChapter();
        persistSplitLayout();
    }

    async function addPaneAtLocation(book: string, chapter: number) {
        if (extraPanes.length >= 2) return;
        const pane = new PaneState({ book, chapter, translation: activeTranslation });
        extraPanes = [...extraPanes, pane];
        extraPaneRefs = [...extraPaneRefs, undefined];
        await pane.loadNavigation();
        await pane.loadChapter();
        persistSplitLayout();
    }

    function removePane(idx: number) {
        extraPanes = extraPanes.filter((_, i) => i !== idx);
        extraPaneRefs = extraPaneRefs.filter((_, i) => i !== idx);
        persistSplitLayout();
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

        // Create one note per contiguous group to avoid
        // spanning unselected intermediate verses.
        const groups = getContiguousGroups(selectedVerses);
        for (const group of groups) {
            const startV = group[0];
            const endV = group[group.length - 1];
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
        }
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

    /** Navigate the primary pane to a book/chapter/verse (used by cross-reference clicks). */
    async function navigateToVerse(book: string, chapter: number, verse: number) {
        visitCurrent();
        if (book !== currentBook) {
            currentBook = book;
            await loadNavigation();
        }
        currentChapter = chapter;
        await loadChapter();
        visitCurrent();
        await persistSettings();
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

    onMount(() => {
        function handleKeydown(e: KeyboardEvent) {
            if (e.altKey && e.key === 'ArrowLeft') {
                e.preventDefault();
                goBack();
            }
        }
        window.addEventListener('keydown', handleKeydown);

        // Async initialization (cannot return cleanup from async function in onMount)
        (async () => {
            translations = await getTranslations();
            activeTranslation = preferences.value?.activeTranslation ?? 'KJV';

            const { bookParam, chapterParam, hash: urlHash } = applyUrlParams(new URL(window.location.href));
            
            // If URL lacks params, fall back to last viewed location from preferences
            if (!bookParam && !chapterParam) {
                currentBook = preferences.value?.lastBook ?? 'Gen';
                currentChapter = preferences.value?.lastChapter ?? 1;
                
                const url = new URL(window.location.href);
                url.searchParams.set('book', currentBook);
                url.searchParams.set('chapter', currentChapter.toString());
                history.replaceState(history.state, '', url.toString());
            }

            await loadNavigation();
            await loadChapter();
            await navHistory.load();

            // Restore extra panes from previous session
            const extraLocs = restoreExtraPaneLocations(activeTranslation);
            const restoredPanes = extraLocs.map((loc) => new PaneState(loc));
            extraPanes = restoredPanes;
            extraPaneRefs = restoredPanes.map(() => undefined);
            for (const pane of restoredPanes) {
                await pane.loadNavigation();
                await pane.loadChapter();
            }

            const hash = window.location.hash || urlHash;
            if (hash.startsWith('#verse-')) {
                const verseNum = hash.slice(7);
                requestAnimationFrame(() => {
                    paneRef?.flashVerse(verseNum);
                });
            }
        })();

        return () => {
            window.removeEventListener('keydown', handleKeydown);
        };
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
            {#if readingTimeMinutes > 0}
                <span class="reading-time">~{readingTimeMinutes} min</span>
            {/if}
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

            <!-- Split pane controls -->
            {#if extraPanes.length < 2}
                <button
                    class="nav-btn split-btn"
                    onclick={addPane}
                    aria-label="Open split pane"
                    title="Open split pane"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="3" width="7" height="18" rx="1"/>
                        <rect x="14" y="3" width="7" height="18" rx="1"/>
                    </svg>
                </button>
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

    <!-- Panes Row -->
    <div class="panes-row">
        <!-- Primary pane (pane 0) — uses workspace nav state -->
        <div class="pane-wrapper">
            <ReaderPane
                bind:this={paneRef}
                {verses}
                {loading}
                bookId={currentBook}
                bookName={getBookDisplayName(currentBook)}
                chapter={currentChapter}
                translationId={activeTranslation}
                {enrichment}
                {allBookAnnotations}
                {highlightColors}
                {showVerseNumbers}
                {paragraphMode}
                {showRedLetters}
                bind:selectedVerses
                bind:panelMode
                onSaveAnnotation={handleSaveAnnotation}
                onDeleteAnnotations={handleDeleteAnnotations}
                onOpenAnnotationSidebar={() => ui.annotationSidebarOpen = true}
                onNavigateToVerse={navigateToVerse}
                onOpenInSplit={addPaneAtLocation}
            />
        </div>

        <!-- Extra panes (1–2) — each independently navigable -->
        {#each extraPanes as pane, idx (pane.id)}
            <div class="pane-wrapper pane-extra">
                <!-- Per-pane header -->
                <div class="pane-header">
                    <div class="pane-nav-section pane-nav-left">
                        <button
                            class="book-selector-btn"
                            onclick={() => pane.bookSelectorOpen = !pane.bookSelectorOpen}
                        >
                            <span class="book-name">{getBookDisplayName(pane.book)}</span>
                            <span class="chapter-badge">{pane.chapter}</span>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M6 9l6 6 6-6" />
                            </svg>
                        </button>
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
                        {#if translations.length > 1}
                            <select
                                class="translation-picker"
                                value={pane.translation}
                                onchange={(e) => pane.switchTranslation((e.target as HTMLSelectElement).value)}
                            >
                                {#each translations as t}
                                    <option value={t.id}>{t.abbreviation}</option>
                                {/each}
                            </select>
                        {:else}
                            <span class="translation-badge">{pane.translation}</span>
                        {/if}
                        <button
                            class="nav-btn pane-close-btn"
                            onclick={() => removePane(idx)}
                            aria-label="Close pane"
                            title="Close pane"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- Per-pane book selector dropdown -->
                {#if pane.bookSelectorOpen}
                    <div class="book-selector-overlay" onclick={() => pane.bookSelectorOpen = false} role="presentation"></div>
                    <div class="book-selector-dropdown pane-book-dropdown">
                        {#each ['OT', 'NT', 'AP'] as testament}
                            {@const testamentBooks = pane.availableBooks.filter(b => findBook(b)?.testament === testament)}
                            {#if testamentBooks.length > 0}
                                <div class="book-group">
                                    <h3 class="book-group-label">
                                        {testament === 'OT' ? 'Old Testament' : testament === 'NT' ? 'New Testament' : 'Apocrypha'}
                                    </h3>
                                    <div class="book-grid">
                                        {#each testamentBooks as bookId}
                                            <button
                                                class="book-btn"
                                                class:active={bookId === pane.book}
                                                onclick={() => pane.navigateToBook(bookId)}
                                            >{findBook(bookId)?.abbrev ?? bookId}</button>
                                        {/each}
                                    </div>
                                </div>
                            {/if}
                        {/each}
                    </div>
                {/if}

                <ReaderPane
                    bind:this={extraPaneRefs[idx]}
                    verses={pane.verses}
                    loading={pane.loading}
                    bookId={pane.book}
                    bookName={getBookDisplayName(pane.book)}
                    chapter={pane.chapter}
                    translationId={pane.translation}
                    enrichment={pane.enrichment}
                    allBookAnnotations={pane.allBookAnnotations}
                    {highlightColors}
                    {showVerseNumbers}
                    {paragraphMode}
                    {showRedLetters}
                    bind:selectedVerses={pane.selectedVerses}
                    bind:panelMode={pane.panelMode}
                    onSaveAnnotation={async (ann) => {
                        await saveAnnotation(ann);
                        pane.allBookAnnotations = await getAnnotationsForBook(pane.book);
                    }}
                    onDeleteAnnotations={async (ids) => {
                        for (const id of ids) await deleteAnnotation(id);
                        pane.allBookAnnotations = await getAnnotationsForBook(pane.book);
                    }}
                    onOpenAnnotationSidebar={() => ui.annotationSidebarOpen = true}
                    onOpenInSplit={addPaneAtLocation}
                    onNavigateToVerse={async (book, ch, v) => {
                        // Navigate the extra pane to the target verse
                        if (book !== pane.book) {
                            pane.book = book;
                            await pane.loadNavigation();
                        }
                        pane.chapter = ch;
                        await pane.loadChapter();
                        persistSplitLayout();
                        requestAnimationFrame(() => {
                            extraPaneRefs[idx]?.flashVerse(v);
                        });
                    }}
                />
            </div>
        {/each}
    </div>

    <!-- Navigation History Breadcrumb Strip -->
    {#if navHistory.entries.length > 1}
        <div class="nav-breadcrumb-strip">
            <button class="breadcrumb-back-btn" onclick={goBack} title="Go back (Alt+←)" disabled={!navHistory.canGoBack}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
            </button>
            <div class="breadcrumb-trail">
                {#each navHistory.entries as entry, i}
                    {#if i > 0}<span class="breadcrumb-sep">&rarr;</span>{/if}
                    {#if entry.book === currentBook && entry.chapter === currentChapter}
                        <span class="breadcrumb-current">{getBookDisplayName(entry.book)} {entry.chapter}</span>
                    {:else}
                        <button class="breadcrumb-item" onclick={() => jumpToHistoryEntry(entry)}>
                            {getBookDisplayName(entry.book)} {entry.chapter}
                        </button>
                    {/if}
                {/each}
            </div>
        </div>
    {/if}

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
    
    <!-- Verse Hover Preview Layer -->
    <VersePreviewCard onNavigate={navigateToAnnotation} />
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

    /* ─── Reading Time ─────────────────────────────── */
    .reading-time {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        font-weight: 500;
        white-space: nowrap;
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

    /* ─── Navigation Breadcrumb Strip ────────────────── */
    .nav-breadcrumb-strip {
        position: fixed;
        bottom: 0;
        left: var(--sidebar-width);
        right: 0;
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-4);
        background: var(--color-bg-elevated);
        border-top: 1px solid var(--color-border);
        font-size: var(--font-size-xs);
        z-index: 50;
    }

    .breadcrumb-back-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-secondary);
        cursor: pointer;
        flex-shrink: 0;
        transition: all var(--transition-fast);
    }
    .breadcrumb-back-btn:hover {
        color: var(--color-accent);
        border-color: var(--color-accent);
    }

    .breadcrumb-trail {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        overflow-x: auto;
        scrollbar-width: none;
    }
    .breadcrumb-trail::-webkit-scrollbar { display: none; }

    .breadcrumb-item {
        background: none;
        border: none;
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 500;
        cursor: pointer;
        white-space: nowrap;
        padding: 2px var(--space-1);
        border-radius: var(--radius-sm);
        transition: all var(--transition-fast);
    }
    .breadcrumb-item:hover {
        color: var(--color-accent);
        background: var(--color-accent-subtle);
    }

    .breadcrumb-sep {
        color: var(--color-text-muted);
        opacity: 0.5;
    }

    .breadcrumb-current {
        color: var(--color-text-primary);
        font-weight: 600;
        white-space: nowrap;
    }

    /* ─── Panes Row ─────────────────────────────────── */
    .panes-row {
        display: flex;
        flex: 1;
        overflow: hidden;
        min-height: 0;
    }

    .pane-wrapper {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 320px;
        overflow: hidden;
        position: relative;
    }

    .pane-wrapper + .pane-wrapper {
        border-left: 1px solid var(--color-border);
    }

    /* ─── Per-extra-pane header ─────────────────────── */
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

    .pane-close-btn:hover {
        color: var(--color-error, #ef4444);
        border-color: var(--color-error, #ef4444);
    }

    /* Position extra-pane book dropdown relative to its pane-wrapper */
    .pane-extra {
        position: relative;
    }

    .pane-book-dropdown {
        left: var(--space-3);
        z-index: 51;
    }

    /* ─── Split button ──────────────────────────────── */
    .split-btn {
        color: var(--color-text-secondary);
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
        .nav-breadcrumb-strip {
            left: 0;
        }
    }
</style>
