<script lang="ts">
    import EntityDetailPanel from '$lib/components/EntityDetailPanel.svelte';
    import EntityListPanel from '$lib/components/EntityListPanel.svelte';
    import type { VerseRecord, Annotation, Person, Place, BibleEvent, DictionaryEntry } from '@codex-scriptura/core';
    import { lookupDictionary } from '@codex-scriptura/db';

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
        enrichment,
        allBookAnnotations,
        highlightColors,
        showVerseNumbers,
        selectedVerses = $bindable([]),
        panelMode = $bindable('none'),
        onSaveAnnotation,
        onDeleteAnnotations,
        onOpenAnnotationSidebar,
    }: {
        verses: VerseRecord[];
        loading: boolean;
        bookId: string;
        bookName: string;
        chapter: number;
        enrichment: { persons: Person[]; places: Place[]; events: BibleEvent[] } | null;
        allBookAnnotations: Annotation[];
        highlightColors: HighlightColor[];
        showVerseNumbers: boolean;
        selectedVerses: number[];
        panelMode: 'none' | 'detail' | 'list';
        onSaveAnnotation: (ann: Annotation) => Promise<void>;
        onDeleteAnnotations: (ids: string[]) => Promise<void>;
        onOpenAnnotationSidebar: () => void;
    } = $props();

    // ─── Internal pane state ──────────────────────────────────
    let lastSelectedVerse: number | null = $state(null);
    let selectedEntity = $state<SelectedEntity | null>(null);
    let entityDictEntry = $state<DictionaryEntry | null>(null);

    // Reset pane-internal state when chapter content changes
    let prevChapterKey = '';
    $effect(() => {
        const key = `${bookId}.${chapter}`;
        if (key !== prevChapterKey) {
            prevChapterKey = key;
            lastSelectedVerse = null;
            selectedEntity = null;
            entityDictEntry = null;
        }
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
        const startV = selectedVerses[0];
        const endV = selectedVerses[selectedVerses.length - 1];

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

    function buildVerseHtml(text: string, entities: EntityRef[]): string {
        if (entities.length === 0) return escapeHtml(text);
        const sorted = [...entities].sort((a, b) => b.name.length - a.name.length);
        const pattern = sorted.map(e => escapeRegex(e.name)).join('|');
        const regex = new RegExp(`(${pattern})`, 'gi');
        const nameMap = new Map(sorted.map(e => [e.name.toLowerCase(), e]));
        let result = '';
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            result += escapeHtml(text.slice(lastIndex, match.index));
            const entity = nameMap.get(match[0].toLowerCase());
            if (entity) {
                result += `<mark class="entity" data-entity-id="${escapeAttr(entity.id)}" data-entity-type="${escapeAttr(entity.type)}" data-entity-name="${escapeAttr(entity.name)}">${escapeHtml(match[0])}</mark>`;
            } else {
                result += escapeHtml(match[0]);
            }
            lastIndex = match.index + match[0].length;
        }
        result += escapeHtml(text.slice(lastIndex));
        return result;
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
                <div class="verse-flow" class:hide-verse-numbers={!showVerseNumbers}>
                    {#each verses as verse}
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <span
                            class="verse"
                            class:selected={selectedVerses.includes(verse.verse)}
                            id="verse-{verse.verse}"
                            style={verseStyles[verse.verse] || ''}
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
                                toggleVerseSelection(verse.verse, e);
                            }}
                        >
                            <sup class="verse-num" class:has-note={verseHasNote(verse.verse)}>{verse.verse}</sup>
                            {@html buildVerseHtml(verse.text, getEntitiesForVerse(verse))}
                        </span>
                        {' '}
                    {/each}
                </div>
            </article>
        {/if}
    </div>

    <!-- Entity panel slot -->
    {#if panelMode !== 'none'}
    <aside class="entity-panel-slot">
        {#if panelMode === 'detail' && selectedEntity}
            <EntityDetailPanel
                entity={selectedEntity}
                chapterVerseNums={chapterVerseNums}
                otherRefCount={otherRefCount}
                dictEntry={entityDictEntry}
                onScrollToVerse={scrollToVerse}
                onClose={closePanel}
                onMapRequested={() => {}}
                onAllVersesRequested={() => {}}
                onGenealogyRequested={(id) => {}}
            />
        {:else if panelMode === 'list'}
            <EntityListPanel
                persons={enrichment?.persons ?? []}
                places={enrichment?.places ?? []}
                events={enrichment?.events ?? []}
                onEntitySelected={handleEntityListSelected}
                onClose={closePanel}
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
        width: 320px;
        flex-shrink: 0;
        border-left: 1px solid var(--color-border);
        background: var(--color-bg-elevated);
        display: flex;
        flex-direction: column;
        height: calc(100vh - var(--header-height));
        overflow: auto;
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
