<script lang="ts">
    import { goto } from '$app/navigation';
    import { tick, untrack } from 'svelte';
    import { buildGutterMarks, otherEnd, type GutterMark } from '$lib/utils/gutter';
    import EntityDetailPanel from '$lib/components/EntityDetailPanel.svelte';
    import EntityListPanel from '$lib/components/EntityListPanel.svelte';
    import LineageRail from '$lib/components/LineageRail.svelte';
    import DictDefinition from '$lib/components/DictDefinition.svelte';
    import StudyRail from '$lib/components/StudyRail.svelte';
    import { RAIL_DEFAULT_WIDTH, clampRailWidth, type RailTab } from '$lib/stores/studyRail.svelte';
    import { preferences } from '$lib/stores/preferences.svelte';
    import { renderVerseHtml, getEntitiesForVerse as sharedEntitiesForVerse, parseWjRanges, formatOsisLabel, isVerseInAnnotation, verseHighlightColor, type EntityRef } from '$lib/utils/verse-render';
    import type { Divergence } from '$lib/engines/divergence';
    import type { VerseRecord, Annotation, Person, Place, BibleEvent, DictionaryEntry, CrossReference, ScratchPadVerseBlock } from '@codex-scriptura/core';
    import { findBook, parseOsisId } from '@codex-scriptura/core';
    import { lookupDictionary, getCrossReferencesForChapter, getRelationshipsForPerson, getThemes, themeSlug, type ThemeSummary } from '@codex-scriptura/db';
    import { verseHover } from '$lib/actions/verseHover';
    import { getContiguousGroups } from '$lib/utils/verse-groups';
    import { formatVerseBlock } from '$lib/utils/scratchPad';
    import { scrollFraction, fractionToScrollTop } from '$lib/utils/splitLayout';
    import { ui } from '$lib/stores/ui.svelte';
    import { toast } from '$lib/stores/toast.svelte';
    import { formatVersesForCopy } from '$lib/utils/copy-verses';
    import type { PaneState } from '$lib/stores/splitPanes.svelte';

    type SelectedEntity =
        | { type: 'person'; data: Person }
        | { type: 'place'; data: Place }
        | { type: 'event'; data: BibleEvent };

    type HighlightColor = { name: string; id: string; value: string };

    let {
        pane,
        highlightColors,
        showVerseNumbers,
        paragraphMode = true,
        showRedLetters = true,
        showRefs = true,
        showEntitiesLayer = false,
        showDivergence = true,
        divergence = null,
        linkedHoverOsis = null,
        onVerseHover,
        onDivergenceClick,
        onSaveAnnotation,
        onDeleteAnnotations,
        onOpenAnnotationSidebar,
        onNavigateToVerse,
        onOpenInSplit,
        onScrollFraction,
        onSendToScratchPad,
    }: {
        /** The pane this component renders: location, verses, enrichment, selection, panel mode. */
        pane: PaneState;
        highlightColors: HighlightColor[];
        showVerseNumbers: boolean;
        paragraphMode?: boolean;
        showRedLetters?: boolean;
        /** Inline cross-reference and quotation badges (Layers menu, split toolbar). */
        showRefs?: boolean;
        /** Layers menu: underline people, places and events even with no rail tab in front. */
        showEntitiesLayer?: boolean;
        /** Gates divergence shading visually (CSS var flip, zero re-render). */
        showDivergence?: boolean;
        /** Per-verse divergence spans vs the other split panes, keyed by osisId. */
        divergence?: Map<string, Divergence> | null;
        /** Cross-pane hover link: this pane echoes the verse hovered in a sibling pane. */
        linkedHoverOsis?: string | null;
        /** Reports the hovered verse's osisId (null on leave) for cross-pane linking. */
        onVerseHover?: (osisId: string | null) => void;
        /** Click on a shaded divergent word: char span in this pane's verse text + screen anchor. */
        onDivergenceClick?: (payload: { osisId: string; verse: number; start: number; end: number; x: number; y: number }) => void;
        onSaveAnnotation: (ann: Annotation) => Promise<void>;
        onDeleteAnnotations: (ids: string[]) => Promise<void>;
        onOpenAnnotationSidebar: () => void;
        onNavigateToVerse?: (book: string, chapter: number, verse: number) => void;
        onOpenInSplit?: (book: string, chapter: number) => void;
        /** Reports user scrolls as a 0-1 fraction of scrollable height (sync scroll, issue #24). */
        onScrollFraction?: (fraction: number) => void;
        /** Quotes the selected verses into the workspace scratch pad (issue #23). */
        onSendToScratchPad?: (blocks: ScratchPadVerseBlock[]) => void;
    } = $props();

    // Read-only views of the pane; selection and panel mode are written
    // straight to pane.selectedVerses / pane.panelMode.
    const verses = $derived(pane.verses);
    const loading = $derived(pane.loading);
    const bookId = $derived(pane.book);
    const bookName = $derived(findBook(pane.book)?.name ?? pane.book);
    const chapter = $derived(pane.chapter);
    const translationId = $derived(pane.translation);
    const enrichment = $derived(pane.enrichment);
    const allBookAnnotations = $derived(pane.allBookAnnotations);

    // ─── Scratch pad (issue #23) ──────────────────────────────
    function verseToScratchBlock(verseNum: number): ScratchPadVerseBlock | null {
        const rec = verses.find((v: VerseRecord) => v.verse === verseNum);
        if (!rec) return null;
        const osisId = `${bookId}.${chapter}.${verseNum}`;
        return { osisId, translationId, text: rec.text, reference: formatOsisLabel(osisId) };
    }

    async function copySelection() {
        const selected = verses.filter((v) => pane.selectedVerses.includes(v.verse));
        const text = formatVersesForCopy(bookName, chapter, translationId, selected);
        try {
            await navigator.clipboard.writeText(text);
            toast.show(selected.length === 1 ? 'Copied 1 verse' : `Copied ${selected.length} verses`);
        } catch {
            toast.show('Copy failed - clipboard not available');
        }
    }

    function sendSelectionToScratchPad() {
        const blocks = pane.selectedVerses
            .map(verseToScratchBlock)
            .filter((b): b is ScratchPadVerseBlock => b !== null);
        onSendToScratchPad?.(blocks);
    }

    // Verse numbers double as drag handles: text/plain carries the quoted
    // block for arbitrary targets, the custom type carries the structured
    // payload the scratch pad registers.
    function handleVerseDragStart(e: DragEvent, verseNum: number) {
        const block = verseToScratchBlock(verseNum);
        if (!block || !e.dataTransfer) return;
        e.dataTransfer.setData('application/x-codex-scriptura-verses', JSON.stringify([block]));
        e.dataTransfer.setData('text/plain', formatVerseBlock(block));
        e.dataTransfer.effectAllowed = 'copy';
    }

    // ─── Content scroll (sync scroll + persistence, issue #24) ─
    let scrollEl: HTMLDivElement | undefined = $state();
    // Armed by setScrollFraction so the scroll event a programmatic set
    // fires is not re-reported as a user scroll (feedback loop).
    let suppressScrollEvent = false;

    function handleContentScroll() {
        if (suppressScrollEvent) {
            suppressScrollEvent = false;
            return;
        }
        if (!scrollEl) return;
        onScrollFraction?.(scrollFraction(scrollEl.scrollTop, scrollEl.scrollHeight, scrollEl.clientHeight));
    }

    export function getScrollFraction(): number {
        if (!scrollEl) return 0;
        return scrollFraction(scrollEl.scrollTop, scrollEl.scrollHeight, scrollEl.clientHeight);
    }

    export function setScrollFraction(fraction: number) {
        if (!scrollEl) return;
        const target = fractionToScrollTop(fraction, scrollEl.scrollHeight, scrollEl.clientHeight);
        if (Math.abs(scrollEl.scrollTop - target) < 1) return;
        suppressScrollEvent = true;
        scrollEl.scrollTop = target;
    }

    // Verse-anchored sync scroll: when two panes show the same chapter,
    // syncing by fraction drifts (translations wrap differently), so the
    // workspace exchanges "verse N, this far into it" anchors instead.

    /** The verse at the top of the viewport, plus how far into it the viewport top sits (0-1). */
    export function getScrollAnchor(): { verse: number; progress: number } | null {
        if (!scrollEl) return null;
        const containerTop = scrollEl.getBoundingClientRect().top;
        for (const el of scrollEl.querySelectorAll<HTMLElement>('.verse[data-verse]')) {
            const r = el.getBoundingClientRect();
            if (r.height <= 0 || r.bottom <= containerTop + 1) continue;
            const verse = Number(el.dataset.verse);
            if (isNaN(verse)) return null;
            return { verse, progress: Math.max(0, (containerTop - r.top) / r.height) };
        }
        return null;
    }

    /** Scroll so `anchor.verse` sits at the viewport top; false if the verse isn't rendered here. */
    export function setScrollAnchor(anchor: { verse: number; progress: number }): boolean {
        if (!scrollEl) return false;
        const el = scrollEl.querySelector<HTMLElement>(`.verse[data-verse="${anchor.verse}"]`);
        if (!el) return false;
        const c = scrollEl.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        // Clamp to the scrollable range: an out-of-range assignment gets clamped
        // by the browser without firing a scroll event, which would leave
        // suppressScrollEvent armed to eat the next real user scroll
        const target = Math.max(
            0,
            Math.min(
                scrollEl.scrollTop + (r.top - c.top) + anchor.progress * r.height,
                scrollEl.scrollHeight - scrollEl.clientHeight
            )
        );
        if (Math.abs(scrollEl.scrollTop - target) < 1) return true;
        suppressScrollEvent = true;
        scrollEl.scrollTop = target;
        return true;
    }

    // ─── Study Rail (issue #243) ──────────────────────────────
    // Every side panel is a resident tab on the pane's rail; the panel
    // state that used to live here is the tab payload, so it survives
    // chapter changes and switching between tabs.
    type EntityPayload = { entity: SelectedEntity; dictEntry: DictionaryEntry | null; hasFamily: boolean };
    type LookupPayload = { word: string; dictEntry?: DictionaryEntry; type: 'dictionary' | 'fallback' };
    type LineagePayload = { rootId: string; sourceVerse: number };

    const rail = $derived(pane.rail);
    const activeTab = $derived(rail.open ? rail.active : null);
    /** Entity marks show with the Entities layer on, or while a Who's here or entity tab is in front. */
    const showEntities = $derived(showEntitiesLayer || activeTab?.kind === 'entities' || activeTab?.kind === 'entity');
    const lineageActiveId = $derived(activeTab?.kind === 'lineage' ? (activeTab.payload as LineagePayload).rootId : null);
    const entityCount = $derived(enrichment ? enrichment.persons.length + enrichment.places.length + enrichment.events.length : 0);

    // Width is a preference (320 to 520); the drag writes it live and the
    // store's debounced save persists it.
    const railWidth = $derived(clampRailWidth(preferences.value?.studyRailWidth ?? RAIL_DEFAULT_WIDTH));
    function setRailWidth(w: number) {
        preferences.update({ studyRailWidth: w });
    }

    function openEntitiesTab() {
        rail.show({ id: 'entities', kind: 'entities', title: "Who's here", qualifier: `${bookName} ${chapter}`, badge: entityCount });
    }

    // The Who's here tab follows the chapter: same tab, new qualifier and
    // count. Only the chapter inputs are tracked; touching rail.tabs inside
    // a tracked read would re-run the effect on its own write.
    $effect(() => {
        const qualifier = `${bookName} ${chapter}`;
        const badge = entityCount;
        untrack(() => {
            if (rail.has('entities')) rail.update('entities', { qualifier, badge });
        });
    });

    function openLineage(personId: string, verseNum: number) {
        rail.show<LineagePayload>({
            id: 'lineage',
            kind: 'lineage',
            title: 'Lineage',
            qualifier: `${bookId} ${chapter}:${verseNum}`,
            payload: { rootId: personId, sourceVerse: verseNum },
        });
    }

    function rerootLineage(id: string) {
        const t = rail.tabs.find((x) => x.id === 'lineage');
        if (t) rail.update<LineagePayload>('lineage', { payload: { ...(t.payload as LineagePayload), rootId: id } });
    }

    // ─── Internal pane state ──────────────────────────────────
    let lastSelectedVerse: number | null = $state(null);

    // ─── Cross-reference state ────────────────────────────────
    /** Map of OSIS verse ID → cross-references (sorted by votes desc) for the current chapter */
    let chapterXrefs = $state<Map<string, CrossReference[]>>(new Map());
    /** Set of verse numbers whose xref row is currently expanded */
    let expandedXrefVerses = $state<Set<number>>(new Set());
    /** Set of verse numbers whose full xref list (beyond the limit) is shown */
    let fullyExpandedXrefs = $state<Set<number>>(new Set());
    /** Verse number whose quotation popover is currently open (null = none) */
    let quotationPopoverVerse = $state<number | null>(null);

    const XREF_DISPLAY_LIMIT = 5;

    function toggleXrefExpansion(verseNum: number) {
        const next = new Set(expandedXrefVerses);
        if (next.has(verseNum)) {
            next.delete(verseNum);
        } else {
            next.add(verseNum);
        }
        expandedXrefVerses = next;
    }

    function handleXrefClick(osisId: string) {
        const ref = parseOsisId(osisId);
        if (ref && onNavigateToVerse) onNavigateToVerse(ref.book, ref.chapter, ref.verse);
    }

    // Reset pane-internal state when chapter content changes
    let prevChapterKey = '';
    $effect(() => {
        const key = `${bookId}.${chapter}`;
        if (key !== prevChapterKey) {
            prevChapterKey = key;
            lastSelectedVerse = null;
            expandedXrefVerses = new Set();
            fullyExpandedXrefs = new Set();
            quotationPopoverVerse = null;
        }
    });

    // ─── Verse gutter (issue #249) ────────────────────────────
    // One marker per verse with references, in a gutter outside the column
    // at the verse's first line, so the serif measure carries no inline
    // decoration. Positions are measured after render and again whenever
    // the column resizes (font size, pane width, an expanded row).
    const GUTTER_MARK = 20;
    let articleEl: HTMLElement | undefined = $state();
    let gutterMarks = $state<GutterMark[]>([]);

    function measureGutter() {
        if (!articleEl || !showRefs) {
            gutterMarks = [];
            return;
        }
        const columnTop = articleEl.getBoundingClientRect().top;
        const boxes = [];
        for (const el of articleEl.querySelectorAll<HTMLElement>('.verse[data-verse]')) {
            const rects = el.getClientRects();
            if (rects.length === 0) continue;
            boxes.push({ verse: Number(el.dataset.verse), osisId: el.dataset.osis ?? '', top: rects[0].top - columnTop, lineHeight: rects[0].height });
        }
        gutterMarks = buildGutterMarks(boxes, chapterXrefs, GUTTER_MARK);
    }

    $effect(() => {
        // Anything that moves a verse re-measures the gutter after the DOM settles
        void verses; void chapterXrefs; void showRefs; void paragraphMode; void showVerseNumbers;
        void expandedXrefVerses; void fullyExpandedXrefs; void quotationPopoverVerse;
        let cancelled = false;
        tick().then(() => requestAnimationFrame(() => { if (!cancelled) measureGutter(); }));
        return () => { cancelled = true; };
    });

    $effect(() => {
        const el = articleEl;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(() => measureGutter());
        ro.observe(el);
        return () => ro.disconnect();
    });

    // Load cross-references for the chapter in a single batch call
    $effect(() => {
        const b = bookId;
        const ch = chapter;
        let active = true;
        getCrossReferencesForChapter(b, ch).then(map => {
            if (active) chapterXrefs = map;
        }).catch(err => {
            console.error(`[reader] Cross-references for ${b} ${ch} failed:`, err);
            if (active) chapterXrefs = new Map();
        });
        return () => { active = false; };
    });

    // ─── Exported methods for parent orchestration ────────────
    export function flashVerse(verseNum: number | string) {
        // data-verse, not a DOM id: several panes render the same verse
        // numbers while a split is open, and duplicate ids are invalid
        // HTML (and getElementById would always hit the first pane).
        const el = (scrollEl ?? document).querySelector(`.verse[data-verse="${verseNum}"]`) as HTMLElement | null;
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.remove('verse-flash');
        void el.offsetWidth;
        el.classList.add('verse-flash');
        el.addEventListener('animationend', () => el.classList.remove('verse-flash'), { once: true });
    }

    // ─── Verse highlighting derivations (shared logic in verse-render) ─
    // Highlights are translation-scoped: one made in ASV marks ASV's
    // wording and must not tint the same verse in a KJV pane. Legacy
    // highlights (no translation field) show everywhere.
    let paneAnnotations = $derived(allBookAnnotations.filter(
        a => a.type !== 'highlight' || !a.translation || a.translation === translationId
    ));
    let verseStyles = $derived.by(() => {
        const styles: Record<number, string> = {};
        for (const v of verses) {
            const color = verseHighlightColor(chapter, v.verse, paneAnnotations);
            if (color) styles[v.verse] = `background-color: ${color};`;
        }
        return styles;
    });

    let versesWithNotes = $derived(allBookAnnotations.filter(a => a.type === 'note'));

    function verseHasNote(v: number): boolean {
        return versesWithNotes.some(a => isVerseInAnnotation(chapter, v, a));
    }

    // ─── Verse selection ──────────────────────────────────────
    function toggleVerseSelection(v: number, event?: MouseEvent) {
        if (event?.shiftKey && lastSelectedVerse !== null) {
            const min = Math.min(lastSelectedVerse, v);
            const max = Math.max(lastSelectedVerse, v);
            const range: number[] = [];
            for (let i = min; i <= max; i++) range.push(i);
            const merged = new Set([...pane.selectedVerses, ...range]);
            pane.selectedVerses = Array.from(merged).sort((a, b) => a - b);
        } else if (pane.selectedVerses.includes(v)) {
            pane.selectedVerses = pane.selectedVerses.filter(num => num !== v);
        } else {
            pane.selectedVerses = [...pane.selectedVerses, v].sort((a, b) => a - b);
        }
        lastSelectedVerse = v;
    }

    // ─── Annotation actions ───────────────────────────────────

    async function applyHighlight(colorValue: string) {
        if (pane.selectedVerses.length === 0) return;

        // Create one annotation per contiguous group to avoid
        // spanning unselected intermediate verses.
        const groups = getContiguousGroups(pane.selectedVerses);
        for (const group of groups) {
            const startV = group[0];
            const endV = group[group.length - 1];
            const ann: Annotation = {
                id: crypto.randomUUID(),
                type: 'highlight',
                book: bookId,
                verseStart: `${bookId}.${chapter}.${startV}`,
                verseEnd: `${bookId}.${chapter}.${endV}`,
                data: '',
                color: colorValue,
                translation: translationId,
                tags: [],
                created: Date.now(),
                modified: Date.now(),
                synced: false
            };
            await onSaveAnnotation(ann);
        }
        pane.selectedVerses = [];
    }

    // ─── Theme threading (issue #22) ──────────────────────────

    let themeInputOpen = $state(false);
    let themeInput = $state('');
    let knownThemes = $state<ThemeSummary[]>([]);

    async function openThemeInput() {
        themeInputOpen = !themeInputOpen;
        if (themeInputOpen) knownThemes = await getThemes();
    }

    async function applyTheme() {
        const label = themeInput.trim();
        if (!label || pane.selectedVerses.length === 0) return;
        const slug = themeSlug(label);
        if (!slug) return;

        const groups = getContiguousGroups(pane.selectedVerses);
        let tagged = 0;
        for (const group of groups) {
            const verseStart = `${bookId}.${chapter}.${group[0]}`;
            const verseEnd = `${bookId}.${chapter}.${group[group.length - 1]}`;
            // Same range already carries this theme - don't stack duplicates
            const duplicate = allBookAnnotations.some(a =>
                a.type === 'theme' && a.tags[0] === slug &&
                a.verseStart === verseStart && a.verseEnd === verseEnd
            );
            if (duplicate) continue;
            tagged++;
            await onSaveAnnotation({
                id: crypto.randomUUID(),
                type: 'theme',
                book: bookId,
                verseStart,
                verseEnd,
                data: label,
                tags: [slug],
                created: Date.now(),
                modified: Date.now(),
                synced: false
            });
        }
        themeInput = '';
        themeInputOpen = false;
        pane.selectedVerses = [];
        toast.show(tagged > 0 ? `Tagged with "${label}"` : `Already tagged with "${label}"`);
    }

    async function removeHighlightsOnSelection() {
        if (pane.selectedVerses.length === 0) return;
        // Erase only what this pane shows - another translation's
        // highlights on the same verses are not visible here.
        const toDelete = paneAnnotations.filter(a =>
            a.type === 'highlight' &&
            pane.selectedVerses.some(v => isVerseInAnnotation(chapter, v, a))
        );
        if (toDelete.length > 0) {
            await onDeleteAnnotations(toDelete.map(a => a.id));
        }
        pane.selectedVerses = [];
    }

    // ─── Entity tabs ──────────────────────────────────────────
    function chapterVerseNumsFor(entity: SelectedEntity): number[] {
        const prefix = `${bookId}.${chapter}.`;
        return entity.data.verseRefs
            .filter(r => r.startsWith(prefix))
            .map(r => parseOsisId(r)?.verse)
            .filter((n): n is number => n !== undefined)
            .sort((a, b) => a - b);
    }

    const KIND_LABEL = { person: 'Person', place: 'Place', event: 'Event' } as const;

    async function selectEntity(type: 'person' | 'place' | 'event', data: Person | Place | BibleEvent) {
        const id = `entity:${data.id}`;
        // Clicking the entity whose tab is already in front closes it
        if (activeTab?.id === id) {
            rail.close(id);
            return;
        }
        if (rail.has(id)) {
            rail.activate(id);
            return;
        }
        const entity = { type, data } as SelectedEntity;
        rail.show<EntityPayload>({ id, kind: 'entity', title: data.name, qualifier: KIND_LABEL[type], payload: { entity, dictEntry: null, hasFamily: false } });
        const patch = (part: Partial<EntityPayload>) => {
            const t = rail.tabs.find((x) => x.id === id);
            if (t) rail.update<EntityPayload>(id, { payload: { ...(t.payload as EntityPayload), ...part } });
        };
        // Only offer the Family tree button when the person is actually in
        // the genealogy graph (God and many minor figures are not)
        if (type === 'person') {
            getRelationshipsForPerson(data.id).then((links) => patch({ hasFamily: links.length > 0 }));
        }
        if (!data.description) {
            const entry = await lookupDictionary(data.name);
            patch({ dictEntry: entry ?? null });
        }
    }

    function handleEntityMarkClick(id: string, type: 'person' | 'place' | 'event', name: string) {
        if (!enrichment) return;
        const data =
            type === 'person' ? enrichment.persons.find(p => p.id === id) :
            type === 'place'  ? enrichment.places.find(p => p.id === id) :
                                enrichment.events.find(e => e.id === id);
        if (data) selectEntity(type, data);
    }

    function handleEntityListSelected(payload: { id: string; type: 'person' | 'place' | 'event'; name: string }) {
        handleEntityMarkClick(payload.id, payload.type, payload.name);
    }

    function scrollToVerse(verseNum: number) {
        flashVerse(verseNum);
    }

    // ─── Inline entity highlighting (shared logic in verse-render) ─
    function getEntitiesForVerse(verse: VerseRecord): EntityRef[] {
        return sharedEntitiesForVerse(verse, enrichment, bookId);
    }

    function buildVerseHtml(verse: VerseRecord, entities: EntityRef[], wjRanges?: number[][]): string {
        return renderVerseHtml(
            verse.text,
            entities,
            wjRanges,
            {
                redLetters: showRedLetters,
                lineageActiveId,
            },
            divergence?.get(verse.osisId)?.spans[translationId]
        );
    }

    // ─── Word double-click lookup ───────────────────────────
    function normalizeWord(word: string): string {
        let w = word.toLowerCase().replace(/[^a-z]/g, '');
        if (w.length <= 3) return w;
        const suffixes = ['tion', 'ness', 'ment', 'able', 'ible', 'ing', 'ed', 'er', 'es', 's'];
        for (const suffix of suffixes) {
            if (w.endsWith(suffix) && w.length - suffix.length >= 3) {
                return w.slice(0, -suffix.length);
            }
        }
        return w;
    }

    async function lookupWord(word: string) {
        const normalized = normalizeWord(word);
        const original = word.toLowerCase().replace(/[^a-z]/g, '');

        // 1. Check Theographic entities
        if (enrichment) {
            const person = enrichment.persons.find(p => {
                const n = p.name.toLowerCase();
                return n === original || n === normalized || n.startsWith(normalized);
            });
            if (person) { selectEntity('person', person); return; }

            const place = enrichment.places.find(p => {
                const n = p.name.toLowerCase();
                return n === original || n === normalized || n.startsWith(normalized);
            });
            if (place) { selectEntity('place', place); return; }

            const event = enrichment.events.find(e => {
                const n = e.name.toLowerCase();
                return n === original || n.includes(original);
            });
            if (event) { selectEntity('event', event); return; }
        }

        // 2. Check Easton's Bible Dictionary
        const dictEntry = await lookupDictionary(original);
        const dictEntryNorm = dictEntry ?? await lookupDictionary(normalized);

        const id = `lookup:${original || normalized}`;
        if (dictEntryNorm) {
            rail.show<LookupPayload>({ id, kind: 'lookup', title: word, qualifier: "Easton's", payload: { word, dictEntry: dictEntryNorm, type: 'dictionary' } });
            return;
        }

        // 3. Fallback
        rail.show<LookupPayload>({ id, kind: 'lookup', title: word, qualifier: 'No entry', payload: { word, type: 'fallback' } });
    }

    function handleWordDoubleClick(e: MouseEvent) {
        e.preventDefault();
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;
        const word = selection.toString().trim();
        if (!word || word.includes(' ')) return;
        lookupWord(word);
    }
</script>

<!-- Main Body: verse text + entity panel -->
<div class="reader-body">
    <div class="reader-content" class:has-gutter={showRefs} bind:this={scrollEl} onscroll={handleContentScroll}>
        {#if loading}
            <div class="reader-loading">
                <div class="loading-shimmer"></div>
                <div class="loading-shimmer short"></div>
                <div class="loading-shimmer"></div>
            </div>
        {:else if verses.length === 0}
            <div class="reader-empty">
                <p>No verses found for {bookName} {chapter}</p>
            </div>
        {:else}
            <article class="scripture-text" class:show-entities={showEntities} bind:this={articleEl}>
                <h1 class="chapter-heading">{bookName} {chapter}</h1>
                <div class="verse-flow" class:verse-per-line={!paragraphMode} class:hide-verse-numbers={!showVerseNumbers} class:dv-off={!showDivergence}>
                    {#each verses as verse}
                        {@const verseRefs = chapterXrefs.get(verse.osisId)}
                        {@const refCount = verseRefs?.length ?? 0}
                        {@const isExpanded = expandedXrefVerses.has(verse.verse)}
                        {@const quotationRefs = verseRefs?.filter(r => r.type === 'quotation' && r.sourceVerse === verse.osisId) ?? []}
                        {@const isQuotationOpen = quotationPopoverVerse === verse.verse}
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <span
                            class="verse"
                            class:selected={pane.selectedVerses.includes(verse.verse)}
                            class:linked-hover={linkedHoverOsis === verse.osisId}
                            data-verse={verse.verse}
                            data-osis={verse.osisId}
                            data-translation={translationId}
                            style={verseStyles[verse.verse] || ''}
                            onmouseenter={onVerseHover ? () => onVerseHover(verse.osisId) : undefined}
                            onmouseleave={onVerseHover ? () => onVerseHover(null) : undefined}
                            ondblclick={handleWordDoubleClick}
                            onclick={(e) => {
                                const mark = (e.target as Element).closest('mark.entity');
                                // Lineage names are tappable even while plainly reading
                                if (mark && mark.classList.contains('lineage')) {
                                    openLineage(mark.getAttribute('data-entity-id') ?? '', verse.verse);
                                    return;
                                }
                                if (mark && showEntities) {
                                    handleEntityMarkClick(
                                        mark.getAttribute('data-entity-id') ?? '',
                                        mark.getAttribute('data-entity-type') as 'person' | 'place' | 'event',
                                        mark.getAttribute('data-entity-name') ?? ''
                                    );
                                    return;
                                }
                                // A shaded divergent word opens the comparison popover
                                const dv = (e.target as Element).closest('.dv');
                                if (dv && onDivergenceClick) {
                                    const rect = dv.getBoundingClientRect();
                                    onDivergenceClick({
                                        osisId: verse.osisId,
                                        verse: verse.verse,
                                        start: Number(dv.getAttribute('data-dv-start')),
                                        end: Number(dv.getAttribute('data-dv-end')),
                                        x: rect.left + rect.width / 2,
                                        y: rect.bottom,
                                    });
                                    return;
                                }
                                // Don't toggle verse selection when clicking xref or quotation rows
                                if ((e.target as Element).closest('.xref-row, .quotation-row')) return;
                                toggleVerseSelection(verse.verse, e);
                            }}
                        >
                            <sup
                                class="verse-num"
                                class:has-note={verseHasNote(verse.verse)}
                                draggable="true"
                                ondragstart={(e) => handleVerseDragStart(e, verse.verse)}
                            >{verse.verseEnd ? `${verse.verse}–${verse.verseEnd}` : verse.verse}</sup>
                            {@html buildVerseHtml(verse, getEntitiesForVerse(verse), parseWjRanges(verse.wj))}
                        </span>
                        {#if showRefs && isExpanded && verseRefs}
                            {@const showAll = fullyExpandedXrefs.has(verse.verse)}
                            {@const displayRefs = showAll ? verseRefs : verseRefs.slice(0, XREF_DISPLAY_LIMIT)}
                            <div class="xref-row">
                                <span class="xref-label">Cross-refs</span>
                                <div class="xref-pills">
                                    {#each displayRefs as ref (ref.id)}
                                        {@const other = otherEnd(ref, verse.osisId)}
                                        <button
                                            class="xref-pill"
                                            use:verseHover={{ osisId: other, translationId }}
                                            onclick={() => handleXrefClick(other)}
                                        >{formatOsisLabel(other)}</button>
                                    {/each}
                                    {#if refCount > XREF_DISPLAY_LIMIT && !showAll}
                                        <button class="xref-more-btn" onclick={() => { const s = new Set(fullyExpandedXrefs); s.add(verse.verse); fullyExpandedXrefs = s; }}>+{refCount - XREF_DISPLAY_LIMIT} more</button>
                                    {:else if refCount > XREF_DISPLAY_LIMIT && showAll}
                                        <button class="xref-more-btn" onclick={() => { const s = new Set(fullyExpandedXrefs); s.delete(verse.verse); fullyExpandedXrefs = s; }}>show fewer</button>
                                    {/if}
                                </div>
                                <a class="xref-graph-link" href="/graph?verse={verse.osisId}" title="View in graph" aria-label="View verse {verse.verse} in the graph">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><circle cx="18" cy="6" r="3" />
                                        <path d="M8.5 8.5l7 7" /><path d="M8.5 6h7" />
                                    </svg>
                                </a>
                            </div>
                        {/if}
                        {#if showRefs && isQuotationOpen && quotationRefs.length > 0}
                            <div class="quotation-row">
                                <span class="quotation-row-label">Quotes</span>
                                <div class="quotation-pills">
                                    {#each quotationRefs as ref (ref.id)}
                                        <span class="quotation-entry">
                                            <button
                                                class="quotation-pill"
                                                use:verseHover={{ osisId: ref.targetVerse, translationId }}
                                                onclick={() => { handleXrefClick(ref.targetVerse); quotationPopoverVerse = null; }}
                                            >{formatOsisLabel(ref.targetVerse)}</button>
                                            {#if onOpenInSplit}
                                                <button
                                                    class="quotation-split-btn"
                                                    title="Open in split pane"
                                                    onclick={(e) => {
                                                        e.stopPropagation();
                                                        const parts = ref.targetVerse.split('.');
                                                        if (parts.length >= 2) onOpenInSplit!(parts[0], parseInt(parts[1], 10));
                                                        quotationPopoverVerse = null;
                                                    }}
                                                >
                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                                        <rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/>
                                                    </svg>
                                                </button>
                                            {/if}
                                        </span>
                                    {/each}
                                </div>
                            </div>
                        {/if}
                        {' '}
                    {/each}
                </div>
                {#if showRefs && gutterMarks.length > 0}
                    <div class="verse-gutter" aria-label="Cross-references">
                        {#each gutterMarks as m (m.verse)}
                            <div class="gutter-slot" style="top: {m.top}px">
                                <button
                                    class="gutter-mark"
                                    class:active={expandedXrefVerses.has(m.verse)}
                                    aria-expanded={expandedXrefVerses.has(m.verse)}
                                    aria-label="{m.refs} cross-reference{m.refs === 1 ? '' : 's'} for verse {m.verse}"
                                    title="{m.refs} cross-reference{m.refs === 1 ? '' : 's'}: hover for the strongest, click for all"
                                    use:verseHover={{ osisId: m.topRef, translationId }}
                                    onclick={() => toggleXrefExpansion(m.verse)}
                                >{m.refs}</button>
                                {#if m.quotes > 0}
                                    <button
                                        class="gutter-mark gutter-quote"
                                        class:active={quotationPopoverVerse === m.verse}
                                        aria-expanded={quotationPopoverVerse === m.verse}
                                        aria-label="Verse {m.verse} quotes earlier scripture ({m.quotes} source{m.quotes === 1 ? '' : 's'})"
                                        title="Quotes earlier scripture ({m.quotes} source{m.quotes === 1 ? '' : 's'})"
                                        onclick={() => { quotationPopoverVerse = quotationPopoverVerse === m.verse ? null : m.verse; }}
                                    ><span class="quotation-icon"></span></button>
                                {/if}
                            </div>
                        {/each}
                    </div>
                {/if}
            </article>
        {/if}
    </div>

    <!-- Study Rail (issue #243): the one right-hand column this pane has -->
    {#if rail.open}
        <StudyRail
            {rail}
            width={railWidth}
            onResize={setRailWidth}
            {entityCount}
            onOpenEntities={openEntitiesTab}
            onOpenAnnotations={onOpenAnnotationSidebar}
        >
            {#snippet content(tab: RailTab)}
                {#if tab.kind === 'entities'}
                    <EntityListPanel
                        persons={enrichment?.persons ?? []}
                        places={enrichment?.places ?? []}
                        events={enrichment?.events ?? []}
                        onEntitySelected={handleEntityListSelected}
                    />
                {:else if tab.kind === 'entity'}
                    {@const p = tab.payload as EntityPayload}
                    {@const inChapter = chapterVerseNumsFor(p.entity)}
                    <EntityDetailPanel
                        entity={p.entity}
                        {bookId}
                        {chapter}
                        chapterVerseNums={inChapter}
                        otherRefCount={p.entity.data.verseRefs.length - inChapter.length}
                        dictEntry={p.dictEntry}
                        {translationId}
                        hasFamilyLinks={p.hasFamily}
                        onScrollToVerse={scrollToVerse}
                        onGenealogyRequested={(id) => ui.openGenealogyTree(id)}
                        onNavigateToRef={(b, c, v) => onNavigateToVerse?.(b, c, v)}
                    />
                {:else if tab.kind === 'lookup'}
                    {@const p = tab.payload as LookupPayload}
                    <div class="word-lookup-panel">
                        {#if p.type === 'dictionary' && p.dictEntry}
                            <div class="dict-definition">
                                <span class="dict-term">{p.dictEntry.term}</span>
                                <DictDefinition
                                    definition={p.dictEntry.definition}
                                    {translationId}
                                    onNavigate={(b, c, v) => onNavigateToVerse?.(b, c, v)}
                                />
                            </div>
                        {:else}
                            <p class="fallback-text">No definition found for this word.</p>
                        {/if}
                        <a class="search-link" href="/search?q={encodeURIComponent(p.word)}">
                            Search "{p.word}" in Bible &rarr;
                        </a>
                    </div>
                {:else if tab.kind === 'lineage'}
                    {@const p = tab.payload as LineagePayload}
                    <LineageRail rootId={p.rootId} onReroot={rerootLineage} />
                {:else}
                    <p class="fallback-text rail-plugin-placeholder">This panel comes from a plugin and has nothing to show yet.</p>
                {/if}
            {/snippet}
        </StudyRail>
    {/if}
</div>

<!-- Floating Selection Toolbar -->
{#if pane.selectedVerses.length > 0}
    <div class="selection-toolbar">
        <span class="selection-count">{pane.selectedVerses.length} verses selected</span>

        <div class="toolbar-divider"></div>

        <div class="color-picker">
            {#each highlightColors as color}
                <button
                    class="color-btn"
                    style="background-color: {color.value}"
                    aria-label="Highlight {color.name}"
                    title="Highlight {color.name}"
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

        <button class="action-btn" onclick={onOpenAnnotationSidebar}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            Note
        </button>

        <button class="action-btn" class:active={themeInputOpen} onclick={openThemeInput} title="Tag with a theme and thread it across the whole Bible">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
            Theme
        </button>

        <button class="action-btn" onclick={copySelection}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Copy
        </button>

        {#if onSendToScratchPad}
            <button class="action-btn" id="scratch-pad-send" title="Quote the selected verses in the scratch pad" onclick={sendSelectionToScratchPad}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9l-5-6z" />
                    <path d="M16 3v6h5" />
                    <path d="M8 13h8M8 17h5" />
                </svg>
                Scratch
            </button>
        {/if}

        <button
            class="action-btn"
            title="Explore this verse's connections in the Scripture Graph"
            onclick={() => goto(`/graph?verse=${bookId}.${chapter}.${pane.selectedVerses[0]}`)}
        >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
                <path d="M8.5 8.5l7 7" /><path d="M15.5 8.5l-7 7" /><path d="M8.5 6h7" /><path d="M6 8.5v7" />
            </svg>
            Graph
        </button>

        <button class="action-btn" onclick={() => pane.selectedVerses = []}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12" />
            </svg>
            Clear
        </button>
    </div>

    {#if themeInputOpen}
        <div class="theme-popover">
            <!-- svelte-ignore a11y_autofocus -->
            <input
                class="theme-input"
                type="text"
                placeholder="Theme, e.g. covenant"
                autofocus
                bind:value={themeInput}
                list="theme-suggestions"
                onkeydown={(e) => {
                    if (e.key === 'Enter') applyTheme();
                    if (e.key === 'Escape') { themeInputOpen = false; themeInput = ''; }
                }}
            />
            <datalist id="theme-suggestions">
                {#each knownThemes as t}
                    <option value={t.label}>{t.count} tagged</option>
                {/each}
            </datalist>
            <button class="theme-apply-btn" onclick={applyTheme} disabled={!themeInput.trim()}>Tag</button>
        </div>
    {/if}
{/if}

<style>
    /* ─── Reader Body (flex row) ─────────────────────── */
    .reader-body {
        display: flex;
        flex: 1;
        overflow: hidden;
        /* The rail overlays this box on phones */
        position: relative;
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
        position: relative;
        max-width: var(--scripture-measure);
        width: 100%;
    }

    .chapter-heading {
        font-family: var(--font-scripture);
        font-size: var(--font-size-display);
        font-weight: 600;
        color: var(--color-text-primary);
        margin-bottom: var(--space-8);
        letter-spacing: -0.01em;
    }

    .verse-flow {
        font-family: var(--font-scripture);
        font-size: var(--scripture-size);
        line-height: var(--scripture-leading);
        color: var(--color-text-primary);
        /* Divergence shading rides a custom property so the toolbar
           toggle flips it with zero re-render */
        --dv-shade: color-mix(in srgb, var(--color-accent) 16%, transparent);
    }
    .verse-flow.dv-off {
        --dv-shade: transparent;
    }
    .verse-flow :global(.dv) {
        background: var(--dv-shade);
        border-radius: var(--radius-xs);
    }
    /* Shaded words are clickable (comparison popover) - hint on hover */
    .verse-flow :global(.dv):hover {
        text-decoration: underline dotted;
        text-underline-offset: 3px;
    }

    .verse {
        transition: background var(--transition-fast);
        border-radius: var(--radius-xs);
        padding: 1px 2px;
        cursor: pointer;
    }
    .verse:hover {
        background: var(--color-accent-subtle);
    }
    /* Cross-pane hover link: the sibling pane's hovered verse, echoed
       here so the eye can match verses across differently-wrapped panes */
    .verse.linked-hover {
        background: var(--color-accent-subtle);
    }
    .verse.selected {
        background: var(--color-accent-subtle) !important;
        outline: 2px solid color-mix(in srgb, var(--color-accent) 40%, transparent);
        outline-offset: 1px;
        border-radius: var(--radius-xs);
    }

    .verse-flow.verse-per-line .verse {
        display: block;
        margin-bottom: 0;
    }
    .verse-flow.verse-per-line .xref-row,
    .verse-flow.verse-per-line .quotation-row {
        margin-bottom: var(--space-2);
    }

    /* ─── Red Letter (Words of Jesus) ──────────────── */
    .verse-flow :global(.wj) {
        color: var(--color-red-letter, #dc2626);
    }

    :global([data-theme="dark"]) .verse-flow :global(.wj) {
        color: var(--color-red-letter-dark, #ef4444);
    }

    .hide-verse-numbers .verse-num {
        display: none;
    }

    .verse-num {
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 600;
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

    /* ─── Cross-reference expanded row ──────────────── */
    .xref-row {
        display: flex;
        align-items: baseline;
        gap: var(--space-2);
        padding: var(--space-1) 0 var(--space-1) 20px;
        animation: xrefSlideIn 0.15s ease-out;
    }
    @keyframes xrefSlideIn {
        from { opacity: 0; transform: translateY(-4px); }
        to   { opacity: 1; transform: translateY(0); }
    }
    .xref-label {
        font-family: var(--font-ui);
        font-size: var(--font-size-2xs);
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--color-text-muted);
        white-space: nowrap;
        flex-shrink: 0;
    }
    .xref-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;
    }
    .xref-pill {
        background: none;
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-pill);
        padding: 1px 8px;
        font-family: var(--font-ui);
        font-size: var(--font-size-2xs);
        color: var(--color-accent);
        cursor: pointer;
        white-space: nowrap;
        transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
    }
    .xref-pill:hover {
        background: var(--color-accent);
        border-color: var(--color-accent);
        color: var(--color-on-accent, #fff);
    }
    .xref-more-btn {
        background: none;
        border: none;
        cursor: pointer;
        font-family: var(--font-ui);
        font-size: var(--font-size-2xs);
        color: var(--color-text-muted);
        white-space: nowrap;
        padding: 1px 4px;
        border-radius: var(--radius-sm);
        transition: color var(--transition-fast), background var(--transition-fast);
    }
    .xref-more-btn:hover {
        color: var(--color-accent);
        background: var(--color-accent-subtle);
    }
    .xref-graph-link {
        display: inline-flex;
        align-items: center;
        padding: 3px;
        color: var(--color-text-muted);
        border-radius: var(--radius-sm);
        transition: color var(--transition-fast), background var(--transition-fast);
        margin-left: auto;
        flex-shrink: 0;
    }
    .xref-graph-link:hover {
        color: var(--color-accent);
        background: var(--color-accent-subtle);
    }

    /* ─── Verse gutter (issue #249) ─────────────────── */
    /* Outside the measure, in the column's side padding; --gutter-w is
       24px with a mouse and 44px on touch. Markers are low contrast until
       hovered, accent when their row is open. */
    .verse-gutter {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 100%;
        width: var(--gutter-w);
        pointer-events: none;
    }
    .gutter-slot {
        position: absolute;
        left: 0;
        right: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        pointer-events: auto;
    }
    .gutter-mark {
        width: 20px;
        height: 20px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
        opacity: 0.55;
        font-family: var(--font-ui);
        font-size: var(--font-size-2xs);
        font-weight: 600;
        line-height: 1;
        cursor: pointer;
        transition: opacity var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
    }
    .gutter-mark:hover,
    .gutter-mark:focus-visible {
        opacity: 1;
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
    }
    .gutter-mark.active {
        opacity: 1;
        color: var(--color-accent);
        background: var(--color-accent-subtle);
    }
    .gutter-quote {
        color: #b45309;
    }
    :global([data-theme="dark"]) .gutter-quote {
        color: #d97706;
    }
    .quotation-icon {
        width: 12px;
        height: 12px;
        background-color: currentColor;
        -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='black'%3E%3Cpath d='M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z'/%3E%3Cpath d='M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z'/%3E%3C/svg%3E") center / 12px 12px no-repeat;
        mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='black'%3E%3Cpath d='M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z'/%3E%3Cpath d='M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z'/%3E%3C/svg%3E") center / 12px 12px no-repeat;
    }
    @media (pointer: coarse), (max-width: 768px) {
        .gutter-mark {
            width: 44px;
            height: 32px;
            opacity: 0.75;
        }
    }

    /* ─── Quotation expanded row ────────────────────── */
    .quotation-row {
        display: flex;
        align-items: baseline;
        gap: var(--space-2);
        padding: var(--space-1) 0 var(--space-1) 20px;
        animation: xrefSlideIn 0.15s ease-out;
    }
    .quotation-row-label {
        font-family: var(--font-ui);
        font-size: var(--font-size-2xs);
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #b45309;
        white-space: nowrap;
        flex-shrink: 0;
    }
    :global([data-theme="dark"]) .quotation-row-label {
        color: #d97706;
    }
    .quotation-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;
    }
    .quotation-entry {
        display: inline-flex;
        align-items: center;
        gap: 2px;
    }
    .quotation-pill {
        background: none;
        border: 1px solid #d97706;
        border-radius: var(--radius-pill);
        padding: 1px 8px;
        font-family: var(--font-ui);
        font-size: var(--font-size-2xs);
        color: #b45309;
        cursor: pointer;
        white-space: nowrap;
        transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
    }
    :global([data-theme="dark"]) .quotation-pill {
        color: #d97706;
        border-color: #92400e;
    }
    .quotation-pill:hover {
        background: #b45309;
        border-color: #b45309;
        color: #fff;
    }
    :global([data-theme="dark"]) .quotation-pill:hover {
        background: #d97706;
        border-color: #d97706;
        color: #000;
    }
    .quotation-split-btn {
        display: inline-flex;
        align-items: center;
        background: none;
        border: none;
        cursor: pointer;
        padding: 2px;
        color: var(--color-text-muted);
        border-radius: var(--radius-sm);
        transition: color var(--transition-fast), background var(--transition-fast);
    }
    .quotation-split-btn:hover {
        color: #b45309;
        background: rgba(180, 83, 9, 0.1);
    }
    :global([data-theme="dark"]) .quotation-split-btn:hover {
        color: #d97706;
        background: rgba(217, 119, 6, 0.15);
    }

    /* ─── Loading State ─────────────────────────────── */
    .reader-loading {
        max-width: var(--scripture-measure);
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
        max-width: var(--scripture-measure);
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
        border-radius: var(--radius-pill);
        box-shadow: var(--shadow-floating);
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
        border-color: var(--color-border-control) !important;
        color: var(--color-text-muted);
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .eraser-btn:hover {
        color: var(--color-danger);
        border-color: var(--color-danger) !important;
    }

    .theme-popover {
        position: fixed;
        bottom: calc(var(--space-6) + 56px);
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: var(--space-2);
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: var(--space-2) var(--space-3);
        box-shadow: var(--shadow-lg);
        z-index: 60;
    }
    .theme-input {
        width: 220px;
        background: var(--color-bg);
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        padding: var(--space-1) var(--space-2);
    }
    .theme-apply-btn {
        background: var(--color-accent);
        border: none;
        border-radius: var(--radius-sm);
        color: var(--color-on-accent, #fff);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 600;
        padding: var(--space-1) var(--space-3);
        cursor: pointer;
    }
    .theme-apply-btn:disabled {
        opacity: 0.5;
        cursor: default;
    }
    .action-btn.active {
        color: var(--color-accent);
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

    /* ─── Word Lookup Panel ────────────────────────── */
    .word-lookup-panel {
        padding: var(--space-4);
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
    }

    .dict-definition {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        font-size: var(--font-size-sm);
    }

    .dict-term {
        font-size: var(--font-size-sm);
        font-weight: 700;
        color: var(--color-accent);
        text-transform: capitalize;
    }

    .fallback-text {
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
    }
    .rail-plugin-placeholder {
        padding: var(--space-4);
    }

    .search-link {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        color: var(--color-accent);
        font-size: var(--font-size-sm);
        font-weight: 500;
        text-decoration: none;
        padding: var(--space-2) var(--space-3);
        background: var(--color-accent-subtle);
        border-radius: var(--radius-sm);
        transition: all var(--transition-fast);
    }
    .search-link:hover {
        background: var(--color-accent);
        color: var(--color-on-accent, #fff);
    }

    /* ─── Mobile ────────────────────────────────────── */
    @media (max-width: 768px) {
        .reader-content {
            padding: var(--space-4) var(--space-4);
        }
        /* Room for the 44px gutter beside a full-width column */
        .reader-content.has-gutter {
            padding-right: calc(var(--space-2) + var(--gutter-w));
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
