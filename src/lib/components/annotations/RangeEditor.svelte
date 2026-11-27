<script lang="ts">
    import { findBook, parseOsisId } from '@codex-scriptura/core';
    import type { LastVerses } from '$lib/annotations/edit';

    /**
     * Start and end verse inside one book (issue #322): chapter and verse
     * pickers, never free text, so the ids are well formed. Whether the
     * range is valid as a whole is the edit module's call; the owner shows
     * its message.
     */
    let {
        book,
        start = $bindable(),
        end = $bindable(),
        lastVerses,
    }: {
        book: string;
        start: string;
        end: string;
        /** Null while loading. */
        lastVerses: LastVerses | null;
    } = $props();

    const uid = $props.id();
    let bookName = $derived(findBook(book)?.name ?? book);
    let from = $derived(parseOsisId(start) ?? { book, chapter: 1, verse: 1 });
    let to = $derived(parseOsisId(end) ?? from);

    // The record's own chapters stay listed even if this translation
    // lacks them, so the pickers never silently show a different value.
    function chapters(current: number): number[] {
        const known = Object.keys(lastVerses ?? {}).map(Number);
        if (!known.includes(current)) known.push(current);
        return known.sort((a, b) => a - b);
    }

    function verses(chapter: number, current: number): number[] {
        const last = Math.max(lastVerses?.[chapter] ?? 0, current);
        return Array.from({ length: last }, (_, i) => i + 1);
    }

    function osis(chapter: number, verse: number): string {
        const last = lastVerses?.[chapter];
        return `${book}.${chapter}.${last ? Math.min(verse, last) : verse}`;
    }
</script>

<fieldset class="range-editor" disabled={!lastVerses}>
    <legend>Verses in {bookName}{lastVerses ? '' : ' (loading…)'}</legend>
    <div class="row">
        <label for="{uid}-sc">From</label>
        <select id="{uid}-sc" aria-label="Start chapter" value={from.chapter}
            onchange={(e) => (start = osis(Number(e.currentTarget.value), from.verse))}>
            {#each chapters(from.chapter) as c (c)}<option value={c}>{c}</option>{/each}
        </select>
        <span class="sep" aria-hidden="true">:</span>
        <select aria-label="Start verse" value={from.verse}
            onchange={(e) => (start = osis(from.chapter, Number(e.currentTarget.value)))}>
            {#each verses(from.chapter, from.verse) as v (v)}<option value={v}>{v}</option>{/each}
        </select>
    </div>
    <div class="row">
        <label for="{uid}-ec">To</label>
        <select id="{uid}-ec" aria-label="End chapter" value={to.chapter}
            onchange={(e) => (end = osis(Number(e.currentTarget.value), to.verse))}>
            {#each chapters(to.chapter) as c (c)}<option value={c}>{c}</option>{/each}
        </select>
        <span class="sep" aria-hidden="true">:</span>
        <select aria-label="End verse" value={to.verse}
            onchange={(e) => (end = osis(to.chapter, Number(e.currentTarget.value)))}>
            {#each verses(to.chapter, to.verse) as v (v)}<option value={v}>{v}</option>{/each}
        </select>
    </div>
</fieldset>

<style>
    .range-editor {
        border: none;
        margin: 0;
        padding: 0;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }
    legend {
        padding: 0;
        margin-bottom: var(--space-2);
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        font-weight: 500;
    }
    .row { display: flex; align-items: center; gap: var(--space-2); }
    label {
        width: 2.5rem;
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
    }
    select {
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        padding: var(--space-1) var(--space-2);
        min-width: 4rem;
    }
    select:disabled { opacity: 0.6; }
    .sep { color: var(--color-text-muted); }
</style>
