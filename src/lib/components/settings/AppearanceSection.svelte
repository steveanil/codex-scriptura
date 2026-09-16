<script lang="ts">
    import { preferences } from '$lib/stores/preferences.svelte';
    import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
    import type { SegmentOption } from '$lib/components/ui/segmented';
    import SettingsCard from './SettingsCard.svelte';
    import SettingRow from './SettingRow.svelte';
    import { ACCENT_PRESETS } from '$lib/accent-presets';
    import { AA_TEXT, DARK_BG, LIGHT_BG, contrastRatio, darkenUntil, formatRatio, isHex } from '$lib/utils/contrast';
    import Button from '$lib/components/ui/Button.svelte';

    const prefs = $derived(preferences.value);

    const THEME_OPTIONS: SegmentOption<'light' | 'dark' | 'system'>[] = [
        { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' },
    ];

    // ── Accent: one hue per theme, contrast checked as you type ──
    let hexDraft = $state('');
    let hexInvalid = $state(false);
    $effect(() => { hexDraft = prefs?.accentColor ?? ''; hexInvalid = false; });

    const lightAccent = $derived(prefs?.accentColorLight ?? prefs?.accentColor ?? '#5e9ed6');
    const darkRatio = $derived(contrastRatio(prefs?.accentColor ?? '#5e9ed6', DARK_BG));
    const lightRatio = $derived(contrastRatio(lightAccent, LIGHT_BG));
    const lightFails = $derived(lightRatio < AA_TEXT);

    function setAccent(hex: string) {
        if (!isHex(hex)) return;
        // A fresh dark hue drops any light override so the readout tells the truth
        preferences.update({ accentColor: hex.toLowerCase(), accentColorLight: undefined });
    }
    function onHexInput(e: Event) {
        const v = (e.currentTarget as HTMLInputElement).value.trim();
        hexDraft = v;
        hexInvalid = !isHex(v);
        if (!hexInvalid) setAccent(v);
    }
    function darkenForLight() {
        if (!prefs) return;
        preferences.update({ accentColorLight: darkenUntil(prefs.accentColor, LIGHT_BG) });
    }
    function useOneHue() {
        preferences.update({ accentColorLight: undefined });
    }

    // ── Fonts ─────────────────────────────────────────────
    // Newsreader and Instrument Sans are the bundled defaults (app.css @import);
    // the rest are common system fonts. If the saved value isn't listed (e.g. a
    // legacy pref), append it so the select still displays the current choice.
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
    // Original-language fonts: none of these are bundled - the browser falls
    // through to a system face with the glyphs when one isn't installed.
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
    function withCurrent(options: { value: string; label: string }[], current: string) {
        if (options.some((o) => o.value === current)) return options;
        return [...options, { value: current, label: current }];
    }
    function setFont(key: 'reader' | 'ui' | 'greek' | 'hebrew', e: Event) {
        if (!prefs) return;
        preferences.update({ fonts: { ...prefs.fonts, [key]: (e.currentTarget as HTMLSelectElement).value } });
    }
</script>

{#if prefs}
<SettingsCard id="appearance" kicker="Appearance">
    <SettingRow label="Theme">
        <SegmentedControl label="Theme" options={THEME_OPTIONS} value={prefs.theme} onchange={(t) => preferences.update({ theme: t })} />
    </SettingRow>

    <SettingRow label="Accent color" hint="One stored hue per theme; hover, washes, highlight and button text are derived from it. Text contrast is checked against both theme backgrounds as you type." stack>
        <div class="swatches" role="radiogroup" aria-label="Accent presets">
            {#each ACCENT_PRESETS as p (p.hex)}
                <button
                    class="swatch"
                    role="radio"
                    aria-checked={prefs.accentColor === p.hex}
                    aria-label={p.name}
                    title={p.name}
                    style="background: {p.hex}"
                    onclick={() => setAccent(p.hex)}
                ></button>
            {/each}
        </div>
        <label class="hexfield" class:invalid={hexInvalid}>
            <input type="color" class="hex-native" value={prefs.accentColor} oninput={(e) => setAccent((e.currentTarget as HTMLInputElement).value)} aria-label="Pick an accent color" />
            <input class="hex-text" type="text" value={hexDraft} oninput={onHexInput} spellcheck="false" maxlength="7" aria-label="Accent hex" aria-invalid={hexInvalid} />
        </label>
        <div class="contrast" aria-live="polite">
            <b class:ok={darkRatio >= AA_TEXT} class:warn={darkRatio < AA_TEXT}>{darkRatio >= AA_TEXT ? 'AA' : 'Fails AA'} {formatRatio(darkRatio)} on dark</b>
            <b class:ok={!lightFails} class:warn={lightFails}>{lightFails ? `${formatRatio(lightRatio)} on light - fails AA` : `AA ${formatRatio(lightRatio)} on light`}{prefs.accentColorLight ? ` (${prefs.accentColorLight})` : ''}</b>
            {#if lightFails}
                <Button size="sm" variant="secondary" onclick={darkenForLight}>Darken for light theme</Button>
            {:else if prefs.accentColorLight}
                <Button size="sm" variant="ghost" onclick={useOneHue}>Use one hue for both themes</Button>
            {/if}
        </div>
    </SettingRow>

    <SettingRow label="Scripture font" labelFor="reader-font">
        <select id="reader-font" class="select-input" value={prefs.fonts.reader} onchange={(e) => setFont('reader', e)}>
            {#each withCurrent(READER_FONTS, prefs.fonts.reader) as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
        </select>
    </SettingRow>
    <SettingRow label="Interface font" labelFor="ui-font">
        <select id="ui-font" class="select-input" value={prefs.fonts.ui} onchange={(e) => setFont('ui', e)}>
            {#each withCurrent(UI_FONTS, prefs.fonts.ui) as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
        </select>
    </SettingRow>
    <SettingRow label="Greek font" labelFor="greek-font" hint="Original-language words in search and word study; uses a system fallback if the font isn't installed">
        <select id="greek-font" class="select-input" value={prefs.fonts.greek} onchange={(e) => setFont('greek', e)}>
            {#each withCurrent(GREEK_FONTS, prefs.fonts.greek) as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
        </select>
    </SettingRow>
    <SettingRow label="Hebrew font" labelFor="hebrew-font">
        <select id="hebrew-font" class="select-input" value={prefs.fonts.hebrew} onchange={(e) => setFont('hebrew', e)}>
            {#each withCurrent(HEBREW_FONTS, prefs.fonts.hebrew) as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
        </select>
    </SettingRow>
</SettingsCard>
{/if}

<style>
    .swatches {
        display: flex;
        gap: 6px;
    }
    .swatch {
        width: 24px;
        height: 24px;
        border: none;
        border-radius: var(--radius-sm);
        cursor: pointer;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
    }
    .swatch[aria-checked='true'] {
        box-shadow: 0 0 0 2px var(--color-bg), 0 0 0 4px var(--color-accent-hover);
    }
    .hexfield {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        height: var(--row-h-sm);
        padding: 0 var(--space-2) 0 var(--space-1);
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-sm);
        background: var(--color-bg-control);
    }
    .hexfield.invalid {
        border-color: var(--color-danger);
    }
    .hex-native {
        width: 22px;
        height: 22px;
        padding: 0;
        border: none;
        background: none;
        cursor: pointer;
    }
    .hex-native::-webkit-color-swatch-wrapper { padding: 0; }
    .hex-native::-webkit-color-swatch { border: none; border-radius: 3px; }
    .hex-text {
        width: 8ch;
        background: none;
        border: none;
        color: var(--color-text-secondary);
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
    }
    .hex-text:focus-visible {
        outline: none;
        box-shadow: none;
    }
    .contrast {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
        font-family: var(--font-mono);
        font-size: var(--font-size-2xs);
        color: var(--color-text-muted);
    }
    .contrast b {
        font-weight: 500;
    }
    .contrast b.ok { color: var(--color-success); }
    .contrast b.warn { color: var(--color-warning); }
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
    @media (max-width: 768px) {
        .select-input { width: 100%; }
    }
</style>
