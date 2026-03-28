<script lang="ts">
    import type { Annotation, Tag } from '@codex-scriptura/core';
    import { findBook } from '@codex-scriptura/core';
    import { getTags, saveTag, getAllAnnotations } from '@codex-scriptura/db';
    import { onMount } from 'svelte';

    let {
        isOpen = $bindable(false),
        book,
        chapter,
        selectedVerses,
        bookAnnotations,
        onSaveNote,
        onDeleteAnnotation,
        onNavigate,
    } = $props<{
        isOpen: boolean;
        book: string;
        chapter: number;
        selectedVerses: number[];
        /** All annotations for the current book */
        bookAnnotations: Annotation[];
        onSaveNote: (text: string, tags: string[]) => Promise<void>;
        onDeleteAnnotation: (id: string) => Promise<void>;
        onNavigate: (book: string, chapter: number, verse: number) => void;
    }>();

    // ── Note editor state ─────────────────────────────────
    let noteText = $state('');
    let tags = $state<string[]>([]);
    let availableTags = $state<Tag[]>([]);
    let newTagInput = $state('');

    // ── Tab state ─────────────────────────────────────────
    let activeTab = $state<'chapter' | 'all'>('chapter');
    let allAnnotations = $state<Annotation[]>([]);
    let loadingAll = $state(false);

    // ── Chapter annotations (current chapter only) ────────
    let chapterAnnotations = $derived(bookAnnotations.filter((a: Annotation) => {
        const startCh = parseInt(a.verseStart.split('.')[1] ?? '0', 10);
        const endCh = parseInt(a.verseEnd.split('.')[1] ?? '0', 10);
        return startCh === chapter || (startCh <= chapter && endCh >= chapter);
    }));

    let chapterNotes = $derived(chapterAnnotations.filter((a: Annotation) => a.type === 'note'));
    let chapterHighlights = $derived(chapterAnnotations.filter((a: Annotation) => a.type === 'highlight'));

    // ── All annotations tab ───────────────────────────────
    let allNotes = $derived(allAnnotations.filter(a => a.type === 'note'));
    let allHighlights = $derived(allAnnotations.filter(a => a.type === 'highlight'));

    async function loadAllAnnotations() {
        loadingAll = true;
        allAnnotations = await getAllAnnotations();
        loadingAll = false;
    }

    // ── Tag helpers ───────────────────────────────────────
    async function loadTags() {
        availableTags = await getTags();
    }

    onMount(() => {
        if (isOpen) loadTags();
    });

    $effect(() => {
        if (isOpen) {
            loadTags();
            if (selectedVerses.length > 0) {
                noteText = '';
                tags = [];
            }
            if (activeTab === 'all' && allAnnotations.length === 0) {
                loadAllAnnotations();
            }
        }
    });

    // Refresh allAnnotations when bookAnnotations change (after delete/add)
    $effect(() => {
        // Depend on bookAnnotations length so we refresh after mutations
        void bookAnnotations.length;
        if (activeTab === 'all') loadAllAnnotations();
    });

    async function handleAddTag() {
        const t = newTagInput.trim().toLowerCase();
        if (!t) return;
        if (!tags.includes(t)) tags = [...tags, t];
        if (!availableTags.find(x => x.name === t)) {
            const newTag: Tag = { id: crypto.randomUUID(), name: t, color: '#3f3f46' };
            await saveTag(newTag);
            await loadTags();
        }
        newTagInput = '';
    }

    function removeTag(t: string) {
        tags = tags.filter(x => x !== t);
    }

    async function submitNote() {
        if (!noteText.trim() && tags.length === 0) return;
        await onSaveNote(noteText, tags);
        noteText = '';
        tags = [];
    }

    function closeSidebar() {
        isOpen = false;
    }

    function switchTab(tab: 'chapter' | 'all') {
        activeTab = tab;
        if (tab === 'all' && allAnnotations.length === 0) loadAllAnnotations();
    }

    // ── Helpers ───────────────────────────────────────────
    function getVerseRef(ann: Annotation): string {
        const parts = ann.verseStart.split('.');
        const endParts = ann.verseEnd.split('.');
        const sv = parts[2] ?? '?';
        const ev = endParts[2] ?? '?';
        return sv === ev ? `v${sv}` : `v${sv}–${ev}`;
    }

    function getChapterRef(ann: Annotation): string {
        const parts = ann.verseStart.split('.');
        const bookMeta = findBook(parts[0]);
        return `${bookMeta?.name ?? parts[0]} ${parts[1]}:${parts[2]}`;
    }

    function navigateToAnnotation(ann: Annotation) {
        const parts = ann.verseStart.split('.');
        const annBook = parts[0];
        const annChapter = parseInt(parts[1] ?? '1', 10);
        const annVerse = parseInt(parts[2] ?? '1', 10);
        onNavigate(annBook, annChapter, annVerse);
    }
</script>

{#if isOpen}
    <div class="sidebar-overlay" onclick={closeSidebar} role="presentation"></div>
    <div class="annotation-sidebar" class:open={isOpen}>

        <!-- Header -->
        <div class="sidebar-header">
            <h2>Annotations</h2>
            <button class="close-btn" aria-label="Close sidebar" onclick={closeSidebar}>
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

            <!-- Note Editor (only on chapter tab when verses selected) -->
            {#if activeTab === 'chapter' && selectedVerses.length > 0}
                <div class="note-editor">
                    <div class="selection-indicator">
                        New note on <strong>{book} {chapter}:{selectedVerses[0]}{selectedVerses.length > 1 ? `–${selectedVerses[selectedVerses.length - 1]}` : ''}</strong>
                    </div>

                    <textarea
                        class="note-textarea"
                        placeholder="Write your thoughts…"
                        bind:value={noteText}
                    ></textarea>

                    <div class="tag-manager">
                        <div class="tag-input-group">
                            <span class="hash">#</span>
                            <input
                                type="text"
                                placeholder="Add tag (press Enter)"
                                bind:value={newTagInput}
                                onkeydown={(e) => e.key === 'Enter' && handleAddTag()}
                            />
                            <button class="add-tag-btn" onclick={handleAddTag} title="Add tag">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <line x1="12" y1="5" x2="12" y2="19"></line>
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
                                </svg>
                                Add
                            </button>
                        </div>
                        {#if tags.length > 0}
                            <div class="active-tags">
                                {#each tags as t}
                                    <span class="tag-pill">
                                        {t}
                                        <button class="remove-tag" onclick={() => removeTag(t)}>×</button>
                                    </span>
                                {/each}
                            </div>
                        {/if}
                    </div>

                    <div class="editor-actions">
                        <button class="btn btn-primary" onclick={submitNote}>Save Note</button>
                    </div>
                </div>
            {/if}

            <!-- ── This Chapter Tab ── -->
            {#if activeTab === 'chapter'}
                {#if chapterNotes.length === 0 && chapterHighlights.length === 0}
                    <p class="empty-state">No annotations in {book} {chapter} yet.</p>
                {:else}
                    {#if chapterNotes.length > 0}
                        <div class="section">
                            <h3 class="section-title">Notes</h3>
                            <div class="annotations-list">
                                {#each chapterNotes as note}
                                    <div class="annotation-card">
                                        <div class="card-header">
                                            <button class="verse-ref-btn" onclick={() => navigateToAnnotation(note)} title="Jump to verse">
                                                {getVerseRef(note)} ↗
                                            </button>
                                            <button class="delete-btn" onclick={() => onDeleteAnnotation(note.id)} title="Delete note">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                                                </svg>
                                            </button>
                                        </div>
                                        <div class="note-body">{note.data}</div>
                                        {#if note.tags && note.tags.length > 0}
                                            <div class="note-tags">
                                                {#each note.tags as t}
                                                    <span class="tag-pill sm">#{t}</span>
                                                {/each}
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        </div>
                    {/if}

                    {#if chapterHighlights.length > 0}
                        <div class="section">
                            <h3 class="section-title">Highlights</h3>
                            <div class="annotations-list">
                                {#each chapterHighlights as hl}
                                    <div class="annotation-card highlight-card">
                                        <div class="card-header">
                                            <div class="highlight-ref">
                                                <span class="color-swatch" style="background:{hl.color}"></span>
                                                <button class="verse-ref-btn" onclick={() => navigateToAnnotation(hl)} title="Jump to verse">
                                                    {getVerseRef(hl)} ↗
                                                </button>
                                            </div>
                                            <button class="delete-btn" onclick={() => onDeleteAnnotation(hl.id)} title="Remove highlight">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        </div>
                    {/if}
                {/if}

            <!-- ── All Annotations Tab ── -->
            {:else}
                {#if loadingAll}
                    <div class="loading-state">
                        <div class="mini-spinner"></div>
                        <span>Loading…</span>
                    </div>
                {:else if allNotes.length === 0 && allHighlights.length === 0}
                    <p class="empty-state">No annotations yet.</p>
                {:else}
                    {#if allNotes.length > 0}
                        <div class="section">
                            <h3 class="section-title">All Notes ({allNotes.length})</h3>
                            <div class="annotations-list">
                                {#each allNotes as note}
                                    <div class="annotation-card">
                                        <div class="card-header">
                                            <button class="verse-ref-btn full-ref" onclick={() => navigateToAnnotation(note)} title="Jump to verse">
                                                {getChapterRef(note)} ↗
                                            </button>
                                            <button class="delete-btn" onclick={() => onDeleteAnnotation(note.id)} title="Delete note">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                                                </svg>
                                            </button>
                                        </div>
                                        <div class="note-body">{note.data}</div>
                                        {#if note.tags && note.tags.length > 0}
                                            <div class="note-tags">
                                                {#each note.tags as t}
                                                    <span class="tag-pill sm">#{t}</span>
                                                {/each}
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        </div>
                    {/if}

                    {#if allHighlights.length > 0}
                        <div class="section">
                            <h3 class="section-title">All Highlights ({allHighlights.length})</h3>
                            <div class="annotations-list">
                                {#each allHighlights as hl}
                                    <div class="annotation-card highlight-card">
                                        <div class="card-header">
                                            <div class="highlight-ref">
                                                <span class="color-swatch" style="background:{hl.color}"></span>
                                                <button class="verse-ref-btn full-ref" onclick={() => navigateToAnnotation(hl)} title="Jump to verse">
                                                    {getChapterRef(hl)} ↗
                                                </button>
                                            </div>
                                            <button class="delete-btn" onclick={() => onDeleteAnnotation(hl.id)} title="Remove highlight">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        </div>
                    {/if}
                {/if}
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

    /* ── Note Editor ── */
    .note-editor {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        background: var(--color-bg-surface);
        padding: var(--space-4);
        border-radius: var(--radius-md);
        border: 1px solid var(--color-border);
    }

    .selection-indicator {
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
    }
    .selection-indicator strong { color: var(--color-accent); }

    .note-textarea {
        width: 100%;
        min-height: 100px;
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: var(--space-3);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        resize: vertical;
    }
    .note-textarea:focus { outline: none; border-color: var(--color-accent); }

    .tag-input-group {
        display: flex;
        align-items: center;
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: 4px 4px 4px var(--space-3);
        transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    }
    .tag-input-group:focus-within {
        border-color: var(--color-accent);
        box-shadow: 0 0 0 2px var(--color-accent-subtle);
    }
    .hash { color: var(--color-accent); font-size: var(--font-size-sm); font-weight: 600; }
    .tag-input-group input {
        flex: 1;
        background: none;
        border: none;
        padding: var(--space-1) var(--space-2);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
    }
    .tag-input-group input:focus { outline: none; }
    .add-tag-btn {
        background: var(--color-accent);
        border: none;
        border-radius: var(--radius-sm);
        padding: 4px 10px;
        color: white;
        font-size: var(--font-size-xs);
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 4px;
        transition: opacity var(--transition-fast), transform var(--transition-fast);
    }
    .add-tag-btn:hover { opacity: 0.9; transform: scale(0.98); }

    .active-tags {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
        margin-top: var(--space-2);
    }
    .tag-pill {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
        padding: 2px var(--space-2);
        border-radius: var(--radius-full);
        font-size: var(--font-size-xs);
        font-weight: 500;
        border: 1px solid var(--color-border);
    }
    .tag-pill.sm { color: var(--color-text-secondary); background: transparent; }
    .remove-tag {
        background: none;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        padding: 0 2px;
        font-size: 14px;
        line-height: 1;
    }
    .remove-tag:hover { color: var(--color-text-primary); }

    .editor-actions { display: flex; justify-content: flex-end; }
    .btn {
        padding: var(--space-2) var(--space-4);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
        font-weight: 600;
        cursor: pointer;
        transition: all var(--transition-fast);
        border: none;
    }
    .btn-primary { background: var(--color-accent); color: white; }
    .btn-primary:hover { opacity: 0.9; }

    /* ── Sections ── */
    .section { display: flex; flex-direction: column; gap: var(--space-2); }

    .section-title {
        font-size: var(--font-size-xs);
        font-weight: 600;
        color: var(--color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
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

    /* ── Annotation cards ── */
    .annotations-list { display: flex; flex-direction: column; gap: var(--space-2); }

    .annotation-card {
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: var(--space-3);
    }

    .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--space-2);
    }

    .verse-ref-btn {
        background: none;
        border: none;
        color: var(--color-accent);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 700;
        cursor: pointer;
        padding: 0;
        transition: opacity var(--transition-fast);
    }
    .verse-ref-btn:hover { opacity: 0.75; }
    .verse-ref-btn.full-ref {
        font-size: var(--font-size-sm);
        font-weight: 500;
    }

    .delete-btn {
        background: none;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        padding: 2px;
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        transition: color var(--transition-fast);
    }
    .delete-btn:hover { color: var(--color-danger); }

    .note-body {
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
        line-height: 1.5;
        white-space: pre-wrap;
        margin-bottom: var(--space-2);
    }

    .note-tags {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1);
    }

    .highlight-card { padding: var(--space-2) var(--space-3); }

    .highlight-ref {
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }

    .color-swatch {
        display: inline-block;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 1px solid rgba(255,255,255,0.2);
        flex-shrink: 0;
    }
</style>
