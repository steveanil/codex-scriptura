<script lang="ts">
    import { preferences } from '$lib/stores/preferences.svelte';
    import { translationLibrary } from '$lib/stores/translationLibrary.svelte';
    import { getSplitToggles, updateSplitToggles, type SplitToggles } from '$lib/stores/splitPanes.svelte';
    import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
    import type { SegmentOption } from '$lib/components/ui/segmented';
    import SettingsCard from './SettingsCard.svelte';
    import SettingRow from './SettingRow.svelte';
    import { findBook } from '@codex-scriptura/core';
    import type { VerseRecord } from '@codex-scriptura/core';
    import { getBookList, getChapter } from '@codex-scriptura/db';
    import { renderVerseHtml, parseWjRanges } from '$lib/utils/verse-render';
    import { onMount } from 'svelte';

    const prefs = $derived(preferences.value);

    const STARTUP_OPTIONS: SegmentOption<'last' | 'fixed'>[] = [
        { value: 'last', label: 'Last read' }, { value: 'fixed', label: 'Fixed passage' },
    ];
    const COLUMN_OPTIONS: SegmentOption<'narrow' | 'medium' | 'wide'>[] = [
        { value: 'narrow', label: 'Narrow' }, { value: 'medium', label: 'Medium' }, { value: 'wide', label: 'Wide' },
    ];
    const DENSITY_OPTIONS: SegmentOption<'compact' | 'normal' | 'relaxed'>[] = [
        { value: 'compact', label: 'Compact' }, { value: 'normal', label: 'Normal' }, { value: 'relaxed', label: 'Relaxed' },
    ];
    const LAYOUT_OPTIONS: SegmentOption<'prose' | 'lines'>[] = [
        { value: 'prose', label: 'Prose' }, { value: 'lines', label: 'Verse per line' },
    ];
    const SHOW_HIDE: SegmentOption<'show' | 'hide'>[] = [{ value: 'show', label: 'Show' }, { value: 'hide', label: 'Hide' }];
    const ON_OFF: SegmentOption<'on' | 'off'>[] = [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }];

    function updateReader(patch: Partial<NonNullable<typeof prefs>['reader']>) {
        if (!prefs) return;
        preferences.update({ reader: { ...prefs.reader, ...patch } });
    }
    function updateFonts(patch: Partial<NonNullable<typeof prefs>['fonts']>) {
        if (!prefs) return;
        preferences.update({ fonts: { ...prefs.fonts, ...patch } });
    }

    // ── Specimen: the first verses of the active translation, drawn with the
    //    same tokens the reader uses, so every control below shows its effect ──
    let specimen = $state<VerseRecord[]>([]);
    let specimenRef = $state('');
    let specimenFor: string | null = null;
    $effect(() => {
        const t = prefs?.activeTranslation;
        if (!t || t === specimenFor) return;
        specimenFor = t;
        (async () => {
            let verses = await getChapter(t, 'Gen', 1);
            let book = 'Gen';
            if (verses.length === 0) {
                // Partial canons (OEB) may lack Genesis: take the first book they have
                const books = await getBookList(t);
                book = books[0] ?? 'Gen';
                verses = await getChapter(t, book, 1);
            }
            specimen = verses.slice(0, 3);
            specimenRef = `${findBook(book)?.name ?? book} 1`;
        })();
    });

    // ── Default translation, startup ──
    const installedTranslations = $derived(translationLibrary.catalog.filter((t) => translationLibrary.isInstalled(t.id)));
    const startup = $derived(prefs?.startup ?? { mode: 'last' as const, book: prefs?.lastBook ?? 'Gen', chapter: prefs?.lastChapter ?? 1 });
    const startupMaxChapters = $derived(findBook(startup.book)?.chapters ?? 150);
    let startupBooks = $state<{ osisId: string; name: string }[]>([]);
    let booksLoadedFor: string | null = null;
    $effect(() => {
        const t = prefs?.activeTranslation;
        if (!t || t === booksLoadedFor) return;
        booksLoadedFor = t;
        getBookList(t).then((ids) => { startupBooks = ids.map((id) => ({ osisId: id, name: findBook(id)?.name ?? id })); });
    });
    const startupBookOptions = $derived(
        startupBooks.some((b) => b.osisId === startup.book)
            ? startupBooks
            : [...startupBooks, { osisId: startup.book, name: findBook(startup.book)?.name ?? startup.book }]
    );
    function setStartupBook(e: Event) {
        const book = (e.currentTarget as HTMLSelectElement).value;
        const max = findBook(book)?.chapters ?? 150;
        preferences.update({ startup: { ...startup, book, chapter: Math.min(startup.chapter, max) } });
    }
    function setStartupChapter(e: Event) {
        const raw = parseInt((e.currentTarget as HTMLInputElement).value, 10);
        if (Number.isNaN(raw)) return;
        preferences.update({ startup: { ...startup, chapter: Math.min(Math.max(raw, 1), startupMaxChapters) } });
    }

    // ── Split-view toggles (kv) ──
    let splitToggles = $state<SplitToggles | null>(null);
    onMount(() => { getSplitToggles().then((t) => { splitToggles = t; }); });
    function setSplitToggle(key: keyof SplitToggles, value: boolean) {
        if (!splitToggles) return;
        splitToggles = { ...splitToggles, [key]: value };
        updateSplitToggles({ [key]: value });
    }

    // Red letter has one source today: WEB carries <wj> markup.
    const redLetterAvailable = $derived(translationLibrary.isInstalled('WEB'));
</script>

{#if prefs}
<SettingsCard id="reader" kicker="Reader">
    <div class="specimen" class:verse-per-line={!prefs.reader.paragraphMode} class:hide-verse-numbers={!prefs.reader.showVerseNumbers}>
        <div class="cap"><span>Preview · {prefs.activeTranslation} · {specimenRef}</span><span>reflects every control below</span></div>
        {#if specimen.length === 0}
            <p class="specimen-empty">Loading a preview…</p>
        {:else}
            <p class="specimen-text">
                {#each specimen as v (v.id)}<span class="verse"><sup class="verse-num">{v.verse}</sup>{@html renderVerseHtml(v.text, [], parseWjRanges(v.wj), { redLetters: prefs.reader.showRedLetters, lineageActiveId: null })}</span>{' '}{/each}
            </p>
        {/if}
    </div>

    <SettingRow label="Translation" labelFor="default-translation" hint="What the reader opens with; switching inside the reader updates this too">
        {#if installedTranslations.length > 0}
            <select id="default-translation" class="select-input" value={prefs.activeTranslation} onchange={(e) => preferences.update({ activeTranslation: (e.currentTarget as HTMLSelectElement).value })}>
                {#each installedTranslations as t (t.id)}<option value={t.id}>{t.abbreviation} - {t.name}</option>{/each}
            </select>
        {:else}
            <span class="muted">Loading…</span>
        {/if}
    </SettingRow>

    <SettingRow label="Open at launch" hint="Where the reader starts when you open the app">
        <SegmentedControl label="Open at launch" options={STARTUP_OPTIONS} value={startup.mode} onchange={(mode) => preferences.update({ startup: { ...startup, mode } })} />
    </SettingRow>
    {#if startup.mode === 'fixed'}
        <SettingRow label="Passage" labelFor="startup-book">
            <select id="startup-book" class="select-input" value={startup.book} onchange={setStartupBook}>
                {#each startupBookOptions as b (b.osisId)}<option value={b.osisId}>{b.name}</option>{/each}
            </select>
            <input id="startup-chapter" type="number" class="chapter-input" min="1" max={startupMaxChapters} value={startup.chapter} onchange={setStartupChapter} aria-label="Chapter" />
        </SettingRow>
    {/if}

    <SettingRow label="Column width" hint="Measure of the scripture column: 560, 720 or 900px">
        <SegmentedControl label="Column width" options={COLUMN_OPTIONS} value={prefs.reader.columnWidth} onchange={(w) => updateReader({ columnWidth: w })} />
    </SettingRow>

    <SettingRow label="Scripture size" labelFor="font-size" hint="Only the scripture column; the interface keeps its own scale">
        <input id="font-size" type="range" min="12" max="26" step="1" value={prefs.fonts.size} oninput={(e) => updateFonts({ size: parseInt((e.currentTarget as HTMLInputElement).value, 10) })} class="range-input" />
        <span class="val">{prefs.fonts.size}px</span>
    </SettingRow>

    <SettingRow label="Line spacing" labelFor="line-height">
        <input id="line-height" type="range" min="1.2" max="2.5" step="0.1" value={prefs.reader.lineHeight} oninput={(e) => updateReader({ lineHeight: parseFloat((e.currentTarget as HTMLInputElement).value) })} class="range-input" />
        <span class="val">{prefs.reader.lineHeight.toFixed(1)}</span>
    </SettingRow>

    <SettingRow label="Density" hint="Row height of lists, panels and menus; the scripture column is not affected">
        <SegmentedControl label="Density" options={DENSITY_OPTIONS} value={prefs.reader.density} onchange={(d) => updateReader({ density: d })} />
    </SettingRow>

    <SettingRow label="Verse numbers">
        <SegmentedControl label="Verse numbers" options={SHOW_HIDE} value={prefs.reader.showVerseNumbers ? 'show' : 'hide'} onchange={(v) => updateReader({ showVerseNumbers: v === 'show' })} />
    </SettingRow>

    <SettingRow label="Reading speed" labelFor="reading-speed" hint="For the reading-time estimate in the passage picker">
        <input id="reading-speed" type="range" min="100" max="400" step="25" value={prefs.readingSpeed ?? 200} oninput={(e) => preferences.update({ readingSpeed: parseInt((e.currentTarget as HTMLInputElement).value, 10) })} class="range-input" />
        <span class="val">{prefs.readingSpeed ?? 200} wpm</span>
    </SettingRow>

    <SettingRow label="Paragraph mode" hint="Prose is the default; split view uses verse-per-line so lines align">
        <SegmentedControl label="Paragraph mode" options={LAYOUT_OPTIONS} value={prefs.reader.paragraphMode ? 'prose' : 'lines'} onchange={(v) => updateReader({ paragraphMode: v === 'prose' })} />
    </SettingRow>

    <SettingRow label="Red letter" hint="Words of Jesus in red (WEB)">
        <span class:cond-disabled={!redLetterAvailable}>
            <SegmentedControl label="Red letter" options={ON_OFF} value={prefs.reader.showRedLetters ? 'on' : 'off'} onchange={(v) => updateReader({ showRedLetters: v === 'on' })} />
        </span>
        {#snippet below()}
            {#if !redLetterAvailable}
                <p class="cond"><b>Unavailable</b> Requires WEB, which is not installed. <a href="#library">Install WEB</a></p>
            {/if}
        {/snippet}
    </SettingRow>

    {#if splitToggles}
        <SettingRow label="Cross-references" hint="Count badge after each verse with linked passages (also in the reader's Layers menu)">
            <SegmentedControl label="Cross-references" options={SHOW_HIDE} value={splitToggles.showRefs ? 'show' : 'hide'} onchange={(v) => setSplitToggle('showRefs', v === 'show')} />
        </SettingRow>
        <SettingRow label="Divergence shading" hint="Shade words that differ across the translations open in split view">
            <SegmentedControl label="Divergence shading" options={ON_OFF} value={splitToggles.showDivergence ? 'on' : 'off'} onchange={(v) => setSplitToggle('showDivergence', v === 'on')} />
        </SettingRow>
        <SettingRow label="Synced scrolling" hint="Scroll split-view panes together">
            <SegmentedControl label="Synced scrolling" options={ON_OFF} value={splitToggles.syncScroll ? 'on' : 'off'} onchange={(v) => setSplitToggle('syncScroll', v === 'on')} />
        </SettingRow>
    {/if}
</SettingsCard>
{/if}

<style>
    /* Raised on the page background so it reads as a slice of the reader */
    .specimen {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg);
        padding: var(--space-5) var(--space-6);
        margin: var(--space-4) 0 var(--space-3);
    }
    .cap {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        font-family: var(--font-mono);
        font-size: var(--font-size-2xs);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-text-muted);
        margin-bottom: var(--space-3);
    }
    .specimen-text {
        font-family: var(--font-scripture);
        font-size: var(--scripture-size);
        line-height: var(--scripture-leading);
        color: var(--color-text-primary);
        max-width: var(--scripture-measure);
        text-wrap: pretty;
    }
    .specimen-empty {
        color: var(--color-text-muted);
        font-size: var(--font-size-xs);
    }
    .verse-num {
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 600;
        color: var(--color-verse-number);
        margin-right: 2px;
        vertical-align: super;
        line-height: 1;
    }
    .hide-verse-numbers .verse-num { display: none; }
    .verse-per-line .verse { display: block; }
    .specimen :global(.wj) { color: var(--color-red-letter, #dc2626); }
    :global([data-theme="dark"]) .specimen :global(.wj) { color: var(--color-red-letter-dark, #ef4444); }

    .select-input {
        appearance: none;
        height: var(--row-h-sm);
        padding: 0 calc(var(--space-3) + 20px) 0 var(--space-3);
        background-color: var(--color-bg-control);
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237a8494' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right var(--space-3) center;
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        cursor: pointer;
        min-width: 160px;
    }
    .select-input:hover { background-color: var(--color-bg-control-hover); }
    .chapter-input {
        width: 72px;
        height: var(--row-h-sm);
        background: var(--color-bg-control);
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-sm);
        padding: 0 var(--space-2);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-variant-numeric: tabular-nums;
    }
    .range-input {
        width: 180px;
        accent-color: var(--color-accent);
        cursor: pointer;
    }
    .val {
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        min-width: 52px;
        text-align: right;
    }
    .muted { color: var(--color-text-muted); font-size: var(--font-size-xs); }
    /* ConditionalControl: full contrast, no hover, the reason underneath */
    .cond-disabled {
        pointer-events: none;
    }
    .cond {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        padding: var(--space-1) 0 0;
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
    }
    .cond b {
        color: var(--color-warning);
        font-weight: 500;
    }
    @media (max-width: 768px) {
        .specimen { padding: var(--space-4); }
        .select-input, .range-input { width: 100%; }
    }
</style>
