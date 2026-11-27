<script lang="ts">
    import { tick } from 'svelte';
    import { deleteAnnotationsOfType, observeAnnotationCounts, restoreAnnotations } from '@codex-scriptura/db';
    import Button from '$lib/components/ui/Button.svelte';
    import SettingRow from './SettingRow.svelte';
    import { toast } from '$lib/stores/toast.svelte';
    import { lastExportAt } from '$lib/utils/backup';

    /** Clear one kind of annotation at a time (issue #277), behind an inline confirm and an Undo toast. */
    let { onChange }: { onChange?: () => void } = $props();

    // bookmark and memorization have no UI anywhere, so they are not offered
    const KINDS = [
        { type: 'highlight', label: 'Highlights', one: 'highlight', many: 'highlights', hint: '', keeps: 'Notes and theme tags stay.' },
        { type: 'note', label: 'Notes', one: 'note', many: 'notes', hint: 'Your tag list is kept.', keeps: 'Highlights, theme tags and your tag list stay.' },
        { type: 'theme', label: 'Theme tags', one: 'theme tag', many: 'theme tags', hint: 'The Themes page will be empty.', keeps: 'Highlights and notes stay.' },
    ] as const;
    type Kind = (typeof KINDS)[number];
    type KindType = Kind['type'];

    let counts = $state<Record<KindType, number> | null>(null);
    let confirming = $state<{ type: KindType; noBackup: boolean } | null>(null);
    let busy = $state(false);
    let root: HTMLDivElement | undefined = $state();

    $effect(() => {
        const sub = observeAnnotationCounts(KINDS.map((k) => k.type)).subscribe({ next: (c) => (counts = c) });
        return () => sub.unsubscribe();
    });

    // Another tab (or an undo) can empty the kind while its confirm is open
    $effect(() => {
        if (confirming && counts && counts[confirming.type] === 0 && !busy) confirming = null;
    });

    const noun = (k: Kind, n: number) => `${n.toLocaleString()} ${n === 1 ? k.one : k.many}`;

    function hint(k: Kind): string {
        const n = counts?.[k.type];
        const count = n === undefined ? 'Counting…' : n === 0 ? `No ${k.many}.` : `${noun(k, n)}.`;
        return k.hint ? `${count} ${k.hint}` : count;
    }

    const focusIn = (selector: string) => root?.querySelector<HTMLElement>(selector)?.focus();

    async function open(type: KindType) {
        if (confirming?.type === type) return cancel();
        const noBackup = (await lastExportAt()) === null;
        confirming = { type, noBackup };
        await tick();
        focusIn('[data-clear-cancel]');
    }

    async function cancel() {
        const type = confirming?.type;
        confirming = null;
        await tick();
        if (type) focusIn(`[data-clear="${type}"]`);
    }

    async function confirmDelete(k: Kind) {
        busy = true;
        try {
            const removed = await deleteAnnotationsOfType(k.type);
            confirming = null;
            onChange?.();
            // The row's button is now disabled, so keep focus in the group rather than dropping it to the body
            await tick();
            focusIn('#clears-heading');
            if (removed.length === 0) return;
            const what = noun(k, removed.length);
            toast.show(`${what} deleted`, {
                action: {
                    label: 'Undo',
                    run: async () => {
                        await restoreAnnotations(removed);
                        onChange?.();
                        toast.show(`${what} restored`);
                    },
                },
            });
        } catch (err) {
            toast.show(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            busy = false;
        }
    }

    function onKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape' && confirming && !busy) {
            e.preventDefault();
            cancel();
        }
    }
</script>

<!-- Escape bubbles up from whichever button in an open confirm has focus -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="clears" role="group" aria-labelledby="clears-heading" bind:this={root} onkeydown={onKeydown}>
    <h3 class="group" id="clears-heading" tabindex="-1">Clear annotations</h3>
    {#each KINDS as k (k.type)}
        {@const n = counts?.[k.type] ?? 0}
        {@const isOpen = confirming?.type === k.type}
        <SettingRow label={k.label} hint={hint(k)}>
            <Button
                variant="danger"
                data-clear={k.type}
                aria-label="Delete all {k.many}"
                aria-expanded={isOpen}
                aria-controls={isOpen ? `clear-confirm-${k.type}` : undefined}
                disabled={n === 0 || (busy && !isOpen)}
                onclick={() => open(k.type)}
            >Delete all</Button>
            {#snippet below()}
                {#if isOpen && confirming}
                    <div class="confirm" id="clear-confirm-{k.type}">
                        <p class="confirm-msg" role="alert">
                            Delete {noun(k, n)}? {k.keeps}
                            {#if confirming.noBackup}<span class="confirm-warn">You have not exported a backup yet.</span>{/if}
                        </p>
                        <div class="confirm-actions">
                            <Button variant="danger" size="sm" loading={busy} onclick={() => confirmDelete(k)}>Delete {noun(k, n)}</Button>
                            <Button variant="ghost" size="sm" data-clear-cancel disabled={busy} onclick={cancel}>Cancel</Button>
                        </div>
                    </div>
                {/if}
            {/snippet}
        </SettingRow>
    {/each}
</div>

<style>
    .clears {
        border-bottom: 1px solid var(--color-border-subtle);
    }
    .group {
        width: fit-content;
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: var(--color-text-primary);
        padding: var(--space-3) 0 var(--space-1);
    }
    .confirm {
        margin-top: var(--space-2);
        padding: var(--space-3) var(--space-4);
        border: 1px solid color-mix(in srgb, var(--color-danger) 45%, transparent);
        border-radius: var(--radius-md);
        background: color-mix(in srgb, var(--color-danger) 6%, var(--color-bg-surface));
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }
    .confirm-msg {
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
    }
    .confirm-warn {
        display: block;
        margin-top: 2px;
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
    }
    .confirm-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
    }
</style>
