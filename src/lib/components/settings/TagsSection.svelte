<script lang="ts">
    import { tick } from 'svelte';
    import {
        observeTags, observeThemes, createTag, normalizeTagName, renameTag, mergeTags, deleteTag, renameTheme, mergeThemes,
        type TagSummary, type ThemeSummary,
    } from '@codex-scriptura/db';
    import { toast } from '$lib/stores/toast.svelte';
    import Button from '$lib/components/ui/Button.svelte';
    import EmptyState from '$lib/components/ui/EmptyState.svelte';
    import InlineError from '$lib/components/ui/InlineError.svelte';
    import Skeleton from '$lib/components/ui/Skeleton.svelte';
    import SettingsCard from './SettingsCard.svelte';

    type List = 'tag' | 'theme';
    /** The one row being worked on. `key` is the tag name or the theme slug. */
    type Active =
        | { list: List; key: string; mode: 'rename'; draft: string }
        | { list: 'tag'; key: string; mode: 'delete' }
        // `existing` is how the target shows today, `label` what the merged result will be called
        | { list: List; key: string; mode: 'merge'; from: string; fromCount: number; into: string; intoCount: number; existing: string; label: string };

    let tags = $state<TagSummary[] | null>(null);
    let themes = $state<ThemeSummary[] | null>(null);
    let active = $state<Active | null>(null);
    let busy = $state(false);
    let error = $state<string | null>(null);
    let newTag = $state('');
    let createNote = $state('');
    let cardEl: HTMLElement | undefined = $state();
    let newTagEl: HTMLInputElement | undefined = $state();

    $effect(() => {
        const fail = (e: unknown) => (error = `Could not read tags: ${e instanceof Error ? e.message : String(e)}`);
        const a = observeTags().subscribe({ next: (v) => (tags = v), error: fail });
        const b = observeThemes().subscribe({ next: (v) => (themes = v), error: fail });
        return () => {
            a.unsubscribe();
            b.unsubscribe();
        };
    });

    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const isActive = (list: List, key: string) => active?.list === list && active.key === key;

    function focusInput(el: HTMLInputElement) {
        el.focus();
        el.select();
    }
    /** A prompt replaces the button that opened it, so focus moves into the prompt (and Escape reaches it). */
    function focusMarked(el: HTMLElement) {
        el.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }

    // After a rename the row under its new name only appears once the live
    // query re-emits, and its button stays disabled until the write is done,
    // so focus waits for both rather than falling to <body>.
    let pendingFocus: string | null = null;
    function applyFocus() {
        // Starting on another row cancels a focus move that never landed
        if (active) pendingFocus = null;
        if (!pendingFocus) return;
        const el = cardEl?.querySelector<HTMLElement>(`[data-rename="${CSS.escape(pendingFocus)}"]`);
        el?.focus();
        if (el && document.activeElement === el) pendingFocus = null;
    }
    $effect(() => {
        void tags;
        void themes;
        void busy;
        tick().then(applyFocus);
    });

    /** Close the active row and put focus on the Rename button of the row now called `key`. */
    async function finish(list: List, key: string) {
        active = null;
        pendingFocus = `${list}:${key}`;
        await tick();
        applyFocus();
    }
    function close() {
        if (active) finish(active.list, active.key);
    }

    async function run(work: () => Promise<void>) {
        busy = true;
        error = null;
        try {
            await work();
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            busy = false;
        }
    }

    function addTag(e: SubmitEvent) {
        e.preventDefault();
        if (!newTag.trim()) return;
        run(async () => {
            const { name, created } = await createTag(newTag);
            createNote = created ? '' : `#${name} already exists.`;
            if (created) {
                newTag = '';
                toast.show(`Added #${name}`);
            }
        });
    }

    function saveRename() {
        const a = active;
        if (!a || a.mode !== 'rename' || busy) return;
        run(async () => {
            if (a.list === 'tag') {
                const name = normalizeTagName(a.draft);
                if (name === a.key) return finish('tag', a.key);
                const r = await renameTag(a.key, name);
                if (r.status === 'collision') {
                    active = { list: 'tag', key: a.key, mode: 'merge', from: `#${a.key}`, fromCount: r.collision.sourceCount, into: r.collision.name, intoCount: r.collision.count, existing: `#${r.collision.name}`, label: `#${r.collision.name}` };
                    return;
                }
                await finish('tag', name);
                toast.show(`Renamed #${a.key} to #${name} on ${plural(r.count, 'annotation')}`);
            } else {
                const label = a.draft.trim();
                const th = themes?.find((x) => x.slug === a.key);
                if (th && label === th.label) return finish('theme', a.key);
                const r = await renameTheme(a.key, label);
                if (r.status === 'collision') {
                    active = { list: 'theme', key: a.key, mode: 'merge', from: th?.label ?? a.key, fromCount: r.sourceCount, into: r.collision.slug, intoCount: r.collision.count, existing: r.collision.label, label };
                    return;
                }
                await finish('theme', r.slug);
                toast.show(`Renamed the theme to ${label}`);
            }
        });
    }

    function confirmMerge() {
        const a = active;
        if (!a || a.mode !== 'merge' || busy) return;
        run(async () => {
            if (a.list === 'tag') await mergeTags(a.key, a.into);
            else await mergeThemes(a.key, a.label);
            await finish(a.list, a.into);
            toast.show(`Merged ${a.from} into ${a.label}`);
        });
    }

    function confirmDelete() {
        const a = active;
        if (!a || a.mode !== 'delete' || busy) return;
        run(async () => {
            const n = await deleteTag(a.key);
            active = null;
            newTagEl?.focus();
            toast.show(`Deleted #${a.key}; ${plural(n, 'annotation')} kept without it`);
        });
    }

    function onRenameKey(e: KeyboardEvent) {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveRename();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    }
    function onPromptKey(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    }
</script>

{#snippet renameRow(list: List, label: string)}
    {#if active?.mode === 'rename'}
        <div class="edit">
            <input
                class="name-input"
                type="text"
                bind:value={active.draft}
                onkeydown={onRenameKey}
                use:focusInput
                maxlength="64"
                aria-label="New name for {label}"
                disabled={busy}
            />
            <Button size="sm" variant="primary" onclick={saveRename} loading={busy}>Save</Button>
            <Button size="sm" variant="ghost" onclick={close} disabled={busy}>Cancel</Button>
        </div>
        <p class="hint">Enter saves, Escape cancels.</p>
    {:else if active?.mode === 'merge'}
        {@const unit = list === 'tag' ? 'annotation' : 'passage'}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div class="prompt" role="alert" onkeydown={onPromptKey} use:focusMarked>
            <p>
                {active.existing} already exists on {plural(active.intoCount, unit)}.
                Merge {active.from} ({plural(active.fromCount, unit)}) into it{active.label !== active.existing ? `, named ${active.label}` : ''}?
            </p>
            <div class="prompt-actions">
                <Button size="sm" variant="primary" onclick={confirmMerge} loading={busy}>Merge</Button>
                <Button size="sm" variant="ghost" onclick={close} disabled={busy} data-autofocus>Cancel</Button>
            </div>
        </div>
    {/if}
{/snippet}

{#snippet actions(list: List, key: string, name: string)}
    {@const shown = list === 'tag' ? `#${name}` : name}
    <div class="act">
        <Button
            size="sm"
            variant="ghost"
            data-rename="{list}:{key}"
            onclick={() => (active = { list, key, mode: 'rename', draft: name })}
            aria-label="Rename {shown}"
            disabled={busy}
        >Rename</Button>
        {#if list === 'tag'}
            <Button size="sm" variant="ghost" onclick={() => (active = { list: 'tag', key, mode: 'delete' })} aria-label="Delete {shown}" disabled={busy}>Delete</Button>
        {/if}
    </div>
{/snippet}

<SettingsCard id="tags" kicker="Tags">
    <div bind:this={cardEl}>
        <p class="note">Renaming or deleting a tag changes every annotation that carries it. Annotations themselves are never deleted here.</p>

        {#if error}
            <div class="error"><InlineError message={error} /></div>
        {/if}

        <h3 class="list-h">Note tags</h3>
        <form class="create" onsubmit={addTag}>
            <input class="name-input" type="text" bind:this={newTagEl} bind:value={newTag} oninput={() => (createNote = '')} placeholder="New tag" maxlength="64" aria-label="New tag name" />
            <Button size="sm" variant="secondary" type="submit" disabled={busy || !newTag.trim()}>Add tag</Button>
        </form>
        <p class="hint" aria-live="polite">{createNote}</p>

        {#if tags === null}
            <Skeleton variant="row" lines={3} label="Loading tags" />
        {:else if tags.length === 0}
            <EmptyState message="No tags yet. Add one here, or while writing a note in the reader's annotation sidebar." />
        {:else}
            <ul class="rows" aria-label="Note tags">
                {#each tags as t (t.name)}
                    <li class="row">
                        {#if isActive('tag', t.name) && active?.mode !== 'delete'}
                            {@render renameRow('tag', `#${t.name}`)}
                        {:else if isActive('tag', t.name) && active?.mode === 'delete'}
                            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                            <div class="prompt" role="alert" onkeydown={onPromptKey} use:focusMarked>
                                <p>
                                    {#if t.count > 0}
                                        Remove #{t.name} from {plural(t.count, 'annotation')}? The annotations stay, only the tag goes.
                                    {:else}
                                        Delete #{t.name}? No annotation carries it.
                                    {/if}
                                </p>
                                <div class="prompt-actions">
                                    <Button size="sm" variant="danger" onclick={confirmDelete} loading={busy}>Delete tag</Button>
                                    <Button size="sm" variant="ghost" onclick={close} disabled={busy} data-autofocus>Cancel</Button>
                                </div>
                            </div>
                        {:else}
                            <span class="name">#{t.name}</span>
                            <span class="count">{plural(t.count, 'annotation')}</span>
                            {@render actions('tag', t.name, t.name)}
                        {/if}
                    </li>
                {/each}
            </ul>
        {/if}

        <h3 class="list-h">Theme threads</h3>
        {#if themes === null}
            <Skeleton variant="row" lines={2} label="Loading themes" />
        {:else if themes.length === 0}
            <EmptyState message="No theme threads yet. Select verses in the reader and choose Theme on the toolbar to start one." />
        {:else}
            <ul class="rows" aria-label="Theme threads">
                {#each themes as th (th.slug)}
                    <li class="row">
                        {#if isActive('theme', th.slug)}
                            {@render renameRow('theme', th.label)}
                        {:else}
                            <a class="name" href="/themes?t={th.slug}" title="Open the {th.label} thread">{th.label}</a>
                            <span class="count">{plural(th.count, 'passage')}</span>
                            {@render actions('theme', th.slug, th.label)}
                        {/if}
                    </li>
                {/each}
            </ul>
            <p class="hint">To remove a whole thread, open it and remove its passages.</p>
        {/if}
    </div>
</SettingsCard>

<style>
    .note {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        padding: var(--space-3) 0 var(--space-2);
        max-width: 64ch;
    }
    .error { margin: var(--space-2) 0; }
    .list-h {
        font-size: var(--font-size-xs);
        font-weight: 600;
        color: var(--color-text-secondary);
        margin: var(--space-4) 0 var(--space-2);
    }
    .create { display: flex; gap: var(--space-2); align-items: center; max-width: 420px; }
    .name-input {
        flex: 1;
        min-width: 0;
        height: var(--row-h-sm);
        background: var(--color-bg-control);
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-sm);
        padding: 0 var(--space-3);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
    }
    .hint {
        font-size: var(--font-size-2xs);
        color: var(--color-text-muted);
        margin-top: var(--space-1);
        min-height: 1em;
    }
    .rows { list-style: none; margin: 0; padding: 0; }
    .row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: center;
        gap: var(--space-3);
        min-height: var(--row-h-md);
        padding: var(--space-2) 0;
        border-bottom: 1px solid var(--color-border-subtle);
    }
    .row:last-child { border-bottom: none; }
    /* Rename, merge and delete prompts take the whole row */
    .row > .edit, .row > .prompt, .row > .hint { grid-column: 1 / -1; }
    .name {
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    a.name:hover { color: var(--color-accent); }
    .count {
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        white-space: nowrap;
    }
    /* Wide enough for Rename + Delete, so counts line up across both lists */
    .act { display: flex; gap: var(--space-1); justify-content: flex-end; min-width: 128px; }
    .edit { display: flex; gap: var(--space-2); align-items: center; }
    .prompt {
        padding: var(--space-3) var(--space-4);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg-surface);
        font-size: var(--font-size-xs);
        color: var(--color-text-primary);
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }
    .prompt-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    @media (max-width: 520px) {
        .row { grid-template-columns: minmax(0, 1fr) auto; }
        .row > .act { grid-column: 1 / -1; justify-content: flex-start; min-width: 0; }
    }
</style>
