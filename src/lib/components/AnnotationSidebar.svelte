<script lang="ts">
    import type { Annotation, Tag } from '@codex-scriptura/core';
    import { getTags, saveTag } from '@codex-scriptura/db';
    import { onMount } from 'svelte';

    let { 
        isOpen = $bindable(false), 
        book, 
        chapter, 
        selectedVerses,
        chapterAnnotations,
        onSaveNote,
        onDeleteNote
    } = $props<{
        isOpen: boolean;
        book: string;
        chapter: number;
        selectedVerses: number[];
        chapterAnnotations: Annotation[];
        onSaveNote: (text: string, tags: string[]) => Promise<void>;
        onDeleteNote: (id: string) => Promise<void>;
    }>();

    let noteText = $state('');
    let tags = $state<string[]>([]);
    let availableTags = $state<Tag[]>([]);
    let newTagInput = $state('');

    let notesOnly = $derived(chapterAnnotations.filter((a: Annotation) => a.type === 'note'));

    async function loadTags() {
        availableTags = await getTags();
    }

    onMount(() => {
        if (isOpen) {
            loadTags();
        }
    });

    $effect(() => {
        if (isOpen) {
            loadTags();
            // Reset form when opened for a new selection
            if (selectedVerses.length > 0) {
                noteText = '';
                tags = [];
            }
        }
    });

    async function handleAddTag() {
        const t = newTagInput.trim().toLowerCase();
        if (!t) return;
        
        if (!tags.includes(t)) {
            tags = [...tags, t];
        }

        // If it's a completely new tag, save it to DB for autocomplete later
        if (!availableTags.find(x => x.name === t)) {
            const newTag: Tag = {
                id: crypto.randomUUID(),
                name: t,
                color: '#3f3f46' // default gray
            };
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
        // Keep sidebar open so they can see their note was added
    }

    function closeSidebar() {
        isOpen = false;
    }
</script>

{#if isOpen}
    <div class="sidebar-overlay" onclick={closeSidebar} role="presentation"></div>
    <div class="annotation-sidebar" class:open={isOpen}>
        <div class="sidebar-header">
            <h2>Annotations</h2>
            <button class="close-btn" aria-label="Close sidebar" onclick={closeSidebar}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                </svg>
            </button>
        </div>

        <div class="sidebar-content">
            <!-- 1. Editor Section (If Verses are Selected) -->
            {#if selectedVerses.length > 0}
                <div class="note-editor">
                    <div class="selection-indicator">
                        New note on <strong>{book} {chapter}:{selectedVerses[0]}{selectedVerses.length > 1 ? `-${selectedVerses[selectedVerses.length - 1]}` : ''}</strong>
                    </div>

                    <textarea
                        class="note-textarea"
                        placeholder="Write your thoughts..."
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
                            <button class="add-tag-btn" onclick={handleAddTag}>Add</button>
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

            <div class="divider"></div>

            <!-- 2. Existing Notes for Current Chapter -->
            <div class="chapter-notes">
                <h3 class="section-title">Notes in {book} {chapter}</h3>
                
                {#if notesOnly.length === 0}
                    <p class="empty-state">No notes in this chapter yet.</p>
                {:else}
                    <div class="notes-list">
                        {#each notesOnly as note}
                            {@const sV = note.verseStart.split('.')[2]}
                            {@const eV = note.verseEnd.split('.')[2]}
                            <div class="note-card">
                                <div class="note-header">
                                    <span class="verse-ref">v{sV}{sV !== eV ? `-${eV}` : ''}</span>
                                    <button class="delete-btn" onclick={() => onDeleteNote(note.id)}>Delete</button>
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
                {/if}
            </div>
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
        box-shadow: var(--shadow-2xl);
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
    .close-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }

    .sidebar-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--space-5);
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
    }

    /* Editor */
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
    .selection-indicator strong {
        color: var(--color-accent);
    }

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
    .note-textarea:focus {
        outline: none;
        border-color: var(--color-accent);
    }

    .tag-input-group {
        display: flex;
        align-items: center;
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding-left: var(--space-2);
        overflow: hidden;
    }
    .tag-input-group .hash {
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
    }
    .tag-input-group input {
        flex: 1;
        background: none;
        border: none;
        padding: var(--space-2);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
    }
    .tag-input-group input:focus {
        outline: none;
    }
    .add-tag-btn {
        background: var(--color-bg-hover);
        border: none;
        border-left: 1px solid var(--color-border);
        padding: 0 var(--space-3);
        color: var(--color-text-secondary);
        font-size: var(--font-size-xs);
        font-weight: 600;
        cursor: pointer;
        height: 100%;
    }
    .add-tag-btn:hover {
        background: var(--color-accent-subtle);
        color: var(--color-accent);
    }

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
    .tag-pill.sm {
        color: var(--color-text-secondary);
        background: transparent;
    }
    .remove-tag {
        background: none;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        padding: 0 2px;
        font-size: 14px;
        line-height: 1;
    }
    .remove-tag:hover {
        color: var(--color-text-primary);
    }

    .editor-actions {
        display: flex;
        justify-content: flex-end;
    }
    .btn {
        padding: var(--space-2) var(--space-4);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
        font-weight: 600;
        cursor: pointer;
        transition: all var(--transition-fast);
        border: none;
    }
    .btn-primary {
        background: var(--color-accent);
        color: white;
    }
    .btn-primary:hover {
        opacity: 0.9;
    }

    .divider {
        height: 1px;
        background: var(--color-border);
    }

    .section-title {
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: var(--color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: var(--space-4);
    }

    .empty-state {
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
        font-style: italic;
    }

    .notes-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
    }

    .note-card {
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: var(--space-3);
    }
    .note-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: var(--space-2);
    }
    .verse-ref {
        font-weight: 700;
        color: var(--color-accent);
        font-size: var(--font-size-xs);
    }
    .delete-btn {
        background: none;
        border: none;
        color: var(--color-text-muted);
        font-size: var(--font-size-xs);
        cursor: pointer;
    }
    .delete-btn:hover {
        color: var(--color-text-primary);
        text-decoration: underline;
    }
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
</style>
