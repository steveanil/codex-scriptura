<script lang="ts">
    import { tick } from 'svelte';
    import type { Annotation } from '@codex-scriptura/core';
    import { findBook, parseOsisId } from '@codex-scriptura/core';
    import { verseHover } from '$lib/actions/verseHover';
    import { preferences } from '$lib/stores/preferences.svelte';
    import AnnotationEditor from './AnnotationEditor.svelte';
    import type { HighlightSwatch } from './HighlightEditor.svelte';

    /**
     * One annotation in the sidebar: jump, edit (notes and highlights) and
     * delete. While `editing`, the card is replaced by the editor.
     */
    let {
        annotation,
        fullRef = false,
        editing = false,
        swatches,
        translationId,
        onNavigate,
        onDelete,
        onEdit,
        onCancelEdit,
        onSave,
    }: {
        annotation: Annotation;
        /** Book, chapter and verse (All tab) instead of just the verses. */
        fullRef?: boolean;
        editing?: boolean;
        swatches: HighlightSwatch[];
        translationId: string;
        onNavigate: () => void;
        onDelete: () => void;
        onEdit: () => void;
        onCancelEdit: () => void;
        onSave: (updated: Annotation) => Promise<void>;
    } = $props();

    const NOUN = { note: 'note', highlight: 'highlight', theme: 'theme tag' } as Record<string, string>;
    let noun = $derived(NOUN[annotation.type] ?? 'annotation');
    let editable = $derived(annotation.type === 'note' || annotation.type === 'highlight');
    let editBtn: HTMLButtonElement | undefined = $state();

    let ref = $derived.by(() => {
        const s = parseOsisId(annotation.verseStart);
        const e = parseOsisId(annotation.verseEnd);
        if (!s) return annotation.verseStart;
        if (fullRef) return `${findBook(s.book)?.name ?? s.book} ${s.chapter}:${s.verse}`;
        if (!e) return `v${s.verse}`;
        if (e.chapter !== s.chapter) return `${s.chapter}:${s.verse}–${e.chapter}:${e.verse}`;
        return s.verse === e.verse ? `v${s.verse}` : `v${s.verse}–${e.verse}`;
    });

    async function leaveEdit(save?: Annotation) {
        if (save) await onSave(save);
        onCancelEdit();
        await tick();
        editBtn?.focus();
    }
</script>

{#if editing && editable}
    <AnnotationEditor
        {annotation}
        {swatches}
        {translationId}
        onSave={(a) => leaveEdit(a)}
        onCancel={() => leaveEdit()}
    />
{:else}
    <div class="annotation-card" class:compact={annotation.type !== 'note'}>
        <div class="card-header">
            <div class="ref">
                {#if annotation.type === 'highlight'}
                    <span class="color-swatch" style="background:{annotation.color}"></span>
                {:else if annotation.type === 'theme'}
                    <a class="theme-pill" href="/themes?t={annotation.tags[0]}" title="Open the {annotation.data} thread">{annotation.data}</a>
                {/if}
                <button class="verse-ref-btn" class:full-ref={fullRef}
                    use:verseHover={{ osisId: annotation.verseStart, translationId: preferences.value?.activeTranslation ?? 'KJV' }}
                    onclick={onNavigate}
                    title="Jump to verse">
                    {ref} ↗
                </button>
            </div>
            <div class="card-actions">
                {#if editable}
                    <button class="icon-btn" bind:this={editBtn} onclick={onEdit} title="Edit {noun}" aria-label="Edit {noun}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                            <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                        </svg>
                    </button>
                {/if}
                <button class="icon-btn delete-btn" onclick={onDelete} title="Delete {noun}" aria-label="Delete {noun}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                    </svg>
                </button>
            </div>
        </div>
        {#if annotation.type === 'note'}
            {#if annotation.data}<div class="note-body">{annotation.data}</div>{/if}
            {#if annotation.tags.length > 0}
                <div class="note-tags">
                    {#each annotation.tags as t (t)}
                        <span class="tag-pill">#{t}</span>
                    {/each}
                </div>
            {/if}
        {/if}
    </div>
{/if}

<style>
    .annotation-card {
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: var(--space-3);
    }
    .annotation-card.compact { padding: var(--space-2) var(--space-3); }

    .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--space-2);
    }
    .annotation-card:not(.compact) .card-header { margin-bottom: var(--space-2); }

    .ref {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-width: 0;
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

    .card-actions { display: flex; align-items: center; gap: var(--space-1); flex-shrink: 0; }
    .icon-btn {
        background: none;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        padding: 4px;
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        transition: color var(--transition-fast), background var(--transition-fast);
    }
    .icon-btn:hover { color: var(--color-text-primary); background: var(--color-bg-hover); }
    .icon-btn.delete-btn:hover { color: var(--color-danger); }

    .note-body {
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
        line-height: 1.5;
        white-space: pre-wrap;
        margin-bottom: var(--space-2);
    }

    .note-tags { display: flex; flex-wrap: wrap; gap: var(--space-1); }
    .tag-pill {
        display: inline-flex;
        align-items: center;
        color: var(--color-text-secondary);
        padding: 2px var(--space-2);
        border-radius: var(--radius-pill);
        font-size: var(--font-size-xs);
        font-weight: 500;
        border: 1px solid var(--color-border);
    }

    .theme-pill {
        display: inline-flex;
        align-items: center;
        background: color-mix(in srgb, var(--color-accent) 15%, transparent);
        color: var(--color-accent);
        padding: 2px var(--space-2);
        border-radius: var(--radius-pill);
        font-size: var(--font-size-xs);
        font-weight: 600;
        border: 1px solid color-mix(in srgb, var(--color-accent) 35%, transparent);
        text-decoration: none;
    }
    .theme-pill:hover { background: color-mix(in srgb, var(--color-accent) 25%, transparent); }

    .color-swatch {
        display: inline-block;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 1px solid var(--color-border-control);
        flex-shrink: 0;
    }
</style>
