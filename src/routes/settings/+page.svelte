<script lang="ts">
    import { preferences } from '$lib/stores/preferences.svelte';
    import type { HighlightPreset } from '@codex-scriptura/core';

    let prefs = $derived(preferences.value);

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
    function setReaderFont(e: Event) {
        if (!prefs) return;
        preferences.update({ fonts: { ...prefs.fonts, reader: (e.target as HTMLSelectElement).value } });
    }

    function setUiFont(e: Event) {
        if (!prefs) return;
        preferences.update({ fonts: { ...prefs.fonts, ui: (e.target as HTMLSelectElement).value } });
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
    <title>Settings — Codex Scriptura</title>
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
                    <option value="Crimson Pro">Crimson Pro</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Times New Roman">Times New Roman</option>
                    <option value="Palatino">Palatino</option>
                    <option value="serif">System Serif</option>
                </select>
            </div>

            <div class="setting-row">
                <label class="setting-label" for="ui-font">Interface font</label>
                <select id="ui-font" class="select-input" value={prefs.fonts.ui} onchange={setUiFont}>
                    <option value="Inter">Inter</option>
                    <option value="system-ui">System UI</option>
                    <option value="-apple-system">Apple System</option>
                    <option value="sans-serif">System Sans-serif</option>
                </select>
            </div>
        </section>

        <!-- ── Reader ── -->
        <section class="settings-section">
            <h2 class="section-heading">Reader</h2>

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
        color: #fff;
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

    /* ── Range input ── */
    .range-input {
        width: 160px;
        accent-color: var(--color-accent);
        cursor: pointer;
    }

    /* ── Select input ── */
    .select-input {
        padding: var(--space-1) var(--space-3);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        cursor: pointer;
        min-width: 160px;
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
