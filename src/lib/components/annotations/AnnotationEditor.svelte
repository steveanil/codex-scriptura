<script lang="ts">
    import { untrack } from 'svelte';
    import type { Annotation } from '@codex-scriptura/core';
    import { getLastVerses } from '@codex-scriptura/db';
    import { editAnnotation, type AnnotationPatch, type LastVerses } from '$lib/annotations/edit';
    import Button from '$lib/components/ui/Button.svelte';
    import NoteEditor from './NoteEditor.svelte';
    import HighlightEditor, { type HighlightSwatch } from './HighlightEditor.svelte';
    import RangeEditor from './RangeEditor.svelte';

    /**
     * Edit an existing note or highlight in place (issue #322). Builds a
     * patch from the fields and lets editAnnotation produce the record, so
     * the id never changes; onSave writes it. Saving with nothing changed
     * just closes.
     */
    let {
        annotation,
        swatches,
        translationId,
        onSave,
        onCancel,
    }: {
        annotation: Annotation;
        swatches: HighlightSwatch[];
        /** Versification source for the range pickers when the record has no translation of its own. */
        translationId: string;
        onSave: (updated: Annotation) => Promise<void>;
        onCancel: () => void;
    } = $props();

    // Drafts start from the record as it was when editing began.
    const initial = untrack(() => $state.snapshot(annotation));
    let text = $state(initial.data);
    let tags = $state([...initial.tags]);
    let color = $state(initial.color ?? '');
    let start = $state(initial.verseStart);
    let end = $state(initial.verseEnd);
    let lastVerses = $state<LastVerses | null>(null);
    let error = $state<string | null>(null);
    let saving = $state(false);

    $effect(() => {
        const source = initial.translation ?? translationId;
        getLastVerses(source, initial.book).then((lv) => (lastVerses = lv)).catch(() => (lastVerses = {}));
    });

    $effect(() => {
        start; end; color;
        error = null;
    });

    // The Edit button that opened this is gone, so focus lands inside.
    let highlightEl: HTMLDivElement | undefined = $state();
    $effect(() => {
        highlightEl?.querySelector<HTMLInputElement>('input:checked, input')?.focus();
    });

    /** Returns the error to show, or null once saved. */
    async function save(): Promise<string | null> {
        const patch: AnnotationPatch = initial.type === 'note' ? { body: text, tags: $state.snapshot(tags) } : { color };
        if (start !== initial.verseStart || end !== initial.verseEnd) patch.range = { start, end };
        const result = editAnnotation($state.snapshot(annotation), patch, lastVerses);
        if (!result.ok) return result.error;
        if (!result.changed) {
            onCancel();
            return null;
        }
        await onSave(result.annotation);
        return null;
    }

    async function saveHighlight() {
        if (saving) return;
        saving = true;
        try {
            error = await save();
        } finally {
            saving = false;
        }
    }

    function onHighlightKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            saveHighlight();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
        }
    }
</script>

{#if initial.type === 'note'}
    <NoteEditor bind:text bind:tags submitLabel="Save" autofocus onSubmit={save} {onCancel}>
        <RangeEditor book={initial.book} bind:start bind:end {lastVerses} />
    </NoteEditor>
{:else}
    <!-- Ctrl/Cmd+Enter and Escape bubble up from the fields inside. -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="highlight-edit" role="group" aria-label="Edit highlight" bind:this={highlightEl} onkeydown={onHighlightKeydown}>
        <HighlightEditor bind:color {swatches} />
        <RangeEditor book={initial.book} bind:start bind:end {lastVerses} />
        {#if error}
            <p class="editor-error" role="alert">{error}</p>
        {/if}
        <div class="editor-actions">
            <Button variant="ghost" onclick={onCancel}>Cancel</Button>
            <Button variant="primary" loading={saving} onclick={saveHighlight} title="Save (Ctrl+Enter)">Save</Button>
        </div>
    </div>
{/if}

<style>
    .highlight-edit {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        background: var(--color-bg-surface);
        padding: var(--space-4);
        border-radius: var(--radius-md);
        border: 1px solid var(--color-border);
    }
    .editor-error {
        margin: 0;
        color: var(--color-danger);
        font-size: var(--font-size-xs);
    }
    .editor-actions { display: flex; justify-content: flex-end; gap: var(--space-2); }
</style>
