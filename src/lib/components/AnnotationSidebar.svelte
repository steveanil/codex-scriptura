<script lang="ts">
    import { untrack } from 'svelte';
    import type { Annotation } from '@codex-scriptura/core';
    import { parseOsisId } from '@codex-scriptura/core';
    import { observeAllAnnotations } from '@codex-scriptura/db';
    import { noteContentError } from '$lib/annotations/edit';
    import { ui } from '$lib/stores/ui.svelte';
    import { formatOsisLabel } from '$lib/utils/verse-render';
    import NoteEditor from '$lib/components/annotations/NoteEditor.svelte';
    import AnnotationCard from '$lib/components/annotations/AnnotationCard.svelte';
    import type { HighlightSwatch } from '$lib/components/annotations/HighlightEditor.svelte';

    let {
        isOpen = $bindable(false),
        book,
        chapter,
        selectedVerses,
        bookAnnotations,
        swatches,
        translationId,
        onSaveNote,
        onUpdateAnnotation,
        onDeleteAnnotation,
        onNavigate,
    }: {
        isOpen: boolean;
        book: string;
        chapter: number;
        selectedVerses: number[];
        /** All annotations for the current book */
        bookAnnotations: Annotation[];
        /** Highlight presets, as the verse toolbar shows them. */
        swatches: HighlightSwatch[];
        /** The bound pane's translation: verse numbers for the range pickers. */
        translationId: string;
        /** anchors: explicit OSIS ids (scratch pad promotion); absent = anchor to the pane selection. */
        onSaveNote: (text: string, tags: string[], anchors?: string[]) => Promise<void>;
        /** Writes an edited record (from the edit module) in place. */
        onUpdateAnnotation: (ann: Annotation) => Promise<void>;
        onDeleteAnnotation: (id: string) => Promise<void>;
        onNavigate: (book: string, chapter: number, verse: number) => void;
    } = $props();

    // ── New note draft ────────────────────────────────────
    // Kept here, not in the editor, so it survives closing the sidebar.
    let noteText = $state('');
    let tags = $state<string[]>([]);
    // Explicit OSIS anchors from a scratch pad promotion; while set, the
    // editor targets these instead of the pane's verse selection.
    let prefillAnchors = $state<string[] | null>(null);
    let consumedPrefillRequest = 0;

    // ── Editing an existing card (one at a time) ──────────
    let editingId = $state<string | null>(null);
    let consumedEditRequest = untrack(() => ui.noteEditRequest.request);

    // ── Tab state ─────────────────────────────────────────
    let activeTab = $state<'chapter' | 'all'>('chapter');
    let allAnnotations = $state<Annotation[]>([]);
    let loadingAll = $state(false);

    // ── Chapter annotations (current chapter only) ────────
    let chapterAnnotations = $derived(bookAnnotations.filter((a: Annotation) => {
        const start = parseOsisId(a.verseStart);
        const end = parseOsisId(a.verseEnd);
        if (!start || !end) return false;
        return start.chapter === chapter || (start.chapter <= chapter && end.chapter >= chapter);
    }));

    type Section = { title: string; items: Annotation[] };
    function byType(list: Annotation[], counted: boolean): Section[] {
        const groups: [string, Annotation['type']][] = [['Notes', 'note'], ['Highlights', 'highlight'], ['Themes', 'theme']];
        return groups.map(([title, type]) => {
            const items = list.filter((a) => a.type === type);
            return { title: counted ? `All ${title} (${items.length})` : title, items };
        });
    }
    let sections = $derived(
        (activeTab === 'chapter' ? byType(chapterAnnotations, false) : byType(allAnnotations, true)).filter((s) => s.items.length > 0)
    );

    // Live view while the All tab is visible - deletes and edits of
    // annotations in other books emit here directly (the per-book
    // liveQuery driving bookAnnotations never observes them).
    $effect(() => {
        if (!isOpen || activeTab !== 'all') return;
        const sub = observeAllAnnotations().subscribe({
            next: (anns) => {
                allAnnotations = anns;
                loadingAll = false;
            },
            error: () => {
                loadingAll = false;
            },
        });
        return () => sub.unsubscribe();
    });

    // Reset the draft ONLY when the note's target changes - a different verse
    // selection - never as a side effect of unrelated re-runs like reopening
    // the sidebar over the same selection (issue #181).
    let lastSelectionKey = '';
    $effect(() => {
        const key = `${book}.${chapter}|${selectedVerses.join(',')}`;
        if (key === lastSelectionKey) return;
        lastSelectionKey = key;
        if (prefillAnchors) return; // prefill targets explicit anchors, not the selection
        noteText = '';
        tags = [];
    });

    $effect(() => {
        if (!isOpen) return;
        const prefill = ui.notePrefill;
        if (prefill.request > consumedPrefillRequest) {
            // Scratch pad promotion: consume exactly once (plain
            // counter, so re-runs of this effect never re-apply it).
            consumedPrefillRequest = prefill.request;
            noteText = prefill.text;
            tags = [];
            prefillAnchors = [...prefill.anchors];
            activeTab = 'chapter';
        }
    });

    $effect(() => {
        if (!isOpen) return;
        const req = ui.noteEditRequest;
        if (req.request > consumedEditRequest) {
            consumedEditRequest = req.request;
            activeTab = 'chapter';
            editingId = req.id;
        }
    });

    async function submitNote(): Promise<string | null> {
        const err = noteContentError(noteText, tags);
        if (err) return err;
        await onSaveNote(noteText, $state.snapshot(tags), prefillAnchors ?? undefined);
        noteText = '';
        tags = [];
        prefillAnchors = null;
        return null;
    }

    function closeSidebar() {
        isOpen = false;
        prefillAnchors = null;
        editingId = null;
    }

    function switchTab(tab: 'chapter' | 'all') {
        // Spinner only until the subscription's first emission fills the list
        if (tab === 'all' && allAnnotations.length === 0) loadingAll = true;
        activeTab = tab;
    }

    function navigateToAnnotation(ann: Annotation) {
        const ref = parseOsisId(ann.verseStart);
        if (!ref) return;
        onNavigate(ref.book, ref.chapter, ref.verse);
    }
</script>

{#if isOpen}
    <div class="sidebar-overlay" onclick={closeSidebar} role="presentation"></div>
    <div class="annotation-sidebar" class:open={isOpen}>

        <!-- Header -->
        <div class="sidebar-header">
            <h2>Annotations</h2>
            <button class="close-btn" aria-label="Close sidebar" title="Close" onclick={closeSidebar}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                </svg>
            </button>
        </div>

        <!-- Tabs -->
        <div class="sidebar-tabs">
            <button class="tab-btn" class:active={activeTab === 'chapter'} onclick={() => switchTab('chapter')}>
                This Chapter
            </button>
            <button class="tab-btn" class:active={activeTab === 'all'} onclick={() => switchTab('all')}>
                All Annotations
            </button>
        </div>

        <div class="sidebar-content">

            <!-- New note (only on chapter tab when verses selected) -->
            {#if activeTab === 'chapter' && (prefillAnchors || selectedVerses.length > 0)}
                <NoteEditor bind:text={noteText} bind:tags submitLabel="Save Note" onSubmit={submitNote}>
                    {#snippet header()}
                        {#if prefillAnchors}
                            New note on <strong>{prefillAnchors.map((a: string) => formatOsisLabel(a)).join(', ')}</strong> - from the scratch pad
                        {:else}
                            New note on <strong>{book} {chapter}:{selectedVerses[0]}{selectedVerses.length > 1 ? `–${selectedVerses[selectedVerses.length - 1]}` : ''}</strong>
                        {/if}
                    {/snippet}
                </NoteEditor>
            {/if}

            {#if activeTab === 'all' && loadingAll}
                <div class="loading-state">
                    <div class="mini-spinner"></div>
                    <span>Loading…</span>
                </div>
            {:else if sections.length === 0}
                <p class="empty-state">{activeTab === 'chapter' ? `No annotations in ${book} ${chapter} yet.` : 'No annotations yet.'}</p>
            {:else}
                {#each sections as section (section.title)}
                    <div class="section">
                        <h3 class="section-heading">{section.title}</h3>
                        <div class="annotations-list">
                            {#each section.items as ann (ann.id)}
                                <AnnotationCard
                                    annotation={ann}
                                    fullRef={activeTab === 'all'}
                                    editing={editingId === ann.id}
                                    {swatches}
                                    {translationId}
                                    onNavigate={() => navigateToAnnotation(ann)}
                                    onDelete={() => onDeleteAnnotation(ann.id)}
                                    onEdit={() => (editingId = ann.id)}
                                    onCancelEdit={() => { if (editingId === ann.id) editingId = null; }}
                                    onSave={onUpdateAnnotation}
                                />
                            {/each}
                        </div>
                    </div>
                {/each}
            {/if}

        </div>
    </div>
{/if}

<style>
    .sidebar-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.2);
        z-index: 150;
    }

    .annotation-sidebar {
        position: fixed;
        top: 0;
        right: 0;
        width: 400px;
        max-width: 90vw;
        height: 100vh;
        background: var(--color-bg-elevated);
        border-left: 1px solid var(--color-border);
        box-shadow: var(--shadow-lg);
        z-index: 200;
        display: flex;
        flex-direction: column;
        transform: translateX(100%);
        transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .annotation-sidebar.open {
        transform: translateX(0);
    }

    .sidebar-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-4) var(--space-5);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
    }
    .sidebar-header h2 {
        font-family: var(--font-ui);
        font-size: var(--font-size-lg);
        font-weight: 600;
        color: var(--color-text-primary);
        margin: 0;
    }
    .close-btn {
        background: none;
        border: none;
        color: var(--color-text-secondary);
        cursor: pointer;
        padding: var(--space-1);
        border-radius: var(--radius-sm);
    }
    .close-btn:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }

    /* ── Tabs ── */
    .sidebar-tabs {
        display: flex;
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
    }

    .tab-btn {
        flex: 1;
        padding: var(--space-3) var(--space-4);
        background: none;
        border: none;
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 500;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: all var(--transition-fast);
    }
    .tab-btn:hover { color: var(--color-text-primary); }
    .tab-btn.active {
        color: var(--color-accent);
        border-bottom-color: var(--color-accent);
        font-weight: 600;
    }

    /* ── Content ── */
    .sidebar-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--space-4) var(--space-5);
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
    }

    /* ── Sections ── */
    .section { display: flex; flex-direction: column; gap: var(--space-2); }

    .section + .section {
        border-top: 1px solid var(--color-border);
        padding-top: var(--space-4);
    }

    .empty-state {
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
        font-style: italic;
        text-align: center;
        padding: var(--space-6) 0;
    }

    .loading-state {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
        padding: var(--space-4) 0;
    }

    .mini-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid var(--color-border);
        border-top-color: var(--color-accent);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        flex-shrink: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .annotations-list { display: flex; flex-direction: column; gap: var(--space-2); }
</style>
