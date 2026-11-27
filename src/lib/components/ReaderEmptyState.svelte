<script lang="ts">
    import type { Translation } from '@codex-scriptura/core';
    import { findBook } from '@codex-scriptura/core';
    import type { PaneState } from '$lib/stores/splitPanes.svelte';
    import { preferences } from '$lib/stores/preferences.svelte';
    import { translationLibrary, requestPaneTranslation } from '$lib/stores/translationLibrary.svelte';
    import { emptyChapterReason } from '$lib/utils/chapterAvailability';
    import { rankTranslationsForBook } from '$lib/utils/translationSelection';
    import Button from '$lib/components/ui/Button.svelte';

    // Rendered by ReaderPane only while its chapter has no verses.
    let { pane }: { pane: PaneState } = $props();

    const bookId = $derived(pane.book);
    const bookName = $derived(findBook(pane.book)?.name ?? pane.book);
    const chapter = $derived(pane.chapter);
    const translationId = $derived(pane.translation);

    // A deep link can land on a book this translation never had (OEB is a
    // partial canon). Say which of the three reasons applies and, for a
    // coverage gap, offer the installed translations that do have the book,
    // the stored preference first (issue #404).
    const emptyReason = $derived(emptyChapterReason(pane.availableBooks, bookId));
    const translationMeta = $derived(translationLibrary.catalog.find((t) => t.id === translationId));
    const translationAbbr = $derived(translationMeta?.abbreviation ?? translationId);
    let coveringTranslations = $state<Translation[]>([]);
    let coveringGeneration = 0;
    $effect(() => {
        const book = bookId;
        const current = translationId;
        const preferredId = preferences.value?.activeTranslation;
        const gen = ++coveringGeneration;
        // installedCoverage reads the catalog and install set synchronously
        // before its first await, so a download finishing re-runs this.
        (async () => {
            const coverage = await translationLibrary.installedCoverage();
            if (gen !== coveringGeneration) return;
            coveringTranslations = rankTranslationsForBook(book, coverage, { preferredId, excludeIds: [current] });
        })();
    });
</script>

<div class="reader-empty" role="status">
    {#if emptyReason === 'book-not-covered'}
        <p class="reader-empty-title">{translationAbbr} does not include {bookName}</p>
        {#if translationMeta?.coverage}
            <p class="reader-empty-note">{translationMeta.name} is a partial translation ({translationMeta.coverage}). The missing books are an upstream fact, not a download problem.</p>
        {/if}
        {#if coveringTranslations.length > 0}
            <p class="reader-empty-note">Read {bookName} {chapter} in another installed translation:</p>
            <div class="reader-empty-actions">
                {#each coveringTranslations as t (t.id)}
                    <Button size="sm" variant="secondary" onclick={() => requestPaneTranslation(pane, t.id)}>Open in {t.abbreviation}</Button>
                {/each}
            </div>
        {:else}
            <p class="reader-empty-note">No installed translation has {bookName}.</p>
            <a class="reader-empty-link" href="/settings#library">Download one in Settings</a>
        {/if}
    {:else if emptyReason === 'translation-missing'}
        <p class="reader-empty-title">{translationAbbr} has no text on this device</p>
        <p class="reader-empty-note">Its download was interrupted or it was removed.</p>
        <a class="reader-empty-link" href="/settings#library">Re-download {translationAbbr} in Settings</a>
    {:else}
        <p class="reader-empty-title">{bookName} {chapter} has no verses in {translationAbbr} on this device</p>
        <p class="reader-empty-note">{translationAbbr} includes {bookName}, so this chapter's data is damaged or incomplete.</p>
        <a class="reader-empty-link" href="/settings#library">Re-download {translationAbbr} in Settings</a>
    {/if}
</div>

<style>
    .reader-empty {
        max-width: var(--scripture-measure);
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-3);
        text-align: center;
        padding-top: var(--space-12);
        color: var(--color-text-muted);
    }
    .reader-empty-title {
        margin: 0;
        color: var(--color-text-primary);
    }
    .reader-empty-note {
        margin: 0;
        max-width: 44ch;
        font-size: var(--font-size-sm);
    }
    .reader-empty-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: var(--space-2);
    }
    .reader-empty-link {
        font-size: var(--font-size-sm);
        color: var(--color-accent);
    }
</style>
