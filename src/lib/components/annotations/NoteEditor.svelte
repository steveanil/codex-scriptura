<script lang="ts">
    import type { Snippet } from 'svelte';
    import type { Tag } from '@codex-scriptura/core';
    import { getTags, saveTag } from '@codex-scriptura/db';
    import { normalizeTags } from '$lib/annotations/edit';
    import Button from '$lib/components/ui/Button.svelte';

    /**
     * Note body and tags, for a new note and for editing one (issue #322).
     * The owner keeps the draft (bound), so it survives the editor
     * unmounting, and decides what saving means: onSubmit returns an error
     * to show, or nothing on success.
     */
    let {
        text = $bindable(''),
        tags = $bindable([]),
        submitLabel = 'Save note',
        autofocus = false,
        onSubmit,
        onCancel,
        header,
        children,
    }: {
        text?: string;
        tags?: string[];
        submitLabel?: string;
        autofocus?: boolean;
        onSubmit: () => Promise<string | null | void>;
        /** Shown as a Cancel button and bound to Escape when given. */
        onCancel?: () => void;
        header?: Snippet;
        /** Extra fields between the tags and the buttons (the range editor). */
        children?: Snippet;
    } = $props();

    const uid = $props.id();
    let tagInput = $state('');
    let vocabulary = $state<Tag[]>([]);
    let error = $state<string | null>(null);
    let saving = $state(false);
    let textarea: HTMLTextAreaElement | undefined = $state();

    let suggestions = $derived(vocabulary.filter((t) => !tags.includes(t.name)));

    $effect(() => {
        getTags().then((t) => (vocabulary = t)).catch(() => {});
    });

    $effect(() => {
        if (autofocus) textarea?.focus();
    });

    async function addTag() {
        const [t] = normalizeTags([tagInput]);
        tagInput = '';
        if (!t) return;
        if (!tags.includes(t)) tags = [...tags, t];
        if (!vocabulary.some((x) => x.name === t)) {
            const tag: Tag = { id: crypto.randomUUID(), name: t, color: '#3f3f46' };
            await saveTag(tag);
            vocabulary = [...vocabulary, tag];
        }
    }

    function removeTag(t: string) {
        tags = tags.filter((x) => x !== t);
    }

    async function submit() {
        if (saving) return;
        saving = true;
        try {
            error = (await onSubmit()) ?? null;
        } finally {
            saving = false;
        }
    }

    function onKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
        } else if (e.key === 'Escape' && onCancel) {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
        }
    }
</script>

<!-- Ctrl/Cmd+Enter and Escape bubble up from the fields inside. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="note-editor" role="group" aria-label="Note" onkeydown={onKeydown}>
    {#if header}
        <div class="editor-header">{@render header()}</div>
    {/if}

    <textarea
        class="note-textarea"
        placeholder="Write your thoughts…"
        aria-label="Note text"
        bind:this={textarea}
        bind:value={text}
        oninput={() => (error = null)}
    ></textarea>

    <div class="tag-manager">
        <div class="tag-input-group">
            <span class="hash" aria-hidden="true">#</span>
            <input
                type="text"
                placeholder="Add tag (press Enter)"
                aria-label="Add tag"
                list="{uid}-tags"
                bind:value={tagInput}
                onkeydown={(e) => {
                    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        addTag();
                    }
                }}
            />
            <datalist id="{uid}-tags">
                {#each suggestions as t (t.id)}
                    <option value={t.name}></option>
                {/each}
            </datalist>
            <Button size="sm" variant="primary" onclick={addTag} title="Add tag">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                Add
            </Button>
        </div>
        {#if tags.length > 0}
            <div class="active-tags">
                {#each tags as t (t)}
                    <span class="tag-pill">
                        {t}
                        <button class="remove-tag" onclick={() => removeTag(t)} aria-label="Remove tag {t}" title="Remove tag">×</button>
                    </span>
                {/each}
            </div>
        {/if}
    </div>

    {@render children?.()}

    {#if error}
        <p class="editor-error" role="alert">{error}</p>
    {/if}

    <div class="editor-actions">
        {#if onCancel}
            <Button variant="ghost" onclick={onCancel}>Cancel</Button>
        {/if}
        <Button variant="primary" loading={saving} onclick={submit} title="Save (Ctrl+Enter)">{submitLabel}</Button>
    </div>
</div>

<style>
    .note-editor {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        background: var(--color-bg-surface);
        padding: var(--space-4);
        border-radius: var(--radius-md);
        border: 1px solid var(--color-border);
    }

    .editor-header {
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
    }
    .editor-header :global(strong) { color: var(--color-accent); }

    .note-textarea {
        width: 100%;
        min-height: 100px;
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-sm);
        padding: var(--space-3);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        resize: vertical;
    }

    .tag-input-group {
        display: flex;
        align-items: center;
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-md);
        padding: 4px 4px 4px var(--space-3);
        transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    }
    .tag-input-group:focus-within { box-shadow: var(--focus-ring); }
    .hash { color: var(--color-accent); font-size: var(--font-size-sm); font-weight: 600; }
    .tag-input-group input {
        flex: 1;
        min-width: 0;
        background: none;
        border: none;
        padding: var(--space-1) var(--space-2);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
    }
    /* The group carries the ring via :focus-within; the inner input must not add a second one. */
    .tag-input-group input:focus-visible { outline: none; box-shadow: none; }

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
        border-radius: var(--radius-pill);
        font-size: var(--font-size-xs);
        font-weight: 500;
        border: 1px solid var(--color-border);
    }
    .remove-tag {
        background: none;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        padding: 0 2px;
        font-size: var(--font-size-sm);
        line-height: 1;
    }
    .remove-tag:hover { color: var(--color-text-primary); }

    .editor-error {
        margin: 0;
        color: var(--color-danger);
        font-size: var(--font-size-xs);
    }

    .editor-actions { display: flex; justify-content: flex-end; gap: var(--space-2); }
</style>
