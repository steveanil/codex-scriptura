<script lang="ts">
    import { page } from '$app/state';
    import { getThemes, getThemeAnnotations, deleteAnnotation, getChapter, type ThemeSummary } from '@codex-scriptura/db';
    import { BOOKS, findBook } from '@codex-scriptura/core';
    import type { Annotation, VerseRecord } from '@codex-scriptura/core';
    import { preferences } from '$lib/stores/preferences.svelte';

    const BOOK_ORDER = new Map(BOOKS.map((b, i) => [b.osisId, i]));

    let slug = $derived(page.url.searchParams.get('t'));

    // ── Theme index (no ?t) ───────────────────────────────
    let themes = $state<ThemeSummary[]>([]);

    // ── Thread view (?t=slug) ─────────────────────────────
    type ThreadEntry = {
        annotation: Annotation;
        book: string;
        bookName: string;
        chapter: number;
        verseStart: number;
        verseEnd: number;
        text: string;
    };
    let threadLabel = $state('');
    let thread = $state<ThreadEntry[]>([]);
    let loading = $state(true);

    function parseRef(osis: string): { book: string; chapter: number; verse: number } {
        const [book, ch, v] = osis.split('.');
        return { book, chapter: parseInt(ch, 10), verse: parseInt(v, 10) };
    }

    async function loadThread(s: string) {
        loading = true;
        const annotations = await getThemeAnnotations(s);
        threadLabel = annotations.length > 0
            ? annotations.reduce((a, b) => (a.modified > b.modified ? a : b)).data || s
            : s;

        // Canonical order: book position, then chapter, then verse
        annotations.sort((a, b) => {
            const ra = parseRef(a.verseStart);
            const rb = parseRef(b.verseStart);
            const bo = (BOOK_ORDER.get(ra.book) ?? 99) - (BOOK_ORDER.get(rb.book) ?? 99);
            if (bo !== 0) return bo;
            if (ra.chapter !== rb.chapter) return ra.chapter - rb.chapter;
            return ra.verse - rb.verse;
        });

        const translationId = preferences.value?.activeTranslation ?? 'KJV';
        const chapterCache = new Map<string, VerseRecord[]>();
        const entries: ThreadEntry[] = [];

        for (const annotation of annotations) {
            const start = parseRef(annotation.verseStart);
            const end = parseRef(annotation.verseEnd);
            const cacheKey = `${start.book}.${start.chapter}`;
            let verses = chapterCache.get(cacheKey);
            if (!verses) {
                verses = await getChapter(translationId, start.book, start.chapter);
                chapterCache.set(cacheKey, verses);
            }
            // Bridged records (verseEnd on the VerseRecord) count if the ranges overlap
            const text = verses
                .filter(v => v.verse <= end.verse && (v.verseEnd ?? v.verse) >= start.verse)
                .map(v => v.text)
                .join(' ');
            entries.push({
                annotation,
                book: start.book,
                bookName: findBook(start.book)?.name ?? start.book,
                chapter: start.chapter,
                verseStart: start.verse,
                verseEnd: end.verse,
                text,
            });
        }
        thread = entries;
        loading = false;
    }

    async function loadIndex() {
        loading = true;
        themes = await getThemes();
        loading = false;
    }

    $effect(() => {
        if (slug) loadThread(slug);
        else loadIndex();
    });

    async function removeEntry(entry: ThreadEntry) {
        await deleteAnnotation(entry.annotation.id);
        if (slug) await loadThread(slug);
    }

    function refLabel(e: ThreadEntry): string {
        return e.verseStart === e.verseEnd
            ? `${e.bookName} ${e.chapter}:${e.verseStart}`
            : `${e.bookName} ${e.chapter}:${e.verseStart}–${e.verseEnd}`;
    }
</script>

<svelte:head>
    <title>{slug ? `${threadLabel} - Themes` : 'Themes'} - Codex Scriptura</title>
</svelte:head>

<div class="themes-page">
    <div class="themes-container">
        {#if slug}
            <!-- ── Thread view ── -->
            <div class="themes-header">
                <a class="back-link" href="/themes">&larr; All themes</a>
                <h1 class="themes-title">{threadLabel}</h1>
                {#if !loading}
                    <p class="themes-sub">{thread.length} tagged passage{thread.length === 1 ? '' : 's'} in canonical order</p>
                {/if}
            </div>

            {#if loading}
                <div class="state"><div class="loading-spinner"></div></div>
            {:else if thread.length === 0}
                <div class="state">
                    <p>Nothing is tagged with this theme yet.</p>
                    <p class="hint">Select verses in the reader and choose <strong>Theme</strong> from the toolbar.</p>
                </div>
            {:else}
                {#each thread as entry, i (entry.annotation.id)}
                    {#if i === 0 || thread[i - 1].book !== entry.book}
                        <h2 class="book-divider">{entry.bookName}</h2>
                    {/if}
                    <div class="thread-card">
                        <div class="thread-card-header">
                            <a
                                class="thread-ref"
                                href="/read?book={entry.book}&chapter={entry.chapter}#verse-{entry.verseStart}"
                                title="Read in context"
                            >{refLabel(entry)} &nearr;</a>
                            <button class="thread-remove" onclick={() => removeEntry(entry)} title="Remove from this theme">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M18 6L6 18M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <p class="thread-text">{entry.text || 'Verse text not available in the active translation.'}</p>
                    </div>
                {/each}
            {/if}
        {:else}
            <!-- ── Theme index ── -->
            <div class="themes-header">
                <h1 class="themes-title">Themes</h1>
                <p class="themes-sub">Your topical threads across the whole Bible</p>
            </div>

            {#if loading}
                <div class="state"><div class="loading-spinner"></div></div>
            {:else if themes.length === 0}
                <div class="state">
                    <p>No themes yet.</p>
                    <p class="hint">Select verses in the reader and choose <strong>Theme</strong> from the toolbar to start a thread - "covenant", "resurrection", "faith" - then follow it across the whole Bible here.</p>
                </div>
            {:else}
                <div class="theme-grid">
                    {#each themes as t (t.slug)}
                        <a class="theme-card" href="/themes?t={t.slug}">
                            <span class="theme-card-label">{t.label}</span>
                            <span class="theme-card-count">{t.count} passage{t.count === 1 ? '' : 's'}</span>
                        </a>
                    {/each}
                </div>
            {/if}
        {/if}
    </div>
</div>

<style>
    .themes-page {
        height: 100%;
        overflow-y: auto;
        background: var(--color-bg);
    }
    .themes-container {
        max-width: 720px;
        margin: 0 auto;
        padding: var(--space-8) var(--space-4) var(--space-12);
    }
    .themes-header {
        margin-bottom: var(--space-6);
    }
    .themes-title {
        font-family: var(--font-ui);
        font-size: var(--font-size-2xl);
        font-weight: 600;
        color: var(--color-text-primary);
        margin: 0;
    }
    .themes-sub {
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        color: var(--color-text-muted);
        margin: var(--space-1) 0 0;
    }
    .back-link {
        display: inline-block;
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        color: var(--color-text-muted);
        text-decoration: none;
        margin-bottom: var(--space-2);
    }
    .back-link:hover { color: var(--color-accent); }

    .state {
        text-align: center;
        padding: var(--space-10) 0;
        font-family: var(--font-ui);
        color: var(--color-text-secondary);
    }
    .hint {
        font-size: var(--font-size-sm);
        color: var(--color-text-muted);
        max-width: 420px;
        margin: var(--space-2) auto 0;
    }
    .loading-spinner {
        width: 24px;
        height: 24px;
        margin: 0 auto;
        border: 2px solid var(--color-border);
        border-top-color: var(--color-accent);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Theme index grid ── */
    .theme-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: var(--space-3);
    }
    .theme-card {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: var(--space-4);
        text-decoration: none;
        transition: border-color 0.15s ease, background 0.15s ease;
    }
    .theme-card:hover {
        border-color: var(--color-accent);
        background: var(--color-bg-hover);
    }
    .theme-card-label {
        font-family: var(--font-ui);
        font-size: var(--font-size-base);
        font-weight: 600;
        color: var(--color-text-primary);
    }
    .theme-card-count {
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
    }

    /* ── Thread view ── */
    .book-divider {
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--color-text-muted);
        margin: var(--space-6) 0 var(--space-3);
        padding-bottom: var(--space-1);
        border-bottom: 1px solid var(--color-border-subtle);
    }
    .thread-card {
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: var(--space-4);
        margin-bottom: var(--space-3);
    }
    .thread-card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--space-2);
    }
    .thread-ref {
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: var(--color-accent);
        text-decoration: none;
    }
    .thread-ref:hover { text-decoration: underline; }
    .thread-remove {
        background: none;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        padding: var(--space-1);
        border-radius: var(--radius-sm);
        display: flex;
    }
    .thread-remove:hover { color: #ef4444; }
    .thread-text {
        font-family: var(--font-reader);
        font-size: var(--font-size-base);
        line-height: 1.7;
        color: var(--color-text-secondary);
        margin: 0;
    }
</style>
