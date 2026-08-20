<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { afterNavigate } from '$app/navigation';
    import AnnotationSidebar from '$lib/components/AnnotationSidebar.svelte';
    import BookSelector from '$lib/components/BookSelector.svelte';
    import DivergenceMap from '$lib/components/DivergenceMap.svelte';
    import DivergencePopover, { type DivergenceClickTarget } from '$lib/components/DivergencePopover.svelte';
    import PaneHeader from '$lib/components/PaneHeader.svelte';
    import ReaderPane from '$lib/components/ReaderPane.svelte';
    import ScratchPad from '$lib/components/ScratchPad.svelte';
    import SplitToolbar from '$lib/components/SplitToolbar.svelte';
    import VersePreviewCard from '$lib/components/VersePreviewCard.svelte';
    import SelectTrigger from '$lib/components/ui/SelectTrigger.svelte';
    import { saveAnnotation, deleteAnnotation } from '@codex-scriptura/db';
    import { translationLibrary, requestPaneTranslation } from '$lib/stores/translationLibrary.svelte';
    import { findBook } from '@codex-scriptura/core';
    import type { Translation, Annotation } from '@codex-scriptura/core';
    import { preferences } from '$lib/stores/preferences.svelte';
    import { ui } from '$lib/stores/ui.svelte';
    import { navHistory, type NavEntry } from '$lib/stores/navHistory.svelte';
    import { PaneState, type PaneLocation, persistSplitPanes, restoreSplitLayout } from '$lib/stores/splitPanes.svelte';
    import { getContiguousGroups } from '$lib/utils/verse-groups';
    import { groupAnchors } from '$lib/utils/scratchPad';
    import { scratchPad } from '$lib/stores/scratchPad.svelte';
    import { normalizeWeights, startDividerDrag } from '$lib/utils/splitLayout';
    import { buildChapterRows, computeChapterDivergence, chapterDivergenceKey, type Divergence } from '$lib/engines/divergence';

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

    // Installed translations only - what panes can actually render.
    // The pickers additionally offer not-yet-downloaded catalog entries
    // (issue #238), which download on selection via requestPaneTranslation.
    let translations = $derived(
        translationLibrary.catalog.filter((t) => translationLibrary.isInstalled(t.id))
    );
    let downloadableTranslations = $derived(
        translationLibrary.catalog.filter((t) => !translationLibrary.isInstalled(t.id))
    );
    // Picker status line: whichever catalog entry is downloading or errored.
    let libraryNote = $derived.by(() => {
        for (const t of translationLibrary.catalog) {
            const s = translationLibrary.state(t.id);
            if (s.downloading) return `Downloading ${t.abbreviation}… ${Math.round((s.progress ?? 0) * 100)}%`;
            if (s.error) return `${t.abbreviation} download failed - check your connection`;
        }
        return null;
    });

    // Pane component reference for imperative calls (e.g. flashVerse)
    let paneRef: ReturnType<typeof ReaderPane> | undefined = $state();

    // extraPanes holds the state for panes 1 and 2.
    let extraPanes = $state<PaneState[]>([]);
    let extraPaneRefs = $state<(ReturnType<typeof ReaderPane> | undefined)[]>([]);

    // Which pane the annotation sidebar is bound to (issue #180): 0 = the
    // primary pane, n = extraPanes[n - 1]. Set by whichever pane's toolbar
    // opened the sidebar, so notes read and save against that pane's
    // book/chapter/selection instead of always pane 0's.
    let annotationPaneIndex = $state(0);
    let annotationPane = $derived(annotationPaneIndex === 0 ? pane0 : extraPanes[annotationPaneIndex - 1] ?? pane0);

    function openAnnotationSidebarFor(paneIdx: number) {
        annotationPaneIndex = paneIdx;
        ui.annotationSidebarOpen = true;
    }

    // ─── Split view state (issue #24) ─────────────────────────
    let showRefs = $state(true);
    let showDivergence = $state(true);
    let mapOpen = $state(false);

    let syncScroll = $state(false);
    // Flex weight per pane (pane 0 first); divider drags trade weight
    // between neighbours.
    let paneWeights = $state<number[]>([1]);
    let dividerDragging = $state(false);
    let panesRowEl: HTMLDivElement | undefined = $state();
    // Per-pane scroll as a 0-1 fraction of scrollable height - plain
    // array, only read for syncing and persistence.
    let paneScrolls: number[] = [0];
    let scrollPersistTimer: ReturnType<typeof setTimeout> | null = null;

    let windowWidth = $state(1280);
    const MIN_PANE_WIDTH = 280;
    /** Room check: another pane may not squeeze any pane under 280px (52px = icon rail). */
    let canAddPane = $derived(extraPanes.length < 2 && (windowWidth - 52) / (extraPanes.length + 2) >= MIN_PANE_WIDTH);

    // The reader claims the sidebar's width while a split is open - the
    // shell collapses to its icon rail and restores on exit.
    $effect(() => {
        ui.splitRail = extraPanes.length > 0;
    });

    function paneCount(): number {
        return 1 + extraPanes.length;
    }

    function paneRefAt(i: number): ReturnType<typeof ReaderPane> | undefined {
        return i === 0 ? paneRef : extraPaneRefs[i - 1];
    }

    /** Flash a verse in the primary pane. */
    function flashLead(verse: number | string) {
        paneRef?.flashVerse(verse as number);
    }

    function leadScrollEl(): Element | null {
        // With a split open several .reader-content elements exist;
        // querySelector returns the first, which is pane 0's in DOM order.
        return document.querySelector('.reader-content');
    }

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
        const el = leadScrollEl();
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
            const scrollEl = leadScrollEl();
            if (scrollEl) scrollEl.scrollTop = entry.scrollTop;
            if (entry.verseId) flashLead(entry.verseId);
        });
    }

    async function jumpToHistoryEntry(entry: NavEntry) {
        if (entry.book === pane0.book && entry.chapter === pane0.chapter) return;
        visitCurrent();
        await pane0.jumpTo(entry.book, entry.chapter);
        // Record the destination as visited so backStack knows where we are
        visitCurrent();
        requestAnimationFrame(() => {
            const scrollEl = leadScrollEl();
            if (scrollEl) scrollEl.scrollTop = entry.scrollTop;
            if (entry.verseId) flashLead(entry.verseId);
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
        persistSplitPanes({
            locations: [pane0.toLocation(), ...extraPanes.map((p) => p.toLocation())],
            // $state proxies must never reach IndexedDB (DataCloneError,
            // known-issues #35) - snapshot/copy the arrays.
            weights: $state.snapshot(paneWeights),
            syncScroll,
            scrolls: [...paneScrolls],
            showRefs,
            showDivergence,
            mapOpen,
        });
    }

    /** Debounced layout persist for scroll positions - IndexedDB must not be hit per scroll frame. */
    function schedulePersistScrolls() {
        if (scrollPersistTimer) clearTimeout(scrollPersistTimer);
        scrollPersistTimer = setTimeout(() => {
            scrollPersistTimer = null;
            persistSplitLayout();
        }, 400);
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

    async function addPaneAtLocation(book: string, chapter: number, translation?: string) {
        if (extraPanes.length >= 2) return; // max 3 panes total
        const pane = createExtraPane({ book, chapter, translation: translation ?? pane0.translation });
        extraPanes = [...extraPanes, pane];
        extraPaneRefs = [...extraPaneRefs, undefined];
        paneWeights = normalizeWeights($state.snapshot(paneWeights), paneCount());
        paneScrolls = [...paneScrolls, 0];
        await pane.loadNavigation();
        await pane.loadChapter();
        persistSplitLayout();
    }

    /** First imported translation no open pane is showing. */
    function nextUnusedTranslation(): string {
        const used = new Set([pane0.translation, ...extraPanes.map((p) => p.translation)]);
        return translations.find((t) => !used.has(t.id))?.id ?? pane0.translation;
    }

    async function addPane() {
        if (!canAddPane) return;
        // A new pane opens the same passage in another translation - the
        // main reason to split. It stays independently navigable after.
        await addPaneAtLocation(pane0.book, pane0.chapter, nextUnusedTranslation());
    }

    /** Quotation "open in split" - same translation, the quoted passage. */
    async function openInSplit(book: string, chapter: number) {
        await addPaneAtLocation(book, chapter);
    }

    function removePane(idx: number) {
        extraPanes[idx]?.dispose();
        extraPanes = extraPanes.filter((_, i) => i !== idx);
        extraPaneRefs = extraPaneRefs.filter((_, i) => i !== idx);
        paneWeights = paneWeights.filter((_, i) => i !== idx + 1);
        paneScrolls = paneScrolls.filter((_, i) => i !== idx + 1);
        // Keep the annotation sidebar bound to the same pane across the shift
        if (annotationPaneIndex === idx + 1) annotationPaneIndex = 0;
        else if (annotationPaneIndex > idx + 1) annotationPaneIndex -= 1;
        persistSplitLayout();
    }

    function closeAllExtraPanes() {
        for (const pane of extraPanes) pane.dispose();
        extraPanes = [];
        extraPaneRefs = [];
        paneWeights = [1];
        paneScrolls = [paneScrolls[0] ?? 0];
        annotationPaneIndex = 0;
        persistSplitLayout();
    }

    /** Cmd+\ - open a split when reading solo, close every split when not. */
    function toggleSplit() {
        if (extraPanes.length > 0) closeAllExtraPanes();
        else addPane();
    }

    // ─── Sync scroll (issue #24) ──────────────────────────────
    // Panes showing the same chapter sync by verse anchor - "verse N,
    // this far into it" - because translations wrap differently and
    // fraction sync drifts a few verses over a long chapter. Panes on
    // different passages fall back to 0-1 fractions of scrollable height
    // (never raw pixels - content lengths differ).

    function paneAt(i: number): PaneState {
        return i === 0 ? pane0 : extraPanes[i - 1];
    }

    function handlePaneScroll(i: number, fraction: number) {
        paneScrolls[i] = fraction;
        if (dvPopover) dvPopover = null;
        if (syncScroll) {
            const src = paneAt(i);
            const anchor = paneRefAt(i)?.getScrollAnchor() ?? null;
            for (let j = 0; j < paneCount(); j++) {
                if (j === i) continue;
                const ref = paneRefAt(j);
                const dst = paneAt(j);
                const sameChapter = dst.book === src.book && dst.chapter === src.chapter;
                const anchored = sameChapter && anchor ? (ref?.setScrollAnchor(anchor) ?? false) : false;
                if (!anchored) ref?.setScrollFraction(fraction);
                paneScrolls[j] = ref?.getScrollFraction() ?? fraction;
            }
        }
        schedulePersistScrolls();
    }

    function toggleSyncScroll() {
        syncScroll = !syncScroll;
        if (syncScroll) {
            // Align everything to the primary pane on enable
            const fraction = paneRef?.getScrollFraction() ?? 0;
            handlePaneScroll(0, fraction);
        }
        persistSplitLayout();
    }

    // ─── Draggable dividers (issue #24) ───────────────────────

    function onDividerDown(idx: number, e: PointerEvent) {
        if (!panesRowEl) return;
        dividerDragging = true;
        startDividerDrag(e, {
            index: idx,
            rowWidth: panesRowEl.clientWidth,
            startWeights: $state.snapshot(paneWeights),
            onDrag: (w) => { paneWeights = w; },
            onEnd: () => {
                dividerDragging = false;
                persistSplitLayout();
            },
        });
    }

    /** Double-clicking a divider snaps every pane back to equal width. */
    function resetLayout() {
        paneWeights = paneWeights.map(() => 1);
        persistSplitLayout();
    }

    // ─── Divergence (split panes on the same passage) ─────────
    // Panes showing the lead's book+chapter, deduped by translation -
    // the set the divergence engine compares.
    let comparablePanes = $derived.by(() => {
        if (extraPanes.length === 0) return [] as PaneState[];
        const seen = new Set<string>();
        const set: PaneState[] = [];
        for (const p of [pane0, ...extraPanes]) {
            if (p.loading || p.book !== pane0.book || p.chapter !== pane0.chapter) continue;
            if (seen.has(p.translation)) continue;
            seen.add(p.translation);
            set.push(p);
        }
        return set;
    });

    // Toolbar status: what is being compared, or why nothing is. Uses
    // locations rather than comparablePanes so it doesn't flicker to a
    // "reason" while a pane is merely loading.
    let comparisonInfo = $derived.by(() => {
        if (extraPanes.length === 0) return null;
        const onLead = [pane0, ...extraPanes].filter(
            (p) => p.book === pane0.book && p.chapter === pane0.chapter
        );
        const ids = [...new Set(onLead.map((p) => p.translation))];
        if (onLead.length < 2) return { canCompare: false, label: 'Panes show different passages' };
        if (ids.length < 2) return { canCompare: false, label: 'Panes show the same translation' };
        const abbr = (id: string) => translations.find((t) => t.id === id)?.abbreviation ?? id;
        return { canCompare: true, label: `Comparing ${ids.map(abbr).join(' · ')}` };
    });

    // Cross-pane hover link: the hovered verse's osisId, echoed as a soft
    // highlight in every pane rendering that verse (split only).
    let hoveredOsis = $state<string | null>(null);

    // Divergence popover: opened by clicking a shaded word in any pane.
    // The overlay closes it before any other interaction can go stale;
    // pane scrolls close it too (the anchor point no longer matches).
    let dvPopover = $state<DivergenceClickTarget | null>(null);

    function openDivergencePopover(translation: string, p: { osisId: string; verse: number; start: number; end: number; x: number; y: number }) {
        dvPopover = { ...p, translation };
    }

    let divergence = $state<Map<string, Divergence>>(new Map());
    $effect(() => {
        const set = comparablePanes;
        if (set.length < 2) {
            divergence = new Map();
            return;
        }
        const ids = set.map((p) => p.translation);
        const key = chapterDivergenceKey(pane0.book, pane0.chapter, ids);
        const rows = buildChapterRows(set.map((p) => ({ translation: p.translation, verses: p.verses })));
        let active = true;
        computeChapterDivergence(key, rows).then((map) => {
            if (active) divergence = map;
        });
        return () => { active = false; };
    });

    /** Divergence map for a pane - only when it shows the lead's passage. */
    function paneDivergence(pane: PaneState): Map<string, Divergence> | null {
        if (extraPanes.length === 0) return null;
        return pane.book === pane0.book && pane.chapter === pane0.chapter ? divergence : null;
    }

    /** Divergence Map card click: flash the verse in every pane showing the passage. */
    function jumpToDivergence(verseNum: number) {
        for (let i = 0; i < paneCount(); i++) {
            const p = i === 0 ? pane0 : extraPanes[i - 1];
            if (p.book === pane0.book && p.chapter === pane0.chapter) {
                paneRefAt(i)?.flashVerse(verseNum);
            }
        }
    }

    // ─── Annotation callbacks for panes ───────────────────────
    // No reload after mutating: every pane's allBookAnnotations is a
    // liveQuery subscription (issue #31), so all panes showing the book -
    // and other open tabs - update on their own.
    async function handleSaveAnnotation(_pane: PaneState, ann: Annotation) {
        await saveAnnotation(ann);
    }

    async function handleDeleteAnnotations(_pane: PaneState, ids: string[]) {
        for (const id of ids) await deleteAnnotation(id);
    }

    // ─── Annotation sidebar callbacks ─────────────────────────

    async function saveNote(text: string, tags: string[], anchors?: string[]) {
        // Scratch pad promotion: explicit OSIS anchors, possibly outside
        // the current chapter. Same one-note-per-contiguous-run rule.
        if (anchors && anchors.length > 0) {
            for (const a of groupAnchors(anchors)) {
                const ann: Annotation = {
                    id: crypto.randomUUID(),
                    type: 'note',
                    book: a.book,
                    verseStart: `${a.book}.${a.chapter}.${a.startVerse}`,
                    verseEnd: `${a.book}.${a.chapter}.${a.endVerse}`,
                    data: text,
                    tags: [...tags],
                    created: Date.now(),
                    modified: Date.now(),
                    synced: false
                };
                await saveAnnotation(ann);
            }
            return;
        }

        // The pane whose toolbar opened the sidebar (issue #180) - captured
        // once so an await can't rebind the note mid-save.
        const pane = annotationPane;
        if (pane.selectedVerses.length === 0) return;

        // Create one note per contiguous group to avoid
        // spanning unselected intermediate verses.
        const groups = getContiguousGroups(pane.selectedVerses);
        for (const group of groups) {
            const startV = group[0];
            const endV = group[group.length - 1];
            const ann: Annotation = {
                id: crypto.randomUUID(),
                type: 'note',
                book: pane.book,
                verseStart: `${pane.book}.${pane.chapter}.${startV}`,
                verseEnd: `${pane.book}.${pane.chapter}.${endV}`,
                data: text,
                tags: [...tags],
                created: Date.now(),
                modified: Date.now(),
                synced: false
            };
            await saveAnnotation(ann);
        }
        pane.selectedVerses = [];
    }

    async function handleDeleteAnnotation(id: string) {
        await deleteAnnotation(id);
    }

    async function navigateToAnnotation(book: string, chapter: number, verse: number) {
        visitCurrent();
        await pane0.jumpTo(book, chapter);
        visitCurrent();
        persistSettings();
        ui.annotationSidebarOpen = false;
        requestAnimationFrame(() => {
            flashLead(verse);
        });
    }

    /** Sidebar annotation click: navigate the pane the sidebar is bound to,
        not unconditionally pane 0 (issue #180). */
    async function navigateFromSidebar(book: string, chapter: number, verse: number) {
        const paneIdx = annotationPaneIndex;
        if (paneIdx === 0) {
            await navigateToAnnotation(book, chapter, verse);
            return;
        }
        await annotationPane.jumpTo(book, chapter);
        persistSplitLayout();
        ui.annotationSidebarOpen = false;
        requestAnimationFrame(() => {
            paneRefAt(paneIdx)?.flashVerse(verse);
        });
    }

    /** Navigate the primary pane to a book/chapter/verse (used by cross-reference clicks). */
    async function navigateToVerse(book: string, chapter: number, verse: number) {
        visitCurrent();
        await pane0.jumpTo(book, chapter);
        visitCurrent();
        persistSettings();
        requestAnimationFrame(() => {
            flashLead(verse);
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
                    flashLead(verseNum);
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
            // Cmd+\ (Ctrl+\ elsewhere) toggles the split view (issue #24)
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === '\\' || e.code === 'Backslash')) {
                e.preventDefault();
                toggleSplit();
            }
            // Cmd+Shift+P (Ctrl+Shift+P elsewhere) toggles the scratch pad
            // (issue #23). e.code: with Shift held, e.key is 'P' on some
            // layouts and something else entirely on others.
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === 'KeyP') {
                e.preventDefault();
                scratchPad.toggle();
            }
        }
        window.addEventListener('keydown', handleKeydown);

        // Async initialization (cannot return cleanup from async function in onMount)
        (async () => {
            await translationLibrary.refresh();
            pane0.translation = preferences.value?.activeTranslation ?? 'KJV';
            // The persisted active translation may have been removed via the
            // Translation Manager - fall back to any installed one.
            if (!translationLibrary.isInstalled(pane0.translation) && translations.length > 0) {
                pane0.translation = translations[0].id;
            }

            const { bookParam, chapterParam, hash: urlHash } = applyUrlParams(new URL(window.location.href));

            // If URL lacks params, open at the configured startup location:
            // a fixed passage, or (default) the last viewed location.
            if (!bookParam && !chapterParam) {
                const startup = preferences.value?.startup;
                if (startup?.mode === 'fixed') {
                    pane0.book = startup.book;
                    pane0.chapter = startup.chapter;
                } else {
                    pane0.book = preferences.value?.lastBook ?? 'Gen';
                    pane0.chapter = preferences.value?.lastChapter ?? 1;
                }

                const url = new URL(window.location.href);
                url.searchParams.set('book', pane0.book);
                url.searchParams.set('chapter', pane0.chapter.toString());
                history.replaceState(history.state, '', url.toString());
            }

            await pane0.loadNavigation();
            await pane0.loadChapter();
            await navHistory.load();

            // Restore the split layout from the previous session. A pane's
            // translation may have been removed via the Translation Manager
            // since it was persisted - fall back to pane 0's (issue #238).
            const layout = await restoreSplitLayout();
            showRefs = layout.showRefs;
            showDivergence = layout.showDivergence;
            mapOpen = layout.mapOpen;
            const restoredPanes = layout.extraLocations.map((loc) =>
                createExtraPane(
                    translationLibrary.isInstalled(loc.translation)
                        ? loc
                        : { ...loc, translation: pane0.translation }
                )
            );
            extraPanes = restoredPanes;
            extraPaneRefs = restoredPanes.map(() => undefined);
            syncScroll = layout.syncScroll;
            paneWeights = normalizeWeights(layout.weights, paneCount());
            paneScrolls = Array.from({ length: paneCount() }, (_, i) => layout.scrolls[i] ?? 0);
            for (const pane of restoredPanes) {
                await pane.loadNavigation();
                await pane.loadChapter();
            }

            const hash = window.location.hash || urlHash;
            if (hash.startsWith('#verse-')) {
                const verseNum = hash.slice(7);
                requestAnimationFrame(() => {
                    flashLead(verseNum);
                });
            }

            // Restore each pane's scroll position (as a fraction - content
            // height differs across sessions). Double rAF: panes have just
            // left their loading state, give the verse flow one frame to
            // lay out. A #verse- hash owns the primary pane's scroll.
            requestAnimationFrame(() => requestAnimationFrame(() => {
                for (let i = 0; i < paneCount(); i++) {
                    if (i === 0 && hash.startsWith('#verse-')) continue;
                    const fraction = paneScrolls[i] ?? 0;
                    if (fraction > 0) paneRefAt(i)?.setScrollFraction(fraction);
                }
            }));
        })();

        return () => {
            window.removeEventListener('keydown', handleKeydown);
        };
    });

    onDestroy(() => {
        if (scrollPersistTimer) clearTimeout(scrollPersistTimer);
        ui.splitRail = false;
        pane0.dispose();
        for (const pane of extraPanes) pane.dispose();
    });
</script>

<svelte:head>
    <title>{getBookDisplayName(pane0.book)} {pane0.chapter} - Codex Scriptura</title>
</svelte:head>

<svelte:window bind:innerWidth={windowWidth} />

<div class="reader-page">
    <!-- Header Bar. Solo reading uses it as the passage bar (book,
         chapter strip, reading time). A split moves per-pane nav into
         each pane's compact header, so the bar slims to app-level
         controls only. -->
    <header class="reader-header">
        <div class="reader-nav-left">
            {#if extraPanes.length === 0}
                <SelectTrigger
                    id="book-selector-toggle"
                    expanded={pane0.bookSelectorOpen}
                    onclick={() => pane0.bookSelectorOpen = !pane0.bookSelectorOpen}
                >
                    <span class="book-name">{getBookDisplayName(pane0.book)}</span>
                    <span class="chapter-badge">{pane0.chapter}</span>
                </SelectTrigger>
            {/if}
        </div>

        <div class="reader-nav-center">
            {#if extraPanes.length === 0}
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
            {/if}
        </div>

        <div class="reader-nav-right" style="display:flex; gap: 8px; align-items: center;">
            {#if extraPanes.length === 0 && readingTimeMinutes > 0}
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
            {#if extraPanes.length === 0 && pane0.enrichment && (pane0.enrichment.persons.length > 0 || pane0.enrichment.places.length > 0 || pane0.enrichment.events.length > 0)}
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
            {#if extraPanes.length === 0}
                {#if translations.length > 1 || downloadableTranslations.length > 0}
                    <select
                        class="translation-picker"
                        value={pane0.translation}
                        onchange={(e) => {
                            const select = e.target as HTMLSelectElement;
                            const id = select.value;
                            // Not-installed picks download first; snap the
                            // select back to the current translation until
                            // the switch actually happens (issue #238).
                            if (!translationLibrary.isInstalled(id)) select.value = pane0.translation;
                            requestPaneTranslation(pane0, id);
                        }}
                        id="translation-picker"
                        title={translationTitle(translations.find((t) => t.id === pane0.translation) ?? translations[0])}
                    >
                        {#each translations as t}
                            <option value={t.id} title={translationTitle(t)}>{translationLabel(t)}</option>
                        {/each}
                        {#if downloadableTranslations.length > 0}
                            <optgroup label="Not downloaded">
                                {#each downloadableTranslations as t}
                                    <option value={t.id} title="{translationTitle(t)} - downloads on selection">{translationLabel(t)} ↓</option>
                                {/each}
                            </optgroup>
                        {/if}
                    </select>
                    {#if libraryNote}
                        <span class="library-note" role="status">{libraryNote}</span>
                    {/if}
                {:else}
                    <span class="translation-badge">{pane0.translation}</span>
                {/if}
            {/if}

            <!-- Scratch pad toggle (issue #23) -->
            <button
                class="nav-btn"
                id="scratch-pad-toggle"
                onclick={() => scratchPad.toggle()}
                aria-label="Toggle scratch pad"
                aria-pressed={scratchPad.isOpen}
                title="Scratch pad ({isMac ? '⌘⇧P' : 'Ctrl+Shift+P'})"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9l-5-6z" />
                    <path d="M16 3v6h5" />
                    <path d="M8 13h8M8 17h5" />
                </svg>
            </button>

            <!-- Split pane controls -->
            {#if extraPanes.length < 2}
                <button
                    class="nav-btn split-btn"
                    id="split-pane-btn"
                    onclick={addPane}
                    disabled={!canAddPane}
                    aria-label={extraPanes.length === 0 ? 'Open split view' : 'Add pane'}
                    title={canAddPane ? `${extraPanes.length === 0 ? 'Open split view' : 'Add pane'} (${isMac ? '⌘\\' : 'Ctrl+\\'})` : 'Not enough room for another pane'}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="3" width="7" height="18" rx="1"/>
                        <rect x="14" y="3" width="7" height="18" rx="1"/>
                    </svg>
                </button>
            {/if}
        </div>
    </header>

    <!-- Book Selector Dropdown (solo; split panes carry their own) -->
    {#if extraPanes.length === 0}
        <BookSelector pane={pane0} {translations} />
    {/if}

    <!-- Workspace toolbar: split-view controls (issue #24) -->
    {#if extraPanes.length > 0}
        <SplitToolbar
            {syncScroll}
            {showRefs}
            {showDivergence}
            {mapOpen}
            canCompare={comparisonInfo?.canCompare ?? false}
            statusLabel={comparisonInfo?.label ?? ''}
            onToggleSyncScroll={toggleSyncScroll}
            onToggleRefs={() => { showRefs = !showRefs; persistSplitLayout(); }}
            onToggleDivergence={() => { showDivergence = !showDivergence; persistSplitLayout(); }}
            onToggleMap={() => { mapOpen = !mapOpen; persistSplitLayout(); }}
        />
    {/if}

    <!-- Panes Row. Every pane gets the identical compact header (and book
         dropdown) while a split is open; the primary pane cannot close. -->
    <div class="panes-row" class:divider-dragging={dividerDragging} bind:this={panesRowEl}>
        <!-- Primary pane (pane 0) -->
        <div class="pane-wrapper" style="flex: {paneWeights[0] ?? 1} 1 0%">
            {#if extraPanes.length > 0}
                <PaneHeader pane={pane0} {translations} />
            {/if}
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
                showRefs={extraPanes.length === 0 || showRefs}
                {showDivergence}
                divergence={paneDivergence(pane0)}
                linkedHoverOsis={extraPanes.length > 0 ? hoveredOsis : null}
                onVerseHover={extraPanes.length > 0 ? (o) => hoveredOsis = o : undefined}
                onDivergenceClick={(p) => openDivergencePopover(pane0.translation, p)}
                bind:selectedVerses={pane0.selectedVerses}
                bind:panelMode={pane0.panelMode}
                onSaveAnnotation={(ann) => handleSaveAnnotation(pane0, ann)}
                onDeleteAnnotations={(ids) => handleDeleteAnnotations(pane0, ids)}
                onOpenAnnotationSidebar={() => openAnnotationSidebarFor(0)}
                onNavigateToVerse={navigateToVerse}
                onOpenInSplit={(book, chapter) => openInSplit(book, chapter)}
                onScrollFraction={(f) => handlePaneScroll(0, f)}
                onSendToScratchPad={(blocks) => scratchPad.insertBlocks(blocks)}
            />
        </div>

        <!-- Extra panes (1–2) - each independently navigable -->
        {#each extraPanes as pane, idx (pane.id)}
            <div
                class="pane-divider"
                role="separator"
                aria-orientation="vertical"
                aria-label="Drag to resize panes; double-click to equalize"
                title="Drag to resize; double-click to equalize"
                onpointerdown={(e) => onDividerDown(idx, e)}
                ondblclick={resetLayout}
            ></div>
            <div class="pane-wrapper pane-extra" style="flex: {paneWeights[idx + 1] ?? 1} 1 0%">
                <PaneHeader {pane} {translations} canClose onClose={() => removePane(idx)} />

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
                    {showRefs}
                    {showDivergence}
                    divergence={paneDivergence(pane)}
                    linkedHoverOsis={hoveredOsis}
                    onVerseHover={(o) => hoveredOsis = o}
                    onDivergenceClick={(p) => openDivergencePopover(pane.translation, p)}
                    bind:selectedVerses={pane.selectedVerses}
                    bind:panelMode={pane.panelMode}
                    onSaveAnnotation={(ann) => handleSaveAnnotation(pane, ann)}
                    onDeleteAnnotations={(ids) => handleDeleteAnnotations(pane, ids)}
                    onOpenAnnotationSidebar={() => openAnnotationSidebarFor(idx + 1)}
                    onOpenInSplit={(book, chapter) => openInSplit(book, chapter)}
                    onScrollFraction={(f) => handlePaneScroll(idx + 1, f)}
                    onSendToScratchPad={(blocks) => scratchPad.insertBlocks(blocks)}
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

        {#if extraPanes.length > 0 && mapOpen}
            <DivergenceMap
                panes={comparablePanes}
                {translations}
                {divergence}
                onJump={jumpToDivergence}
            />
        {/if}
    </div>

    <!-- Divergence popover: compare renderings of one clicked word -->
    {#if dvPopover && comparablePanes.length >= 2}
        <DivergencePopover
            target={dvPopover}
            panes={comparablePanes}
            {translations}
            {divergence}
            onClose={() => dvPopover = null}
        />
    {/if}

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
        book={annotationPane.book}
        chapter={annotationPane.chapter}
        selectedVerses={annotationPane.selectedVerses}
        bookAnnotations={annotationPane.allBookAnnotations}
        onSaveNote={saveNote}
        onDeleteAnnotation={handleDeleteAnnotation}
        onNavigate={navigateFromSidebar}
    />
    
    <!-- Scratch Pad (issue #23) - floats over the workspace, survives navigation -->
    <ScratchPad />

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

    /* Passage-bar overflow contract: the chapter strip is the only child
       allowed to shrink; every trailing control is flex: none + nowrap so
       nothing gets pushed out or clipped at narrow widths. */
    .reader-nav-left, .reader-nav-right {
        flex: none;
        white-space: nowrap;
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
        flex: 1 1 auto;
        min-width: 0;
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
    .library-note {
        font-size: 0.72rem;
        color: var(--color-text-secondary);
        white-space: nowrap;
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
    .panes-row.divider-dragging {
        cursor: col-resize;
        user-select: none;
    }

    .pane-wrapper {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 280px;
        overflow: hidden;
        position: relative;
    }

    /* ─── Pane divider (drag to resize, issue #24) ──── */
    .pane-divider {
        flex: 0 0 5px;
        cursor: col-resize;
        position: relative;
        background: transparent;
        transition: background var(--transition-fast);
        touch-action: none;
    }
    .pane-divider::before {
        content: '';
        position: absolute;
        left: 2px;
        top: 0;
        bottom: 0;
        width: 1px;
        background: var(--color-border);
    }
    .pane-divider:hover,
    .divider-dragging .pane-divider {
        background: var(--color-accent-subtle);
    }

    /* ─── Split button ──────────────────────────────── */
    .split-btn {
        color: var(--color-text-secondary);
    }
    .split-btn:disabled {
        opacity: 0.4;
        cursor: default;
    }

    /* ─── Narrow-width passage bar (no horizontal overflow, ever) ─ */
    @media (max-width: 1000px) {
        .reading-time { display: none; }
        .search-affordance-text,
        .search-affordance-kbd { display: none; }
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
        /* Panes must not force the row wider than the phone; stack any
           split panes instead of squeezing them side by side. Dividers
           (and the split toolbar, hidden by its own component) are
           pointer-driven desktop furniture. */
        .panes-row { flex-direction: column; }
        .pane-wrapper { min-width: 0; }
        /* ~ not +: the (hidden) divider element sits between wrappers */
        .pane-wrapper ~ .pane-wrapper {
            border-top: 1px solid var(--color-border);
        }
        .pane-divider { display: none; }
        .split-btn { display: none; }
    }
</style>
