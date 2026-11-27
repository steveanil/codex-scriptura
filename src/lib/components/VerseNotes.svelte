<script lang="ts">
    import type { VerseNote } from '@codex-scriptura/core';
    import { footnoteLetter, noteLeadIn } from '$lib/utils/footnotes';

    /**
     * A verse's translator notes, opened from a footnote callout (issue #39).
     * Sits directly under the verse like the quotation row. Notes are runs of
     * plain text, never HTML; passage links navigate like cross-reference pills.
     */
    let {
        notes,
        active,
        onNavigate,
        onClose,
    }: {
        notes: VerseNote[];
        /** Index of the note whose callout was clicked. */
        active: number;
        onNavigate: (osisId: string) => void;
        /** Escape inside the row. */
        onClose: () => void;
    } = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
    class="verse-notes"
    role="region"
    aria-label="Footnotes"
    onkeydown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}
>
    <span class="verse-notes-label">Notes</span>
    <ol class="verse-notes-list">
        {#each notes as note, i (i)}
            <li class:active={i === active} aria-current={i === active ? 'true' : undefined}>
                <span class="verse-notes-letter">{footnoteLetter(i)}</span>
                <span class="verse-notes-body">{#if note.verse !== undefined}<span class="verse-notes-verse">v. {note.verse}</span>{' '}{/if}{noteLeadIn(note)}{#each note.runs as run, r (r)}{#if typeof run === 'string'}{run}{:else if 'ref' in run}<button type="button" class="verse-notes-ref" onclick={() => onNavigate(run.ref)}>{run.t}</button>{:else if run.s === 'catch'}<strong>{run.t}</strong>{:else}<em>{run.t}</em>{/if}{/each}</span>
            </li>
        {/each}
    </ol>
</div>

<style>
    .verse-notes {
        display: flex;
        align-items: baseline;
        gap: var(--space-2);
        padding: var(--space-1) 0 var(--space-1) 20px;
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: var(--color-text-secondary);
    }
    .verse-notes-label {
        font-size: var(--font-size-2xs);
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--color-text-muted);
        white-space: nowrap;
        flex-shrink: 0;
    }
    .verse-notes-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        min-width: 0;
    }
    .verse-notes-list li {
        display: flex;
        gap: var(--space-2);
    }
    .verse-notes-list li.active {
        color: var(--color-text-primary);
    }
    .verse-notes-letter {
        font-size: var(--font-size-xs);
        font-weight: 600;
        color: var(--color-verse-number);
        flex-shrink: 0;
        min-width: 1ch;
    }
    /* The omitted verse a carried-over note stands for */
    .verse-notes-verse {
        font-size: var(--font-size-xs);
        font-weight: 600;
        color: var(--color-verse-number);
        white-space: nowrap;
    }
    .verse-notes-list li.active .verse-notes-letter {
        color: var(--color-accent);
    }
    .verse-notes-body strong {
        font-weight: 600;
        color: var(--color-text-primary);
    }
    .verse-notes-ref {
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        color: var(--color-accent);
        cursor: pointer;
        text-decoration: underline;
        text-decoration-thickness: 1px;
        text-underline-offset: 2px;
    }
</style>
