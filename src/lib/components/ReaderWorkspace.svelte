<script lang="ts">
    import { onMount } from 'svelte';
    import { afterNavigate } from '$app/navigation';
    import AnnotationSidebar from '$lib/components/AnnotationSidebar.svelte';
    import ReaderPane from '$lib/components/ReaderPane.svelte';
    import VersePreviewCard from '$lib/components/VersePreviewCard.svelte';
    import { getTranslations, getAnnotationsForBook, saveAnnotation, deleteAnnotation } from '@codex-scriptura/db';
    import { findBook, BOOKS } from '@codex-scriptura/core';
    import type { Translation, Annotation } from '@codex-scriptura/core';
    import { preferences } from '$lib/stores/preferences.svelte';
    import { ui } from '$lib/stores/ui.svelte';
    import { navHistory, type NavEntry } from '$lib/stores/navHistory.svelte';
    import { PaneState, type PaneLocation, persistSplitPanes, restoreExtraPaneLocations } from '$lib/stores/splitPanes.svelte';
    import { getContiguousGroups } from '$lib/utils/verse-groups';

    // ─── Pane state ───────────────────────────────────────────
    // Every pane, including the primary, is a PaneState (known-issues
    // #14 - the primary pane used to duplicate all of PaneState's
    // navigation logic with workspace-local $state, and the copies had
    // diverged). Workspace-only concerns - nav history, preferences, the
    // URL, split-layout persistence - hang off the navigation hooks.
    const pane0 = new PaneState();
    pane0.onBeforeNavigate = () => visitCurrent();
    pane0.onAfterNavigate = () => {
        visitCurrent();
        persistSettings();
    };

    let translations = $state<Translation[]>([]);

    // Pane component reference for imperative calls (e.g. flashVerse)
    let paneRef: ReturnType<typeof ReaderPane> | undefined = $state();

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
        if (pane0.verses.length === 0) return 0;
        const totalWords = pane0.verses.reduce((sum, v) => sum + v.text.split(/\s+/).length, 0);
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

    // ─── Navigation history helpers ─────────────────────────────
    function getReaderScrollTop(): number {
        const el = document.querySelector('.reader-content');
        return el ? el.scrollTop : 0;
    }

    /** Record current location in the breadcrumb trail. */
    function visitCurrent() {
        navHistory.visit({
            book: pane0.book,
            chapter: pane0.chapter,
            scrollTop: getReaderScrollTop(),
        });
    }

    async function goBack() {
        const entry = navHistory.goBack();
        if (!entry) return;
        await pane0.jumpTo(entry.book, entry.chapter);
        requestAnimationFrame(() => {
            const scrollEl = document.querySelector('.reader-content');
            if (scrollEl) scrollEl.scrollTop = entry.scrollTop;
            if (entry.verseId) paneRef?.flashVerse(entry.verseId);
        });
    }

    async function jumpToHistoryEntry(entry: NavEntry) {
        if (entry.book === pane0.book && entry.chapter === pane0.chapter) return;
        visitCurrent();
        await pane0.jumpTo(entry.book, entry.chapter);
        // Record the destination as visited so backStack knows where we are
        visitCurrent();
        requestAnimationFrame(() => {
            const scrollEl = document.querySelector('.reader-content');
            if (scrollEl) scrollEl.scrollTop = entry.scrollTop;
            if (entry.verseId) paneRef?.flashVerse(entry.verseId);
        });
    }

    // ─── Persistence ──────────────────────────────────────────
    function persistSettings() {
        preferences.update({
            activeTranslation: pane0.translation,
            lastBook: pane0.book,
            lastChapter: pane0.chapter
        });

        // Update URL to reflect current reading location so user can refresh or share
        const url = new URL(window.location.href);
        if (url.searchParams.get('book') !== pane0.book || url.searchParams.get('chapter') !== pane0.chapter.toString()) {
            url.searchParams.set('book', pane0.book);
            url.searchParams.set('chapter', pane0.chapter.toString());
            history.replaceState(history.state, '', url.toString());
        }

        persistSplitLayout();
    }

    // ─── Split pane helpers ───────────────────────────────────

    function persistSplitLayout() {
        const locations: PaneLocation[] = [
            pane0.toLocation(),
            ...extraPanes.map((p) => p.toLocation()),
        ];
        persistSplitPanes(locations);
    }

    function createExtraPane(loc: Partial<PaneLocation>): PaneState {
        const pane = new PaneState(loc);
        // Persist every navigation. Previously an extra pane's navigation
        // was only saved when an unrelated layout action happened to fire
        // persistSplitLayout - a translation/chapter switch was lost on
        // reload (known-issues #14).
        pane.onAfterNavigate = () => persistSplitLayout();
        return pane;
    }

    async function addPaneAtLocation(book: string, chapter: number) {
        if (extraPanes.length >= 2) return; // max 3 panes total
        const pane = createExtraPane({ book, chapter, translation: pane0.translation });
        extraPanes = [...extraPanes, pane];
        extraPaneRefs = [...extraPaneRefs, undefined];
        await pane.loadNavigation();
        await pane.loadChapter();
        persistSplitLayout();
    }

    async function addPane() {
        await addPaneAtLocation(pane0.book, pane0.chapter);
    }

    function removePane(idx: number) {
        extraPanes = extraPanes.filter((_, i) => i !== idx);
        extraPaneRefs = extraPaneRefs.filter((_, i) => i !== idx);
        persistSplitLayout();
    }

    // ─── Annotation callbacks for panes ───────────────────────
    async function handleSaveAnnotation(pane: PaneState, ann: Annotation) {
        await saveAnnotation(ann);
        pane.allBookAnnotations = await getAnnotationsForBook(pane.book);
    }

    async function handleDeleteAnnotations(pane: PaneState, ids: string[]) {
        for (const id of ids) await deleteAnnotation(id);
        pane.allBookAnnotations = await getAnnotationsForBook(pane.book);
    }

    // ─── Annotation sidebar callbacks ─────────────────────────

    async function saveNote(text: string, tags: string[]) {
        if (pane0.selectedVerses.length === 0) return;

        // Create one note per contiguous group to avoid
        // spanning unselected intermediate verses.
        const groups = getContiguousGroups(pane0.selectedVerses);
        for (const group of groups) {
            const startV = group[0];
            const endV = group[group.length - 1];
            const ann: Annotation = {
                id: crypto.randomUUID(),
                type: 'note',
                book: pane0.book,
                verseStart: `${pane0.book}.${pane0.chapter}.${startV}`,
                verseEnd: `${pane0.book}.${pane0.chapter}.${endV}`,
                data: text,
                tags: [...tags],
                created: Date.now(),
                modified: Date.now(),
                synced: false
            };
            await saveAnnotation(ann);
        }
        pane0.allBookAnnotations = await getAnnotationsForBook(pane0.book);
        pane0.selectedVerses = [];
    }

    async function handleDeleteAnnotation(id: string) {
        await deleteAnnotation(id);
        pane0.allBookAnnotations = await getAnnotationsForBook(pane0.book);
    }

    async function navigateToAnnotation(book: string, chapter: number, verse: number) {
        visitCurrent();
        await pane0.jumpTo(book, chapter);
        visitCurrent();
        persistSettings();
        ui.annotationSidebarOpen = false;
        requestAnimationFrame(() => {
            paneRef?.flashVerse(verse);
        });
    }

    /** Navigate the primary pane to a book/chapter/verse (used by cross-reference clicks). */
    async function navigateToVerse(book: string, chapter: number, verse: number) {
        visitCurrent();
        await pane0.jumpTo(book, chapter);
        visitCurrent();
        persistSettings();
        requestAnimationFrame(() => {
            paneRef?.flashVerse(verse);
        });
    }

    // ─── Header helpers ───────────────────────────────────────
    function getBookDisplayName(bookId: string): string {
        return findBook(bookId)?.name ?? bookId;
    }

    const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

    // Coverage labeling for partial translations (known-issues #30):
    // the picker marks them "(partial)" and the book selector greys out
    // books the translation doesn't have instead of hiding them.
    function translationLabel(t: Translation): string {
        return t.coverage ? `${t.abbreviation} (partial)` : t.abbreviation;
    }
    function translationTitle(t: Translation): string {
        return t.coverage ? `${t.name}: ${t.coverage} (in-progress translation)` : t.name;
    }
    function translationName(id: string): string {
        return translations.find((t) => t.id === id)?.name ?? id;
    }
    function coverageOf(id: string): string | undefined {
        return translations.find((t) => t.id === id)?.coverage;
    }

    // ─── Route / URL integration ──────────────────────────────
    function applyUrlParams(url: URL) {
        const bookParam = url.searchParams.get('book');
        const chapterParam = url.searchParams.get('chapter');
        if (bookParam) pane0.book = bookParam;
        if (chapterParam) pane0.chapter = parseInt(chapterParam, 10) || 1;
        return { bookParam, chapterParam, hash: url.hash };
    }

    afterNavigate(async ({ to }) => {
        if (!to) return;
        const { bookParam, chapterParam, hash } = applyUrlParams(to.url);
        if (bookParam || chapterParam) {
            await pane0.loadNavigation();
            await pane0.loadChapter();
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
            pane0.translation = preferences.value?.activeTranslation ?? 'KJV';

            const { bookParam, chapterParam, hash: urlHash } = applyUrlParams(new URL(window.location.href));

            // If URL lacks params, fall back to last viewed location from preferences
            if (!bookParam && !chapterParam) {
                pane0.book = preferences.value?.lastBook ?? 'Gen';
                pane0.chapter = preferences.value?.lastChapter ?? 1;

                const url = new URL(window.location.href);
                url.searchParams.set('book', pane0.book);
                url.searchParams.set('chapter', pane0.chapter.toString());
                history.replaceState(history.state, '', url.toString());
            }

            await pane0.loadNavigation();
            await pane0.loadChapter();
            await navHistory.load();

            // Restore extra panes from previous session
            const extraLocs = await restoreExtraPaneLocations();
            const restoredPanes = extraLocs.map((loc) => createExtraPane(loc));
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
    <title>{getBookDisplayName(pane0.book)} {pane0.chapter} - Codex Scriptura</title>
</svelte:head>

<div class="reader-page">
    <!-- Header Bar -->
    <header class="reader-header">
        <div class="reader-nav-left">
            <button class="book-selector-btn" onclick={() => pane0.bookSelectorOpen = !pane0.bookSelectorOpen} id="book-selector-toggle">
                <span class="book-name">{getBookDisplayName(pane0.book)}</span>
                <span class="chapter-badge">{pane0.chapter}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M6 9l6 6 6-6" />
                </svg>
            </button>
        </div>

        <div class="reader-nav-center">
            <button class="nav-btn" onclick={() => pane0.prevChapter()} aria-label="Previous chapter" id="prev-chapter">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M15 18l-6-6 6-6" />
                </svg>
            </button>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="chapter-pills" bind:this={pane0.chapterPillsEl} onwheel={(e) => pane0.handleChapterWheel(e)}>
                {#each pane0.availableChapters as ch}
                    <button
                        class="chapter-pill"
                        class:active={ch === pane0.chapter}
                        onclick={() => pane0.navigateToChapter(ch)}
                    >{ch}</button>
                {/each}
            </div>
            <button class="nav-btn" onclick={() => pane0.nextChapter()} aria-label="Next chapter" id="next-chapter">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 18l6-6-6-6" />
                </svg>
            </button>
        </div>

        <div class="reader-nav-right" style="display:flex; gap: 8px; align-items: center;">
            {#if readingTimeMinutes > 0}
                <span class="reading-time">~{readingTimeMinutes} min</span>
            {/if}
            <!-- Visible search entry point: opens the command palette (known-issues #31) -->
            <button class="search-affordance" onclick={() => ui.openCommandPalette()} aria-label="Search ({isMac ? 'Cmd' : 'Ctrl'}+K)" title="Search ({isMac ? 'Cmd' : 'Ctrl'}+K)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                </svg>
                <span class="search-affordance-text">Search…</span>
                <kbd class="search-affordance-kbd">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
            </button>
            {#if pane0.enrichment && (pane0.enrichment.persons.length > 0 || pane0.enrichment.places.length > 0 || pane0.enrichment.events.length > 0)}
            <button
                class="entity-toggle-btn nav-btn"
                onclick={() => pane0.panelMode = pane0.panelMode === 'list' ? 'none' : 'list'}
                aria-label="Toggle Insights Panel"
                aria-pressed={pane0.panelMode === 'list'}
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
                    value={pane0.translation}
                    onchange={(e) => pane0.switchTranslation((e.target as HTMLSelectElement).value)}
                    id="translation-picker"
                    title={translationTitle(translations.find((t) => t.id === pane0.translation) ?? translations[0])}
                >
                    {#each translations as t}
                        <option value={t.id} title={translationTitle(t)}>{translationLabel(t)}</option>
                    {/each}
                </select>
            {:else}
                <span class="translation-badge">{pane0.translation}</span>
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
    {#if pane0.bookSelectorOpen}
        {@const available = new Set(pane0.availableBooks)}
        <div class="book-selector-overlay" onclick={() => pane0.bookSelectorOpen = false} role="presentation"></div>
        <div class="book-selector-dropdown">
            {#if coverageOf(pane0.translation)}
                <p class="book-coverage-note">
                    {translationName(pane0.translation)} is an in-progress translation ({coverageOf(pane0.translation)}). Greyed books aren't available in it yet.
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
                                        class:active={bookMeta.osisId === pane0.book}
                                        onclick={() => pane0.navigateToBook(bookMeta.osisId)}
                                    >{bookMeta.abbrev}</button>
                                {:else}
                                    <button
                                        class="book-btn unavailable"
                                        disabled
                                        title="{bookMeta.name} is not in {translationName(pane0.translation)}"
                                    >{bookMeta.abbrev}</button>
                                {/if}
                            {/each}
                        </div>
                    </div>
                {/if}
            {/each}
        </div>
    {/if}

    <!-- Panes Row -->
    <div class="panes-row">
        <!-- Primary pane (pane 0) -->
        <div class="pane-wrapper">
            <ReaderPane
                bind:this={paneRef}
                verses={pane0.verses}
                loading={pane0.loading}
                bookId={pane0.book}
                bookName={getBookDisplayName(pane0.book)}
                chapter={pane0.chapter}
                translationId={pane0.translation}
                enrichment={pane0.enrichment}
                allBookAnnotations={pane0.allBookAnnotations}
                {highlightColors}
                {showVerseNumbers}
                {paragraphMode}
                {showRedLetters}
                bind:selectedVerses={pane0.selectedVerses}
                bind:panelMode={pane0.panelMode}
                onSaveAnnotation={(ann) => handleSaveAnnotation(pane0, ann)}
                onDeleteAnnotations={(ids) => handleDeleteAnnotations(pane0, ids)}
                onOpenAnnotationSidebar={() => ui.annotationSidebarOpen = true}
                onNavigateToVerse={navigateToVerse}
                onOpenInSplit={addPaneAtLocation}
            />
        </div>

        <!-- Extra panes (1–2) - each independently navigable -->
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
                                title={translationTitle(translations.find((t) => t.id === pane.translation) ?? translations[0])}
                            >
                                {#each translations as t}
                                    <option value={t.id} title={translationTitle(t)}>{translationLabel(t)}</option>
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
                    {@const paneAvailable = new Set(pane.availableBooks)}
                    <div class="book-selector-overlay" onclick={() => pane.bookSelectorOpen = false} role="presentation"></div>
                    <div class="book-selector-dropdown pane-book-dropdown">
                        {#if coverageOf(pane.translation)}
                            <p class="book-coverage-note">
                                {translationName(pane.translation)} is an in-progress translation ({coverageOf(pane.translation)}). Greyed books aren't available in it yet.
                            </p>
                        {/if}
                        {#each ['OT', 'NT', 'AP'] as testament}
                            {@const testamentBooks = BOOKS.filter((b) => b.testament === testament)}
                            {#if testamentBooks.some((b) => paneAvailable.has(b.osisId))}
                                <div class="book-group">
                                    <h3 class="book-group-label">
                                        {testament === 'OT' ? 'Old Testament' : testament === 'NT' ? 'New Testament' : 'Apocrypha'}
                                    </h3>
                                    <div class="book-grid">
                                        {#each testamentBooks as bookMeta}
                                            {#if paneAvailable.has(bookMeta.osisId)}
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
                    onSaveAnnotation={(ann) => handleSaveAnnotation(pane, ann)}
                    onDeleteAnnotations={(ids) => handleDeleteAnnotations(pane, ids)}
                    onOpenAnnotationSidebar={() => ui.annotationSidebarOpen = true}
                    onOpenInSplit={addPaneAtLocation}
                    onNavigateToVerse={async (book, ch, v) => {
                        // Navigate the extra pane to the target verse
                        await pane.jumpTo(book, ch);
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
                    {#if entry.book === pane0.book && entry.chapter === pane0.chapter}
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
        book={pane0.book}
        chapter={pane0.chapter}
        selectedVerses={pane0.selectedVerses}
        bookAnnotations={pane0.allBookAnnotations}
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

    /* ─── Search affordance ─────────────────────────── */
    .search-affordance {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-1) var(--space-2);
        background: var(--color-bg-control);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        cursor: pointer;
        transition: border-color var(--transition-fast), color var(--transition-fast);
    }
    .search-affordance:hover {
        color: var(--color-text-primary);
        border-color: var(--color-accent);
    }
    .search-affordance-kbd {
        padding: 0 var(--space-1);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: 3px;
        font-family: var(--font-ui);
        font-size: 0.65rem;
        line-height: 1.4;
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

    /* ─── Navigation Breadcrumb Strip ────────────────── */
    .nav-breadcrumb-strip {
        display: flex;
        align-items: center;
        flex-shrink: 0;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-4);
        background: var(--color-bg-elevated);
        border-top: 1px solid var(--color-border);
        font-size: var(--font-size-xs);
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
        /* The shell swaps the sidebar for a fixed bottom tab bar and caps
           .main-content below it; fill that, not the viewport. */
        .reader-page {
            height: calc(100dvh - var(--mobile-nav-height));
        }
        .reader-header {
            padding: var(--space-2) var(--space-3);
            gap: var(--space-2);
        }
        .chapter-pills { display: none; }
        /* With the pills gone, prev/next are the only chapter navigation;
           don't let the flexed center section crush them to nothing. */
        .reader-nav-center { min-width: max-content; }
        .book-name {
            max-width: 11ch;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        /* Icon-only search button: the palette's only touch entry point */
        .search-affordance-text,
        .search-affordance-kbd { display: none; }
        .reading-time { display: none; }
        .book-selector-dropdown {
            left: var(--space-3);
            right: var(--space-3);
            width: auto;
        }
        /* Panes must not force the row wider than the phone; stack any
           split panes instead of squeezing them side by side. */
        .panes-row { flex-direction: column; }
        .pane-wrapper { min-width: 0; }
        .pane-wrapper + .pane-wrapper {
            border-left: none;
            border-top: 1px solid var(--color-border);
        }
        .split-btn { display: none; }
    }
</style>
