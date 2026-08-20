<script lang="ts">
    import { onMount } from 'svelte';
    import { preferences } from '$lib/stores/preferences.svelte';
    import { ui } from '$lib/stores/ui.svelte';
    import { WHATS_NEW } from '$lib/whats-new';
    import { translationLibrary } from '$lib/stores/translationLibrary.svelte';
    import { getSplitToggles, updateSplitToggles, type SplitToggles } from '$lib/stores/splitPanes.svelte';
    import Button from '$lib/components/ui/Button.svelte';
    import { findBook } from '@codex-scriptura/core';
    import type { HighlightPreset, Translation } from '@codex-scriptura/core';
    import { getBookList } from '@codex-scriptura/db';

    // ── About & feedback ─────────────────────────────────
    const FEEDBACK_EMAIL = 'steveanil2003@gmail.com';
    const feedbackHref = `mailto:${FEEDBACK_EMAIL}`
        + `?subject=${encodeURIComponent('Codex Scriptura feedback')}`
        + `&body=${encodeURIComponent(`App update: ${WHATS_NEW[0].id}\nWhat I was doing:\n\nWhat happened:\n`)}`;

    let prefs = $derived(preferences.value);

    // ── Storage ───────────────────────────────────────────
    // The app's library lives in IndexedDB; without persistence the browser
    // may evict it under storage pressure. The layout requests persistence
    // at boot - this panel surfaces the outcome and offers a manual retry.
    let storagePersisted = $state<boolean | null>(null);
    let storageUsage = $state<{ usage: number; quota: number } | null>(null);

    async function refreshStorageInfo() {
        try {
            if (navigator.storage?.persisted) {
                storagePersisted = await navigator.storage.persisted();
            }
            if (navigator.storage?.estimate) {
                const est = await navigator.storage.estimate();
                storageUsage = { usage: est.usage ?? 0, quota: est.quota ?? 0 };
            }
        } catch {
            // API unavailable - panel shows "Unknown"
        }
    }

    async function requestPersistence() {
        try {
            if (navigator.storage?.persist) {
                storagePersisted = await navigator.storage.persist();
            }
        } catch {
            storagePersisted = false;
        }
    }

    function formatBytes(n: number): string {
        if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
        if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
        return `${Math.round(n / 1024)} KB`;
    }

    onMount(() => {
        refreshStorageInfo();
        translationLibrary.refresh();
        getSplitToggles().then((t) => { splitToggles = t; });
    });

    // ── Translations (issue #238) ─────────────────────────
    // The Translation Manager: fresh profiles seed only the default
    // translation at boot; everything else downloads here (or from a
    // reader picker) and can be removed to reclaim storage.

    let installedCount = $derived(translationLibrary.installedIds.size);

    function taggingNote(t: Translation): string {
        if (t.aligned) return "Strong's, word-aligned";
        if (t.strongs) return "Strong's";
        return '';
    }

    /** Why this translation can't be removed right now, or null. */
    function removalBlock(t: Translation): string | null {
        if (installedCount <= 1) return 'The last installed translation cannot be removed';
        if (prefs?.activeTranslation === t.id) return 'In use by the reader - switch translations there first';
        return null;
    }

    async function downloadTranslation(id: string) {
        await translationLibrary.ensureInstalled(id);
        refreshStorageInfo();
    }

    async function removeTranslationEntry(t: Translation) {
        if (!confirm(`Remove ${t.name}? You can download it again anytime.`)) return;
        await translationLibrary.remove(t.id);
        refreshStorageInfo();
    }

    // ── Appearance ────────────────────────────────────────
    function setTheme(t: 'light' | 'dark' | 'system') {
        preferences.update({ theme: t });
    }

    function setAccent(e: Event) {
        preferences.update({ accentColor: (e.target as HTMLInputElement).value });
    }

    function setFontSize(e: Event) {
        const size = parseInt((e.target as HTMLInputElement).value, 10);
        if (!prefs) return;
        preferences.update({ fonts: { ...prefs.fonts, size } });
    }

    // ── Fonts ─────────────────────────────────────────────
    // Newsreader and Instrument Sans are the bundled defaults (app.css @import);
    // the rest are common system fonts. If the saved value isn't listed (e.g. a
    // legacy pref), append it so the select still displays the current choice
    // instead of rendering blank.
    const READER_FONTS = [
        { value: 'Newsreader', label: 'Newsreader' },
        { value: 'Georgia', label: 'Georgia' },
        { value: 'Times New Roman', label: 'Times New Roman' },
        { value: 'Palatino', label: 'Palatino' },
        { value: 'serif', label: 'System Serif' },
    ];
    const UI_FONTS = [
        { value: 'Instrument Sans', label: 'Instrument Sans' },
        { value: 'system-ui', label: 'System UI' },
        { value: 'sans-serif', label: 'System Sans-serif' },
    ];
    function withCurrent(options: { value: string; label: string }[], current: string) {
        if (options.some((o) => o.value === current)) return options;
        return [...options, { value: current, label: current }];
    }
    const readerFontOptions = $derived(withCurrent(READER_FONTS, prefs?.fonts.reader ?? 'Newsreader'));
    const uiFontOptions = $derived(withCurrent(UI_FONTS, prefs?.fonts.ui ?? 'Instrument Sans'));

    function setReaderFont(e: Event) {
        if (!prefs) return;
        preferences.update({ fonts: { ...prefs.fonts, reader: (e.target as HTMLSelectElement).value } });
    }

    function setUiFont(e: Event) {
        if (!prefs) return;
        preferences.update({ fonts: { ...prefs.fonts, ui: (e.target as HTMLSelectElement).value } });
    }

    // Original-language fonts: none of these are bundled - the browser falls
    // through to a system face with the glyphs when one isn't installed,
    // which is also what the SBL defaults have always done.
    const GREEK_FONTS = [
        { value: 'SBL Greek', label: 'SBL Greek' },
        { value: 'Cardo', label: 'Cardo' },
        { value: 'Gentium Plus', label: 'Gentium Plus' },
        { value: 'Times New Roman', label: 'Times New Roman' },
        { value: 'serif', label: 'System Serif' },
    ];
    const HEBREW_FONTS = [
        { value: 'SBL Hebrew', label: 'SBL Hebrew' },
        { value: 'Ezra SIL', label: 'Ezra SIL' },
        { value: 'Cardo', label: 'Cardo' },
        { value: 'Times New Roman', label: 'Times New Roman' },
        { value: 'serif', label: 'System Serif' },
    ];
    const greekFontOptions = $derived(withCurrent(GREEK_FONTS, prefs?.fonts.greek ?? 'SBL Greek'));
    const hebrewFontOptions = $derived(withCurrent(HEBREW_FONTS, prefs?.fonts.hebrew ?? 'SBL Hebrew'));

    function setGreekFont(e: Event) {
        if (!prefs) return;
        preferences.update({ fonts: { ...prefs.fonts, greek: (e.target as HTMLSelectElement).value } });
    }

    function setHebrewFont(e: Event) {
        if (!prefs) return;
        preferences.update({ fonts: { ...prefs.fonts, hebrew: (e.target as HTMLSelectElement).value } });
    }

    // ── Default translation ───────────────────────────────
    const installedTranslations = $derived(
        translationLibrary.catalog.filter((t) => translationLibrary.isInstalled(t.id))
    );

    function setActiveTranslation(e: Event) {
        preferences.update({ activeTranslation: (e.target as HTMLSelectElement).value });
    }

    // ── Startup location ──────────────────────────────────
    // Fixed-passage mode seeds from the last-read location, so flipping the
    // toggle starts from somewhere sensible instead of Gen 1.
    const startup = $derived(
        prefs?.startup ?? {
            mode: 'last' as const,
            book: prefs?.lastBook ?? 'Gen',
            chapter: prefs?.lastChapter ?? 1,
        }
    );
    const startupMaxChapters = $derived(findBook(startup.book)?.chapters ?? 150);

    // Books offered = the active translation's canon (partial for some).
    let startupBooks = $state<{ osisId: string; name: string }[]>([]);
    let booksLoadedFor: string | null = null;
    $effect(() => {
        const t = prefs?.activeTranslation;
        if (!t || t === booksLoadedFor) return;
        booksLoadedFor = t;
        getBookList(t).then((ids) => {
            startupBooks = ids.map((id) => ({ osisId: id, name: findBook(id)?.name ?? id }));
        });
    });
    // The saved book may come from a previously active translation's canon -
    // keep it selectable rather than rendering the select blank.
    const startupBookOptions = $derived(
        startupBooks.some((b) => b.osisId === startup.book)
            ? startupBooks
            : [...startupBooks, { osisId: startup.book, name: findBook(startup.book)?.name ?? startup.book }]
    );

    function setStartupMode(mode: 'last' | 'fixed') {
        if (!prefs) return;
        preferences.update({ startup: { ...startup, mode } });
    }

    function setStartupBook(e: Event) {
        if (!prefs) return;
        const book = (e.target as HTMLSelectElement).value;
        const max = findBook(book)?.chapters ?? 150;
        preferences.update({ startup: { ...startup, book, chapter: Math.min(startup.chapter, max) } });
    }

    function setStartupChapter(e: Event) {
        if (!prefs) return;
        const raw = parseInt((e.target as HTMLInputElement).value, 10);
        if (Number.isNaN(raw)) return;
        preferences.update({ startup: { ...startup, chapter: Math.min(Math.max(raw, 1), startupMaxChapters) } });
    }

    // ── Reader behavior (split-view toggles, kv-persisted) ─
    let splitToggles = $state<SplitToggles | null>(null);

    function setSplitToggle(key: keyof SplitToggles, value: boolean) {
        if (!splitToggles) return;
        splitToggles = { ...splitToggles, [key]: value };
        updateSplitToggles({ [key]: value });
    }

    // ── Reader ────────────────────────────────────────────
    function setDensity(d: 'compact' | 'normal' | 'relaxed') {
        if (!prefs) return;
        preferences.update({ reader: { ...prefs.reader, density: d } });
    }

    function setColumnWidth(w: 'narrow' | 'medium' | 'wide') {
        if (!prefs) return;
        preferences.update({ reader: { ...prefs.reader, columnWidth: w } });
    }

    function setLineHeight(e: Event) {
        if (!prefs) return;
        const lineHeight = parseFloat((e.target as HTMLInputElement).value);
        preferences.update({ reader: { ...prefs.reader, lineHeight } });
    }

    function setShowVerseNumbers(show: boolean) {
        if (!prefs) return;
        preferences.update({ reader: { ...prefs.reader, showVerseNumbers: show } });
    }

    function setReadingSpeed(e: Event) {
        const speed = parseInt((e.target as HTMLInputElement).value, 10);
        preferences.update({ readingSpeed: speed });
    }

    function setShowRedLetters(show: boolean) {
        if (!prefs) return;
        preferences.update({ reader: { ...prefs.reader, showRedLetters: show } });
    }

    // ── Highlight Presets ─────────────────────────────────
    function updatePresetColor(id: string, e: Event) {
        if (!prefs) return;
        const color = (e.target as HTMLInputElement).value;
        const presets = prefs.highlightPresets.map(p => p.id === id ? { ...p, color } : p);
        preferences.update({ highlightPresets: presets });
    }

    function updatePresetName(id: string, e: Event) {
        if (!prefs) return;
        const name = (e.target as HTMLInputElement).value;
        const presets = prefs.highlightPresets.map(p => p.id === id ? { ...p, name } : p);
        preferences.update({ highlightPresets: presets });
    }

    function deletePreset(id: string) {
        if (!prefs) return;
        preferences.update({ highlightPresets: prefs.highlightPresets.filter(p => p.id !== id) });
    }

    function addPreset() {
        if (!prefs) return;
        const newPreset: HighlightPreset = {
            id: crypto.randomUUID(),
            name: 'New Preset',
            color: '#94a3b8',
        };
        preferences.update({ highlightPresets: [...prefs.highlightPresets, newPreset] });
    }

    async function resetAll() {
        await preferences.reset();
    }
</script>

<svelte:head>
    <title>Settings - Codex Scriptura</title>
</svelte:head>

<div class="settings-page">
    <header class="settings-header">
        <h1>Settings</h1>
        <p class="settings-subtitle">Changes are saved automatically.</p>
    </header>

    {#if prefs}
        <!-- ── Appearance ── -->
        <section class="settings-section">
            <h2 class="section-heading">Appearance</h2>

            <div class="setting-row">
                <span class="setting-label">Theme</span>
                <div class="button-group">
                    <button
                        class="option-btn"
                        class:active={prefs.theme === 'light'}
                        onclick={() => setTheme('light')}
                    >Light</button>
                    <button
                        class="option-btn"
                        class:active={prefs.theme === 'dark'}
                        onclick={() => setTheme('dark')}
                    >Dark</button>
                    <button
                        class="option-btn"
                        class:active={prefs.theme === 'system'}
                        onclick={() => setTheme('system')}
                    >System</button>
                </div>
            </div>

            <div class="setting-row">
                <label class="setting-label" for="accent-color">Accent color</label>
                <div class="color-input-group">
                    <input
                        id="accent-color"
                        type="color"
                        value={prefs.accentColor}
                        oninput={setAccent}
                        class="color-picker-input"
                    />
                    <span class="color-value">{prefs.accentColor}</span>
                </div>
            </div>

            <div class="setting-row">
                <label class="setting-label" for="font-size">
                    Reader font size
                    <span class="setting-hint">{prefs.fonts.size}px</span>
                </label>
                <input
                    id="font-size"
                    type="range"
                    min="12"
                    max="26"
                    step="1"
                    value={prefs.fonts.size}
                    oninput={setFontSize}
                    class="range-input"
                />
            </div>

            <div class="setting-row">
                <label class="setting-label" for="reader-font">Scripture font</label>
                <select id="reader-font" class="select-input" value={prefs.fonts.reader} onchange={setReaderFont}>
                    {#each readerFontOptions as font (font.value)}
                        <option value={font.value}>{font.label}</option>
                    {/each}
                </select>
            </div>

            <div class="setting-row">
                <label class="setting-label" for="ui-font">Interface font</label>
                <select id="ui-font" class="select-input" value={prefs.fonts.ui} onchange={setUiFont}>
                    {#each uiFontOptions as font (font.value)}
                        <option value={font.value}>{font.label}</option>
                    {/each}
                </select>
            </div>

            <div class="setting-row">
                <div>
                    <label class="setting-label" for="greek-font">Greek font</label>
                    <p class="setting-desc">Original-language words in search and word study; uses a system fallback if the font isn't installed</p>
                </div>
                <select id="greek-font" class="select-input" value={prefs.fonts.greek} onchange={setGreekFont}>
                    {#each greekFontOptions as font (font.value)}
                        <option value={font.value}>{font.label}</option>
                    {/each}
                </select>
            </div>

            <div class="setting-row">
                <label class="setting-label" for="hebrew-font">Hebrew font</label>
                <select id="hebrew-font" class="select-input" value={prefs.fonts.hebrew} onchange={setHebrewFont}>
                    {#each hebrewFontOptions as font (font.value)}
                        <option value={font.value}>{font.label}</option>
                    {/each}
                </select>
            </div>
        </section>

        <!-- ── Reader ── -->
        <section class="settings-section">
            <h2 class="section-heading">Reader</h2>

            <div class="setting-row">
                <div>
                    <label class="setting-label" for="default-translation">Translation</label>
                    <p class="setting-desc">What the reader opens with - switching inside the reader updates this too</p>
                </div>
                {#if installedTranslations.length > 0}
                    <select id="default-translation" class="select-input" value={prefs.activeTranslation} onchange={setActiveTranslation}>
                        {#each installedTranslations as t (t.id)}
                            <option value={t.id}>{t.abbreviation} - {t.name}</option>
                        {/each}
                    </select>
                {:else}
                    <span class="setting-hint">Loading…</span>
                {/if}
            </div>

            <div class="setting-row">
                <div>
                    <span class="setting-label">Open at launch</span>
                    <p class="setting-desc">Where the reader starts when you open the app</p>
                </div>
                <div class="button-group">
                    <button
                        class="option-btn"
                        class:active={startup.mode === 'last'}
                        onclick={() => setStartupMode('last')}
                    >Last read</button>
                    <button
                        class="option-btn"
                        class:active={startup.mode === 'fixed'}
                        onclick={() => setStartupMode('fixed')}
                    >Fixed passage</button>
                </div>
            </div>

            {#if startup.mode === 'fixed'}
                <div class="setting-row">
                    <label class="setting-label" for="startup-book">Passage</label>
                    <div class="passage-inputs">
                        <select id="startup-book" class="select-input" value={startup.book} onchange={setStartupBook}>
                            {#each startupBookOptions as b (b.osisId)}
                                <option value={b.osisId}>{b.name}</option>
                            {/each}
                        </select>
                        <input
                            id="startup-chapter"
                            type="number"
                            class="chapter-input"
                            min="1"
                            max={startupMaxChapters}
                            value={startup.chapter}
                            onchange={setStartupChapter}
                            aria-label="Chapter"
                        />
                    </div>
                </div>
            {/if}

            <div class="setting-row">
                <span class="setting-label">Column width</span>
                <div class="button-group">
                    <button
                        class="option-btn"
                        class:active={prefs.reader.columnWidth === 'narrow'}
                        onclick={() => setColumnWidth('narrow')}
                    >Narrow</button>
                    <button
                        class="option-btn"
                        class:active={prefs.reader.columnWidth === 'medium'}
                        onclick={() => setColumnWidth('medium')}
                    >Medium</button>
                    <button
                        class="option-btn"
                        class:active={prefs.reader.columnWidth === 'wide'}
                        onclick={() => setColumnWidth('wide')}
                    >Wide</button>
                </div>
            </div>

            <div class="setting-row">
                <label class="setting-label" for="line-height">
                    Line spacing
                    <span class="setting-hint">{prefs.reader.lineHeight.toFixed(1)}</span>
                </label>
                <input
                    id="line-height"
                    type="range"
                    min="1.2"
                    max="2.5"
                    step="0.1"
                    value={prefs.reader.lineHeight}
                    oninput={setLineHeight}
                    class="range-input"
                />
            </div>

            <div class="setting-row">
                <span class="setting-label">Layout density</span>
                <div class="button-group">
                    <button
                        class="option-btn"
                        class:active={prefs.reader.density === 'compact'}
                        onclick={() => setDensity('compact')}
                    >Compact</button>
                    <button
                        class="option-btn"
                        class:active={prefs.reader.density === 'normal'}
                        onclick={() => setDensity('normal')}
                    >Normal</button>
                    <button
                        class="option-btn"
                        class:active={prefs.reader.density === 'relaxed'}
                        onclick={() => setDensity('relaxed')}
                    >Relaxed</button>
                </div>
            </div>

            <div class="setting-row">
                <span class="setting-label">Verse numbers</span>
                <div class="button-group">
                    <button
                        class="option-btn"
                        class:active={prefs.reader.showVerseNumbers}
                        onclick={() => setShowVerseNumbers(true)}
                    >Show</button>
                    <button
                        class="option-btn"
                        class:active={!prefs.reader.showVerseNumbers}
                        onclick={() => setShowVerseNumbers(false)}
                    >Hide</button>
                </div>
            </div>

            <div class="setting-row">
                <label class="setting-label" for="reading-speed">
                    Reading speed
                    <span class="setting-hint">{prefs.readingSpeed ?? 200} wpm</span>
                </label>
                <input
                    id="reading-speed"
                    type="range"
                    min="100"
                    max="400"
                    step="25"
                    value={prefs.readingSpeed ?? 200}
                    oninput={setReadingSpeed}
                    class="range-input"
                />
            </div>

            <div class="setting-row">
                <div>
                    <span class="setting-label">Paragraph mode</span>
                    <p class="setting-desc">Display verses as flowing prose paragraphs</p>
                </div>
                <div class="button-group">
                    <button
                        class="option-btn"
                        class:active={prefs.reader.paragraphMode}
                        onclick={() => {
                            if (!prefs) return;
                            preferences.update({ reader: { ...prefs.reader, paragraphMode: true } });
                        }}
                    >Prose</button>
                    <button
                        class="option-btn"
                        class:active={!prefs.reader.paragraphMode}
                        onclick={() => {
                            if (!prefs) return;
                            preferences.update({ reader: { ...prefs.reader, paragraphMode: false } });
                        }}
                    >Verse per line</button>
                </div>
            </div>

            <div class="setting-row">
                <span class="setting-label">
                    Red letter
                    <span class="setting-hint">WEB only</span>
                </span>
                <div class="button-group">
                    <button
                        class="option-btn"
                        class:active={prefs.reader.showRedLetters}
                        onclick={() => setShowRedLetters(true)}
                    >On</button>
                    <button
                        class="option-btn"
                        class:active={!prefs.reader.showRedLetters}
                        onclick={() => setShowRedLetters(false)}
                    >Off</button>
                </div>
            </div>

            {#if splitToggles}
                <div class="setting-row">
                    <div>
                        <span class="setting-label">Cross-references</span>
                        <p class="setting-desc">Inline cross-reference markers in the text</p>
                    </div>
                    <div class="button-group">
                        <button
                            class="option-btn"
                            class:active={splitToggles.showRefs}
                            onclick={() => setSplitToggle('showRefs', true)}
                        >Show</button>
                        <button
                            class="option-btn"
                            class:active={!splitToggles.showRefs}
                            onclick={() => setSplitToggle('showRefs', false)}
                        >Hide</button>
                    </div>
                </div>

                <div class="setting-row">
                    <div>
                        <span class="setting-label">Divergence shading</span>
                        <p class="setting-desc">Shade words that differ across the translations open in split view</p>
                    </div>
                    <div class="button-group">
                        <button
                            class="option-btn"
                            class:active={splitToggles.showDivergence}
                            onclick={() => setSplitToggle('showDivergence', true)}
                        >On</button>
                        <button
                            class="option-btn"
                            class:active={!splitToggles.showDivergence}
                            onclick={() => setSplitToggle('showDivergence', false)}
                        >Off</button>
                    </div>
                </div>

                <div class="setting-row">
                    <div>
                        <span class="setting-label">Synced scrolling</span>
                        <p class="setting-desc">Scroll split-view panes together</p>
                    </div>
                    <div class="button-group">
                        <button
                            class="option-btn"
                            class:active={splitToggles.syncScroll}
                            onclick={() => setSplitToggle('syncScroll', true)}
                        >On</button>
                        <button
                            class="option-btn"
                            class:active={!splitToggles.syncScroll}
                            onclick={() => setSplitToggle('syncScroll', false)}
                        >Off</button>
                    </div>
                </div>
            {/if}
        </section>

        <!-- ── Highlight Presets ── -->
        <section class="settings-section">
            <h2 class="section-heading">Highlight Presets</h2>

            <div class="presets-list">
                {#each prefs.highlightPresets as preset (preset.id)}
                    <div class="preset-row">
                        <input
                            type="color"
                            value={preset.color}
                            oninput={(e) => updatePresetColor(preset.id, e)}
                            class="preset-color-input"
                            aria-label="Preset color"
                        />
                        <input
                            type="text"
                            value={preset.name}
                            oninput={(e) => updatePresetName(preset.id, e)}
                            class="preset-name-input"
                            placeholder="Preset name"
                            maxlength="32"
                        />
                        <button
                            class="delete-preset-btn"
                            onclick={() => deletePreset(preset.id)}
                            aria-label="Delete preset"
                            disabled={prefs.highlightPresets.length <= 1}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                {/each}
            </div>

            <button class="add-preset-btn" onclick={addPreset}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 5v14M5 12h14" />
                </svg>
                Add Preset
            </button>
        </section>

        <!-- ── Storage ── -->
        <!-- ── Translations ── -->
        <section class="settings-section">
            <h2 class="section-heading">Translations</h2>
            <p class="setting-desc section-desc">Download translations to read and search them offline; remove ones you don't use to reclaim storage. Reader pickers also offer downloads on the spot.</p>

            {#if !translationLibrary.loaded}
                <p class="setting-hint">Loading…</p>
            {:else}
                {#each translationLibrary.catalog as t (t.id)}
                    {@const entry = translationLibrary.state(t.id)}
                    {@const installed = translationLibrary.isInstalled(t.id)}
                    <div class="setting-row translation-row">
                        <div>
                            <span class="setting-label">{t.abbreviation} - {t.name}</span>
                            <p class="setting-desc">
                                {#if t.coverage}{t.coverage} · {/if}{#if taggingNote(t)}{taggingNote(t)} · {/if}{t.license}
                                {#if installed && t.verseCount > 0} · {t.verseCount.toLocaleString()} verses{/if}
                            </p>
                            {#if entry.error}
                                <p class="setting-desc translation-error" role="alert">Failed: {entry.error}</p>
                            {/if}
                        </div>
                        {#if entry.downloading}
                            {@const pct = Math.round((entry.progress ?? 0) * 100)}
                            <Button size="sm" variant="primary" loading style="font-variant-numeric: tabular-nums">
                                Downloading… {pct}%
                            </Button>
                            <span class="visually-hidden" role="status">Downloading {t.abbreviation}, {pct} percent</span>
                        {:else if entry.removing}
                            <Button size="sm" variant="danger" loading>Removing…</Button>
                            <span class="visually-hidden" role="status">Removing {t.abbreviation}</span>
                        {:else if installed}
                            {@const block = removalBlock(t)}
                            {#if block}
                                <span class="setting-hint" title={block}>Installed</span>
                            {:else}
                                <Button size="sm" variant="danger" onclick={() => removeTranslationEntry(t)}>Remove</Button>
                            {/if}
                        {:else}
                            <Button size="sm" variant="primary" onclick={() => downloadTranslation(t.id)}>Download</Button>
                        {/if}
                    </div>
                {/each}
            {/if}
        </section>

        <section class="settings-section">
            <h2 class="section-heading">Storage</h2>

            <div class="setting-row">
                <div>
                    <span class="setting-label">Persistent storage</span>
                    <p class="setting-desc">Protects your library and annotations from being evicted by the browser under storage pressure.</p>
                </div>
                {#if storagePersisted === true}
                    <span class="storage-status ok">Persistent ✓</span>
                {:else if storagePersisted === false}
                    <Button variant="secondary" onclick={requestPersistence} style="margin-bottom: var(--space-3)">Request persistence</Button>
                {:else}
                    <span class="storage-status">Unknown</span>
                {/if}
            </div>

            {#if storageUsage && storageUsage.quota > 0}
                <div class="setting-row">
                    <span class="setting-label">Usage</span>
                    <span class="setting-hint">{formatBytes(storageUsage.usage)} of {formatBytes(storageUsage.quota)}</span>
                </div>
            {/if}
        </section>

        <!-- ── About & Feedback ── -->
        <section class="settings-section">
            <h2 class="section-heading">About</h2>

            <div class="setting-row">
                <div>
                    <span class="setting-label">Latest update</span>
                    <p class="setting-desc">{WHATS_NEW[0].title} - {WHATS_NEW[0].date}</p>
                </div>
                <Button size="sm" variant="secondary" onclick={() => { ui.whatsNewOpen = true; }}>What's new</Button>
            </div>

            <div class="setting-row">
                <div>
                    <span class="setting-label">Send feedback</span>
                    <p class="setting-desc">Found a bug or have an idea? An email goes straight to the developer.</p>
                </div>
                <a class="about-btn" href={feedbackHref}>Email feedback</a>
            </div>
        </section>

        <!-- ── Danger Zone ── -->
        <section class="settings-section danger-zone">
            <h2 class="section-heading">Reset</h2>
            <p class="danger-description">Restore all settings to their factory defaults. Your annotations are not affected.</p>
            <button class="reset-btn" onclick={resetAll}>Reset to defaults</button>
        </section>
    {/if}
</div>

<style>
    .settings-page {
        max-width: 640px;
        margin: 0 auto;
        padding: var(--space-8) var(--space-6);
        display: flex;
        flex-direction: column;
        gap: var(--space-8);
    }

    /* ── Header ── */
    .settings-header h1 {
        font-size: var(--font-size-2xl);
        font-weight: 700;
        color: var(--color-text-primary);
        letter-spacing: -0.02em;
        margin-bottom: var(--space-1);
    }
    .settings-subtitle {
        font-size: var(--font-size-sm);
        color: var(--color-text-muted);
    }

    /* ── Sections ── */
    .settings-section {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        padding: var(--space-5);
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
    }

    .section-heading {
        font-size: var(--font-size-xs);
        font-weight: 700;
        color: var(--color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        padding-bottom: var(--space-2);
        border-bottom: 1px solid var(--color-border-subtle);
    }

    /* ── Storage ── */
    .storage-status {
        font-size: var(--font-size-xs);
        font-weight: 600;
        color: var(--color-text-muted);
        white-space: nowrap;
    }
    .storage-status.ok {
        color: var(--color-success, #22c55e);
    }
    .section-desc {
        margin-bottom: var(--space-3);
    }

    .translation-row {
        align-items: flex-start;
    }

    .translation-error {
        color: var(--color-danger, #dc2626);
    }

    .about-btn {
        padding: var(--space-1) var(--space-3);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        transition: all var(--transition-fast);
        text-decoration: none;
    }
    .about-btn:hover {
        border-color: var(--color-accent);
        color: var(--color-accent);
    }

    /* ── Individual settings ── */
    .setting-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-4);
        min-height: 36px;
    }

    .setting-label {
        font-size: var(--font-size-sm);
        font-weight: 500;
        color: var(--color-text-primary);
        display: flex;
        align-items: center;
        gap: var(--space-3);
        flex-shrink: 0;
    }

    .setting-hint {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        font-weight: 400;
        font-variant-numeric: tabular-nums;
        min-width: 3ch;
        text-align: right;
    }

    .setting-desc {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        margin-top: 2px;
    }

    /* ── Button group ── */
    .button-group {
        display: flex;
        gap: 2px;
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: 2px;
    }

    .option-btn {
        padding: var(--space-1) var(--space-3);
        background: none;
        border: none;
        border-radius: calc(var(--radius-sm) - 2px);
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 500;
        cursor: pointer;
        transition: all var(--transition-fast);
        white-space: nowrap;
    }
    .option-btn:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
    }
    .option-btn.active {
        background: var(--color-accent);
        color: var(--color-on-accent, #fff);
    }

    /* ── Color picker ── */
    .color-input-group {
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }

    .color-picker-input {
        width: 36px;
        height: 28px;
        padding: 2px;
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        cursor: pointer;
    }
    .color-picker-input::-webkit-color-swatch-wrapper { padding: 0; }
    .color-picker-input::-webkit-color-swatch { border: none; border-radius: 3px; }

    .color-value {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        font-family: var(--font-mono);
    }

    /* ── Startup passage ── */
    .passage-inputs {
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }
    .passage-inputs .select-input {
        min-width: 0;
        flex: 1;
    }
    .chapter-input {
        width: 72px;
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: var(--space-2) var(--space-3);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
    }
    .chapter-input:focus {
        outline: none;
        border-color: var(--color-accent);
    }

    /* ── Range input ── */
    .range-input {
        width: 160px;
        accent-color: var(--color-accent);
        cursor: pointer;
    }

    /* ── Select input ── */
    .select-input {
        /* appearance: none drops the UA form-control chrome (border + arrow),
           which clashes with the theme now that color-scheme is set */
        appearance: none;
        padding: var(--space-2) var(--space-3);
        padding-right: calc(var(--space-3) + 20px);
        /* Solid, not the translucent surface wash: Chromium derives the
           popup's light/dark rendering from this color */
        background-color: var(--color-bg-control);
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237a8494' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right var(--space-3) center;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        cursor: pointer;
        min-width: 160px;
        transition: border-color var(--transition-fast), background-color var(--transition-fast);
    }
    .select-input:hover {
        background-color: var(--color-bg-control-hover);
    }
    .select-input:focus {
        outline: none;
        border-color: var(--color-accent);
    }

    /* ── Presets ── */
    .presets-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .preset-row {
        display: flex;
        align-items: center;
        gap: var(--space-3);
    }

    .preset-color-input {
        width: 32px;
        height: 28px;
        padding: 2px;
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        cursor: pointer;
        flex-shrink: 0;
    }
    .preset-color-input::-webkit-color-swatch-wrapper { padding: 0; }
    .preset-color-input::-webkit-color-swatch { border: none; border-radius: 3px; }

    .preset-name-input {
        flex: 1;
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: var(--space-1) var(--space-3);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
    }
    .preset-name-input:focus {
        outline: none;
        border-color: var(--color-accent);
    }

    .delete-preset-btn {
        background: none;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        padding: var(--space-1);
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        transition: color var(--transition-fast);
        flex-shrink: 0;
    }
    .delete-preset-btn:hover:not(:disabled) { color: var(--color-danger); }
    .delete-preset-btn:disabled { opacity: 0.3; cursor: not-allowed; }

    .add-preset-btn {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        background: none;
        border: 1px dashed var(--color-border);
        border-radius: var(--radius-sm);
        padding: var(--space-2) var(--space-3);
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        cursor: pointer;
        transition: all var(--transition-fast);
        width: fit-content;
    }
    .add-preset-btn:hover {
        color: var(--color-accent);
        border-color: var(--color-accent);
        background: var(--color-accent-subtle);
    }

    /* ── Danger zone ── */
    .danger-zone {
        border-color: rgba(248, 113, 113, 0.2);
    }

    .danger-description {
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
    }

    .reset-btn {
        padding: var(--space-2) var(--space-4);
        background: none;
        border: 1px solid var(--color-danger);
        border-radius: var(--radius-sm);
        color: var(--color-danger);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 500;
        cursor: pointer;
        transition: all var(--transition-fast);
        width: fit-content;
    }
    .reset-btn:hover {
        background: var(--color-danger);
        color: #fff;
    }

    /* ── Mobile ── */
    @media (max-width: 768px) {
        .settings-page {
            padding: var(--space-4);
        }
        .setting-row {
            flex-direction: column;
            align-items: flex-start;
            gap: var(--space-2);
        }
        .range-input,
        .select-input {
            width: 100%;
        }
    }
</style>
