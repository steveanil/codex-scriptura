<script lang="ts">
    import type { Translation } from '@codex-scriptura/core';

    let {
        value,
        translations,
        onchange,
        id,
        'aria-label': ariaLabel,
    }: {
        /** The translation id shown. */
        value: string;
        /** Installed translations; with only one there is nothing to pick, so a badge shows. */
        translations: Translation[];
        onchange: (id: string) => void;
        id?: string;
        'aria-label'?: string;
    } = $props();

    // Coverage labeling for partial translations (known-issues #30): the
    // picker marks them "(partial)" and the book selector greys out books
    // the translation doesn't have instead of hiding them.
    function translationLabel(t: Translation): string {
        return t.coverage ? `${t.abbreviation} (partial)` : t.abbreviation;
    }
    function translationTitle(t: Translation): string {
        return t.coverage ? `${t.name}: ${t.coverage} (in-progress translation)` : t.name;
    }
</script>

{#if translations.length > 1}
    <select
        class="translation-picker"
        {value}
        onchange={(e) => onchange((e.target as HTMLSelectElement).value)}
        {id}
        aria-label={ariaLabel}
        title={translationTitle(translations.find((t) => t.id === value) ?? translations[0])}
    >
        {#each translations as t}
            <option value={t.id} title={translationTitle(t)}>{translationLabel(t)}</option>
        {/each}
    </select>
{:else}
    <span class="translation-badge">{value}</span>
{/if}

<style>
    .translation-picker {
        /* appearance: none drops the UA form-control chrome (border + arrow),
           which clashes with the theme now that color-scheme is set */
        appearance: none;
        padding: var(--space-1) var(--space-2);
        padding-right: calc(var(--space-2) + 16px);
        /* Solid, not the translucent surface wash: Chromium derives the
           popup's light/dark rendering from this color */
        background-color: var(--color-bg-control);
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%237a8494' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right var(--space-2) center;
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 600;
        cursor: pointer;
        transition: border-color var(--transition-fast), background-color var(--transition-fast);
    }
    .translation-picker:hover {
        background-color: var(--color-bg-control-hover);
    }
    .translation-badge {
        padding: var(--space-1) var(--space-3);
        background: var(--color-accent-subtle);
        color: var(--color-accent);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-xs);
        font-weight: 700;
    }

    @media (max-width: 768px) {
        .translation-picker { height: 44px; }
    }
</style>
