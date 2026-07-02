<script lang="ts">
    import { goto } from '$app/navigation';
    import EntityDetailPanel from '$lib/components/EntityDetailPanel.svelte';
    import EntityListPanel from '$lib/components/EntityListPanel.svelte';
    import GenealogyViewer from '$lib/components/GenealogyViewer.svelte';
    import type { VerseRecord, Annotation, Person, Place, BibleEvent, DictionaryEntry, CrossReference } from '@codex-scriptura/core';
    import { findBook } from '@codex-scriptura/core';
    import { lookupDictionary, getCrossReferencesForChapter } from '@codex-scriptura/db';
    import { verseHover } from '$lib/actions/verseHover';
    import { getContiguousGroups } from '$lib/utils/verse-groups';

    type SelectedEntity =
        | { type: 'person'; data: Person }
        | { type: 'place'; data: Place }
        | { type: 'event'; data: BibleEvent };

    type HighlightColor = { name: string; id: string; value: string };

    let {
        verses,
        loading,
        bookId,
        bookName,
        chapter,
        translationId = 'KJV',
        enrichment,
        allBookAnnotations,
        highlightColors,
        showVerseNumbers,
        paragraphMode = false,
        showRedLetters = true,
        selectedVerses = $bindable([]),
        panelMode = $bindable('none'),
        onSaveAnnotation,
        onDeleteAnnotations,
        onOpenAnnotationSidebar,
        onNavigateToVerse,
        onOpenInSplit,
    }: {
        verses: VerseRecord[];
        loading: boolean;
        bookId: string;
        bookName: string;
        chapter: number;
        translationId?: string;
        enrichment: { persons: Person[]; places: Place[]; events: BibleEvent[] } | null;
        allBookAnnotations: Annotation[];
        highlightColors: HighlightColor[];
        showVerseNumbers: boolean;
        paragraphMode?: boolean;
        showRedLetters?: boolean;
        selectedVerses: number[];
        panelMode: 'none' | 'detail' | 'list' | 'genealogy';
        onSaveAnnotation: (ann: Annotation) => Promise<void>;
        onDeleteAnnotations: (ids: string[]) => Promise<void>;
        onOpenAnnotationSidebar: () => void;
        onNavigateToVerse?: (book: string, chapter: number, verse: number) => void;
        onOpenInSplit?: (book: string, chapter: number) => void;
    } = $props();

    // ─── Entity panel width (drag-resizable, persisted) ───────
    const PANEL_WIDTH_KEY = 'codex:entityPanelWidth';
    const PANEL_MIN_WIDTH = 280;
    let panelWidth = $state(loadPanelWidth());
    let isResizingPanel = $state(false);

    function loadPanelWidth(): number {
        if (typeof localStorage === 'undefined') return 320;
        const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
        return Number.isFinite(saved) && saved >= PANEL_MIN_WIDTH ? saved : 320;
    }

    function clampPanelWidth(w: number): number {
        const max = Math.max(PANEL_MIN_WIDTH, Math.round(window.innerWidth * 0.6));
        return Math.min(max, Math.max(PANEL_MIN_WIDTH, w));
    }

    function startPanelResize(e: PointerEvent) {
        e.preventDefault();
        isResizingPanel = true;
        const startX = e.clientX;
        const startWidth = panelWidth;

        function onMove(ev: PointerEvent) {
            // Handle is on the panel's left edge: dragging left grows the panel
            panelWidth = clampPanelWidth(startWidth + (startX - ev.clientX));
        }
        function onUp() {
            isResizingPanel = false;
            localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth));
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }

    // ─── Internal pane state ──────────────────────────────────
    let lastSelectedVerse: number | null = $state(null);
    let selectedEntity = $state<SelectedEntity | null>(null);
    let entityDictEntry = $state<DictionaryEntry | null>(null);
    let wordLookupResult = $state<{
        word: string;
        dictEntry?: DictionaryEntry;
        type: 'dictionary' | 'fallback';
    } | null>(null);

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

    /** Format an OSIS verse ID ("Gen.1.1") into a compact display label ("Gen 1:1") */
    function formatOsisLabel(osisId: string): string {
        const parts = osisId.split('.');
        if (parts.length === 3) {
            const book = findBook(parts[0]);
            return `${book?.abbrev ?? parts[0]} ${parts[1]}:${parts[2]}`;
        }
        if (parts.length === 2) return `${parts[0]} ${parts[1]}`;
        return osisId;
    }

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
        const parts = osisId.split('.');
        if (parts.length < 3 || !onNavigateToVerse) return;
        const book = parts[0];
        const ch = parseInt(parts[1], 10);
        const v = parseInt(parts[2], 10);
        if (!isNaN(ch) && !isNaN(v)) {
            onNavigateToVerse(book, ch, v);
        }
    }

    // Reset pane-internal state when chapter content changes
    let prevChapterKey = '';
    $effect(() => {
        const key = `${bookId}.${chapter}`;
        if (key !== prevChapterKey) {
            prevChapterKey = key;
            lastSelectedVerse = null;
            selectedEntity = null;
            entityDictEntry = null;
            wordLookupResult = null;
            expandedXrefVerses = new Set();
            fullyExpandedXrefs = new Set();
            quotationPopoverVerse = null;
        }
    });

    // Load cross-references for the chapter in a single batch call
    $effect(() => {
        const b = bookId;
        const ch = chapter;
        let active = true;
        getCrossReferencesForChapter(b, ch).then(map => {
            if (active) chapterXrefs = map;
        });
        return () => { active = false; };
    });

    // ─── Exported methods for parent orchestration ────────────
    export function flashVerse(verseNum: number | string) {
        const el = document.getElementById(`verse-${verseNum}`);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.remove('verse-flash');
        void el.offsetWidth;
        el.classList.add('verse-flash');
        el.addEventListener('animationend', () => el.classList.remove('verse-flash'), { once: true });
    }

    // ─── Verse highlighting derivations ───────────────────────
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
            const highlights = allBookAnnotations.filter(a => a.type === 'highlight' && isVerseInAnnotation(chapter, v.verse, a));
            if (highlights.length > 0) {
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
        return versesWithNotes.some(a => isVerseInAnnotation(chapter, v, a));
    }

    // ─── Verse selection ──────────────────────────────────────
    function toggleVerseSelection(v: number, event?: MouseEvent) {
        if (event?.shiftKey && lastSelectedVerse !== null) {
            const min = Math.min(lastSelectedVerse, v);
            const max = Math.max(lastSelectedVerse, v);
            const range: number[] = [];
            for (let i = min; i <= max; i++) range.push(i);
            const merged = new Set([...selectedVerses, ...range]);
            selectedVerses = Array.from(merged).sort((a, b) => a - b);
        } else if (selectedVerses.includes(v)) {
            selectedVerses = selectedVerses.filter(num => num !== v);
        } else {
            selectedVerses = [...selectedVerses, v].sort((a, b) => a - b);
        }
        lastSelectedVerse = v;
    }

    // ─── Annotation actions ───────────────────────────────────

    async function applyHighlight(colorValue: string) {
        if (selectedVerses.length === 0) return;

        // Create one annotation per contiguous group to avoid
        // spanning unselected intermediate verses.
        const groups = getContiguousGroups(selectedVerses);
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
                tags: [],
                created: Date.now(),
                modified: Date.now(),
                synced: false
            };
            await onSaveAnnotation(ann);
        }
        selectedVerses = [];
    }

    async function removeHighlightsOnSelection() {
        if (selectedVerses.length === 0) return;
        const toDelete = allBookAnnotations.filter(a =>
            a.type === 'highlight' &&
            selectedVerses.some(v => isVerseInAnnotation(chapter, v, a))
        );
        if (toDelete.length > 0) {
            await onDeleteAnnotations(toDelete.map(a => a.id));
        }
        selectedVerses = [];
    }

    // ─── Entity panel ─────────────────────────────────────────
    let chapterVerseNums = $derived.by(() => {
        if (!selectedEntity) return [] as number[];
        const prefix = `${bookId}.${chapter}.`;
        return selectedEntity.data.verseRefs
            .filter(r => r.startsWith(prefix))
            .map(r => parseInt(r.split('.')[2], 10))
            .filter(n => !isNaN(n))
            .sort((a, b) => a - b);
    });

    let otherRefCount = $derived(
        selectedEntity ? selectedEntity.data.verseRefs.length - chapterVerseNums.length : 0
    );

    async function selectEntity(type: 'person' | 'place' | 'event', data: Person | Place | BibleEvent) {
        if (selectedEntity?.data.id === data.id) {
            selectedEntity = null;
            entityDictEntry = null;
            panelMode = 'none';
            return;
        }
        selectedEntity = { type, data } as SelectedEntity;
        wordLookupResult = null;
        panelMode = 'detail';
        entityDictEntry = null;
        if (!data.description) {
            const entry = await lookupDictionary(data.name);
            if (selectedEntity?.data.id === data.id) {
                entityDictEntry = entry ?? null;
            }
        }
    }

    function closePanel() {
        selectedEntity = null;
        entityDictEntry = null;
        wordLookupResult = null;
        panelMode = 'none';
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

    // ─── Inline entity highlighting helpers ───────────────────
    function escapeHtml(s: string): string {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function escapeAttr(s: string): string {
        return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function escapeRegex(s: string): string {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    type EntityRef = { id: string; type: 'person' | 'place' | 'event'; name: string };

    function getEntitiesForVerse(verse: VerseRecord): EntityRef[] {
        if (!enrichment) return [];
        const ref = verse.osisId;
        const result: EntityRef[] = [];
        for (const p of enrichment.persons) {
            if (p.verseRefs.includes(ref)) result.push({ id: p.id, type: 'person', name: p.name });
        }
        for (const p of enrichment.places) {
            if (p.verseRefs.includes(ref)) result.push({ id: p.id, type: 'place', name: p.name });
        }
        for (const e of enrichment.events) {
            if (e.verseRefs.includes(ref)) result.push({ id: e.id, type: 'event', name: e.name });
        }
        return result;
    }

    /**
     * Parse wj JSON and return an array of [start, end] ranges, or empty array.
     */
    function parseWjRanges(wjJson?: string): number[][] {
        if (!wjJson) return [];
        try {
            const ranges: number[][] = JSON.parse(wjJson);
            return Array.isArray(ranges) ? ranges : [];
        } catch {
            return [];
        }
    }

    /**
     * Wrap portions of escaped HTML in <span class="wj"> based on character offset
     * ranges from the original plain text. This must be called on segments that are
     * simple escaped text (no nested HTML tags) — i.e. the non-entity pieces.
     *
     * @param escapedHtml  The HTML-escaped string for a plain-text slice
     * @param plainStart   The start offset of this slice in the original plain text
     * @param plainEnd     The end offset of this slice in the original plain text
     * @param wjRanges     Sorted [start, end] ranges marking words of Jesus in the full verse text
     */
    function wrapWjInEscapedSegment(escapedHtml: string, plainStart: number, plainEnd: number, wjRanges: number[][]): string {
        // Find which wj ranges overlap with [plainStart, plainEnd)
        const overlapping: number[][] = [];
        for (const [ws, we] of wjRanges) {
            const overlapStart = Math.max(ws, plainStart);
            const overlapEnd = Math.min(we, plainEnd);
            if (overlapStart < overlapEnd) {
                overlapping.push([overlapStart - plainStart, overlapEnd - plainStart]);
            }
        }

        if (overlapping.length === 0) return escapedHtml;

        // Now we need to insert <span class="wj"> at the right positions in the escaped HTML.
        // Build a mapping from plain-text char index (relative) to escaped-HTML char index.
        const plainToEscaped: number[] = [];
        let pi = 0;
        let ei = 0;
        while (ei < escapedHtml.length && pi <= (plainEnd - plainStart)) {
            plainToEscaped[pi] = ei;
            if (escapedHtml.startsWith('&amp;', ei)) { ei += 5; pi++; }
            else if (escapedHtml.startsWith('&lt;', ei)) { ei += 4; pi++; }
            else if (escapedHtml.startsWith('&gt;', ei)) { ei += 4; pi++; }
            else if (escapedHtml.startsWith('&quot;', ei)) { ei += 6; pi++; }
            else { ei++; pi++; }
        }
        plainToEscaped[pi] = ei; // sentinel for end

        let result = '';
        let lastEi = 0;
        for (const [rs, re] of overlapping) {
            const eStart = plainToEscaped[rs] ?? lastEi;
            const eEnd = plainToEscaped[re] ?? escapedHtml.length;
            result += escapedHtml.slice(lastEi, eStart);
            result += `<span class="wj">${escapedHtml.slice(eStart, eEnd)}</span>`;
            lastEi = eEnd;
        }
        result += escapedHtml.slice(lastEi);
        return result;
    }

    function buildVerseHtml(text: string, entities: EntityRef[], wjRanges?: number[][]): string {
        const applyWj = showRedLetters && wjRanges && wjRanges.length > 0;

        if (entities.length === 0) {
            const escaped = escapeHtml(text);
            if (applyWj) return wrapWjInEscapedSegment(escaped, 0, text.length, wjRanges);
            return escaped;
        }

        const sorted = [...entities].sort((a, b) => b.name.length - a.name.length);
        const pattern = sorted.map(e => escapeRegex(e.name)).join('|');
        const regex = new RegExp(`(${pattern})`, 'gi');
        const nameMap = new Map(sorted.map(e => [e.name.toLowerCase(), e]));
        let result = '';
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            // Non-entity segment before this match
            const segEscaped = escapeHtml(text.slice(lastIndex, match.index));
            if (applyWj) {
                result += wrapWjInEscapedSegment(segEscaped, lastIndex, match.index, wjRanges);
            } else {
                result += segEscaped;
            }

            const entity = nameMap.get(match[0].toLowerCase());
            if (entity) {
                // Entity mark — check if it's inside a wj range
                const matchStart = match.index;
                const matchEnd = match.index + match[0].length;
                const inWj = applyWj && wjRanges.some(([ws, we]) => ws <= matchStart && we >= matchEnd);
                const markHtml = `<mark class="entity${inWj ? ' wj' : ''}" data-entity-id="${escapeAttr(entity.id)}" data-entity-type="${escapeAttr(entity.type)}" data-entity-name="${escapeAttr(entity.name)}">${escapeHtml(match[0])}</mark>`;
                result += markHtml;
            } else {
                const escaped = escapeHtml(match[0]);
                if (applyWj) {
                    result += wrapWjInEscapedSegment(escaped, match.index, match.index + match[0].length, wjRanges);
                } else {
                    result += escaped;
                }
            }
            lastIndex = match.index + match[0].length;
        }
        // Trailing segment
        const tailEscaped = escapeHtml(text.slice(lastIndex));
        if (applyWj) {
            result += wrapWjInEscapedSegment(tailEscaped, lastIndex, text.length, wjRanges);
        } else {
            result += tailEscaped;
        }
        return result;
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

        if (dictEntryNorm) {
            wordLookupResult = { word, dictEntry: dictEntryNorm, type: 'dictionary' };
            selectedEntity = null;
            entityDictEntry = null;
            panelMode = 'detail';
            return;
        }

        // 3. Fallback
        wordLookupResult = { word, type: 'fallback' };
        selectedEntity = null;
        entityDictEntry = null;
        panelMode = 'detail';
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
    <div class="reader-content">
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
            <article class="scripture-text" class:show-entities={panelMode !== 'none'}>
                <h1 class="chapter-heading">{bookName} {chapter}</h1>
                <div class="verse-flow" class:verse-per-line={!paragraphMode} class:hide-verse-numbers={!showVerseNumbers}>
                    {#each verses as verse}
                        {@const verseRefs = chapterXrefs.get(verse.osisId)}
                        {@const refCount = verseRefs?.length ?? 0}
                        {@const isExpanded = expandedXrefVerses.has(verse.verse)}
                        {@const quotationRefs = verseRefs?.filter(r => r.type === 'quotation') ?? []}
                        {@const isQuotationOpen = quotationPopoverVerse === verse.verse}
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <span
                            class="verse"
                            class:selected={selectedVerses.includes(verse.verse)}
                            id="verse-{verse.verse}"
                            data-osis="{bookId}.{chapter}.{verse.verse}"
                            data-translation={translationId}
                            style={verseStyles[verse.verse] || ''}
                            ondblclick={handleWordDoubleClick}
                            onclick={(e) => {
                                const mark = (e.target as Element).closest('mark.entity');
                                if (mark && panelMode !== 'none') {
                                    handleEntityMarkClick(
                                        mark.getAttribute('data-entity-id') ?? '',
                                        mark.getAttribute('data-entity-type') as 'person' | 'place' | 'event',
                                        mark.getAttribute('data-entity-name') ?? ''
                                    );
                                    return;
                                }
                                // Don't toggle verse selection when clicking xref or quotation elements
                                if ((e.target as Element).closest('.xref-indicator, .xref-row, .quotation-badge, .quotation-row')) return;
                                toggleVerseSelection(verse.verse, e);
                            }}
                        >
                            <sup class="verse-num" class:has-note={verseHasNote(verse.verse)}>{verse.verse}</sup>
                            {@html buildVerseHtml(verse.text, getEntitiesForVerse(verse), parseWjRanges(verse.wj))}
                            {#if refCount > 0}
                                <button
                                    class="xref-indicator"
                                    class:xref-active={isExpanded}
                                    title="{refCount} cross-reference{refCount === 1 ? '' : 's'}"
                                    onclick={(e) => { e.stopPropagation(); toggleXrefExpansion(verse.verse); }}
                                >
                                    <svg class="xref-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                        <polyline points="15 3 21 3 21 9" />
                                        <line x1="10" y1="14" x2="21" y2="3" />
                                    </svg>
                                    <span class="xref-count">{refCount}</span>
                                </button>
                            {/if}
                            {#if quotationRefs.length > 0}
                                <button
                                    class="quotation-badge"
                                    class:quotation-active={isQuotationOpen}
                                    title="This verse quotes earlier scripture ({quotationRefs.length} source{quotationRefs.length === 1 ? '' : 's'})"
                                    onclick={(e) => { e.stopPropagation(); quotationPopoverVerse = isQuotationOpen ? null : verse.verse; }}
                                >
                                    <svg class="quotation-icon" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                                        <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>
                                        <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>
                                    </svg>
                                    {#if quotationRefs.length > 1}<span class="quotation-count">{quotationRefs.length}</span>{/if}
                                </button>
                            {/if}
                        </span>
                        {#if isExpanded && verseRefs}
                            {@const showAll = fullyExpandedXrefs.has(verse.verse)}
                            {@const displayRefs = showAll ? verseRefs : verseRefs.slice(0, XREF_DISPLAY_LIMIT)}
                            <div class="xref-row">
                                <span class="xref-label">Cross-refs</span>
                                <div class="xref-pills">
                                    {#each displayRefs as ref (ref.id)}
                                        <button
                                            class="xref-pill"
                                            use:verseHover={{ osisId: ref.targetVerse, translationId }}
                                            onclick={() => handleXrefClick(ref.targetVerse)}
                                        >{formatOsisLabel(ref.targetVerse)}</button>
                                    {/each}
                                    {#if refCount > XREF_DISPLAY_LIMIT && !showAll}
                                        <button class="xref-more-btn" onclick={() => { const s = new Set(fullyExpandedXrefs); s.add(verse.verse); fullyExpandedXrefs = s; }}>+{refCount - XREF_DISPLAY_LIMIT} more</button>
                                    {:else if refCount > XREF_DISPLAY_LIMIT && showAll}
                                        <button class="xref-more-btn" onclick={() => { const s = new Set(fullyExpandedXrefs); s.delete(verse.verse); fullyExpandedXrefs = s; }}>show fewer</button>
                                    {/if}
                                </div>
                                <a class="xref-graph-link" href="/graph?verse={verse.osisId}" title="View in graph">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><circle cx="18" cy="6" r="3" />
                                        <path d="M8.5 8.5l7 7" /><path d="M8.5 6h7" />
                                    </svg>
                                </a>
                            </div>
                        {/if}
                        {#if isQuotationOpen && quotationRefs.length > 0}
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
            </article>
        {/if}
    </div>

    <!-- Entity panel slot -->
    {#if panelMode !== 'none'}
    <aside class="entity-panel-slot" class:resizing={isResizingPanel} style="width: {panelWidth}px">
        <div
            class="panel-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            title="Drag to resize"
            onpointerdown={startPanelResize}
        ></div>
        {#if panelMode === 'detail' && selectedEntity}
            <EntityDetailPanel
                entity={selectedEntity}
                {bookId}
                {chapter}
                chapterVerseNums={chapterVerseNums}
                otherRefCount={otherRefCount}
                dictEntry={entityDictEntry}
                onScrollToVerse={scrollToVerse}
                onClose={closePanel}
                onMapRequested={() => {}}
                onAllVersesRequested={() => {}}
                onGenealogyRequested={(id) => { panelMode = 'genealogy'; }}
            />
        {:else if panelMode === 'detail' && wordLookupResult}
            <div class="word-lookup-panel">
                <div class="wl-panel-header">
                    <h3 class="wl-panel-title">"{wordLookupResult.word}"</h3>
                    <button class="wl-panel-close" aria-label="Close panel" onclick={closePanel}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {#if wordLookupResult.type === 'dictionary' && wordLookupResult.dictEntry}
                    <div class="dict-definition">
                        <span class="dict-term">{wordLookupResult.dictEntry.term}</span>
                        <p class="dict-text">{wordLookupResult.dictEntry.definition}</p>
                    </div>
                {:else}
                    <p class="fallback-text">No definition found for this word.</p>
                {/if}

                <a class="search-link" href="/search?q={encodeURIComponent(wordLookupResult.word)}">
                    Search "{wordLookupResult.word}" in Bible &rarr;
                </a>
            </div>
        {:else if panelMode === 'list'}
            <EntityListPanel
                persons={enrichment?.persons ?? []}
                places={enrichment?.places ?? []}
                events={enrichment?.events ?? []}
                onEntitySelected={handleEntityListSelected}
                onClose={closePanel}
            />
        {:else if panelMode === 'genealogy'}
            <GenealogyViewer
                seedPersonId={selectedEntity?.data?.id ?? ''}
                onClose={() => panelMode = 'detail'}
            />
        {/if}
    </aside>
    {/if}
</div>

<!-- Floating Selection Toolbar -->
{#if selectedVerses.length > 0}
    <div class="selection-toolbar">
        <span class="selection-count">{selectedVerses.length} verses selected</span>

        <div class="toolbar-divider"></div>

        <div class="color-picker">
            {#each highlightColors as color}
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

        <button class="action-btn" onclick={onOpenAnnotationSidebar}>
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

        <button
            class="action-btn"
            title="Explore this verse's connections in the Scripture Graph"
            onclick={() => goto(`/graph?verse=${bookId}.${chapter}.${selectedVerses[0]}`)}
        >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
                <path d="M8.5 8.5l7 7" /><path d="M15.5 8.5l-7 7" /><path d="M8.5 6h7" /><path d="M6 8.5v7" />
            </svg>
            Graph
        </button>

        <button class="action-btn" onclick={() => selectedVerses = []}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12" />
            </svg>
            Clear
        </button>
    </div>
{/if}

<style>
    /* ─── Reader Body (flex row) ─────────────────────── */
    .reader-body {
        display: flex;
        flex: 1;
        overflow: hidden;
    }

    /* ─── Entity Panel Slot ──────────────────────────── */
    .entity-panel-slot {
        flex-shrink: 0;
        border-left: 1px solid var(--color-border);
        background: var(--color-bg-elevated);
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
        position: relative;
        max-width: 60vw;
    }
    .entity-panel-slot.resizing {
        user-select: none;
    }

    .panel-resize-handle {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        width: 6px;
        cursor: col-resize;
        z-index: 5;
        touch-action: none;
    }
    .panel-resize-handle:hover,
    .entity-panel-slot.resizing .panel-resize-handle {
        background: var(--color-accent-subtle);
        box-shadow: inset 2px 0 0 var(--color-accent);
    }

    /* ─── Scripture Content ─────────────────────────── */
    .reader-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--reader-content-padding, var(--space-8)) var(--space-6);
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
        font-size: var(--font-reader-size, var(--font-size-lg));
        line-height: var(--reader-line-height, 2);
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

    .verse-flow.verse-per-line .verse {
        display: block;
        margin-bottom: var(--space-1);
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

    /* ─── Cross-reference indicator ─────────────────── */
    .xref-indicator {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        background: none;
        border: none;
        cursor: pointer;
        padding: 0 2px;
        margin-left: 2px;
        vertical-align: super;
        line-height: 1;
        color: var(--color-text-muted);
        opacity: 0.55;
        transition: opacity var(--transition-fast), color var(--transition-fast);
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: 600;
    }
    .xref-indicator:hover,
    .xref-indicator.xref-active {
        opacity: 1;
        color: var(--color-accent);
    }
    .xref-icon {
        width: 10px;
        height: 10px;
    }
    .xref-count {
        font-size: 9px;
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
        font-size: 10px;
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
        border: 1px solid var(--color-border);
        border-radius: 9999px;
        padding: 1px 8px;
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--color-accent);
        cursor: pointer;
        white-space: nowrap;
        transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
    }
    .xref-pill:hover {
        background: var(--color-accent);
        border-color: var(--color-accent);
        color: #fff;
    }
    .xref-more-btn {
        background: none;
        border: none;
        cursor: pointer;
        font-family: var(--font-ui);
        font-size: 10px;
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

    /* ─── Quotation badge (inline indicator) ────────── */
    .quotation-badge {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        background: none;
        border: none;
        cursor: pointer;
        padding: 0 2px;
        margin-left: 3px;
        vertical-align: super;
        line-height: 1;
        color: #b45309;
        opacity: 0.7;
        transition: opacity var(--transition-fast), color var(--transition-fast);
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: 600;
    }
    :global([data-theme="dark"]) .quotation-badge {
        color: #d97706;
    }
    .quotation-badge:hover,
    .quotation-badge.quotation-active {
        opacity: 1;
    }
    .quotation-icon {
        width: 10px;
        height: 10px;
    }
    .quotation-count {
        font-size: 9px;
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
        font-size: 10px;
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
        border-radius: 9999px;
        padding: 1px 8px;
        font-family: var(--font-ui);
        font-size: 11px;
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

    /* ─── Word Lookup Panel ────────────────────────── */
    .word-lookup-panel {
        padding: var(--space-4);
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
    }

    .wl-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .wl-panel-title {
        font-family: var(--font-ui);
        font-size: var(--font-size-lg);
        font-weight: 600;
        color: var(--color-text-primary);
    }

    .wl-panel-close {
        background: none;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        padding: var(--space-1);
        border-radius: var(--radius-sm);
    }
    .wl-panel-close:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
    }

    .dict-definition {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .dict-term {
        font-size: var(--font-size-sm);
        font-weight: 700;
        color: var(--color-accent);
        text-transform: capitalize;
    }

    .dict-text {
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
        line-height: 1.6;
    }

    .fallback-text {
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
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
        color: white;
    }

    /* ─── Mobile ────────────────────────────────────── */
    @media (max-width: 768px) {
        .reader-content {
            padding: var(--space-4) var(--space-4);
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
