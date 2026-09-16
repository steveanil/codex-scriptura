<script lang="ts" generics="T extends string">
    import { onMount } from 'svelte';
    import { segmentedPresentation, stepValue, type SegmentOption } from './segmented';

    /**
     * One exclusive choice among a few options (issue #252). Up to four
     * options render as a segmented row on a raised surface with an accent
     * underline on the active segment; five or more render as a labelled
     * dropdown so the control never squeezes or wraps. Arrow keys move the
     * choice in both presentations; an optional page-level shortcut cycles
     * it from anywhere.
     */
    let {
        options,
        value,
        onchange,
        label,
        size = 'md',
        id,
        shortcut,
    }: {
        options: SegmentOption<T>[];
        value: T;
        onchange: (value: T) => void;
        /** Accessible name of the group (and the visible label of the dropdown form). */
        label: string;
        /** sm 28px for inline filters, md 32px for settings and toolbars. */
        size?: 'sm' | 'md';
        id?: string;
        /** e.g. "Alt+M": cycles to the next option while the page is open; shown as a hint in dropdown form. */
        shortcut?: string;
    } = $props();

    const presentation = $derived(segmentedPresentation(options.length));

    function choose(v: T) {
        if (v !== value) onchange(v);
    }

    function onKey(e: KeyboardEvent) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            choose(stepValue(options, value, 1));
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            choose(stepValue(options, value, -1));
        }
    }

    // Keep focus on the checked segment after an arrow key so the roving
    // tabindex stays coherent for the next Tab.
    let groupEl: HTMLDivElement | undefined = $state();
    $effect(() => {
        void value;
        const active = groupEl?.querySelector<HTMLElement>('[aria-checked="true"]');
        if (active && groupEl?.contains(document.activeElement) && document.activeElement !== active) active.focus();
    });

    function matchesShortcut(e: KeyboardEvent): boolean {
        if (!shortcut) return false;
        const parts = shortcut.toLowerCase().split('+');
        const key = parts.pop()!;
        const need = { alt: parts.includes('alt'), ctrl: parts.includes('ctrl'), shift: parts.includes('shift'), meta: parts.includes('cmd') || parts.includes('meta') };
        return e.altKey === need.alt && e.ctrlKey === need.ctrl && e.shiftKey === need.shift && e.metaKey === need.meta
            && (e.key.toLowerCase() === key || e.code.toLowerCase() === `key${key}`);
    }

    onMount(() => {
        if (!shortcut) return;
        function onWindowKey(e: KeyboardEvent) {
            if (!matchesShortcut(e)) return;
            e.preventDefault();
            choose(stepValue(options, value, 1));
        }
        window.addEventListener('keydown', onWindowKey);
        return () => window.removeEventListener('keydown', onWindowKey);
    });
</script>

{#if presentation === 'segments'}
    <div
        class="segmented {size}"
        role="radiogroup"
        aria-label={label}
        {id}
        bind:this={groupEl}
    >
        {#each options as opt (opt.value)}
            <button
                type="button"
                class="segment"
                role="radio"
                aria-checked={opt.value === value}
                tabindex={opt.value === value ? 0 : -1}
                disabled={opt.disabled}
                title={opt.title}
                onclick={() => choose(opt.value)}
                onkeydown={onKey}
            >{opt.label}</button>
        {/each}
    </div>
{:else}
    <label class="segmented-dropdown {size}">
        <span class="data-label">{label}</span>
        <select
            {id}
            {value}
            onchange={(e) => choose((e.currentTarget as HTMLSelectElement).value as T)}
            onkeydown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') onKey(e); }}
        >
            {#each options as opt (opt.value)}
                <option value={opt.value} disabled={opt.disabled} title={opt.title}>{opt.label}</option>
            {/each}
        </select>
        {#if shortcut}<kbd class="shortcut" title="Next option">{shortcut.replace(/\+/g, ' ')}</kbd>{/if}
    </label>
{/if}

<style>
    /* Raised surface: opaque control bg plus the interactive hairline. The
       active segment is marked by an accent underline and primary text, not
       an accent fill, so the switcher stops being the loudest thing on the
       page and the accent keeps meaning "interactive". */
    .segmented {
        display: inline-flex;
        align-items: stretch;
        background: var(--color-bg-control);
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-sm);
        padding: 2px;
        gap: 2px;
    }
    .segment {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 var(--space-3);
        background: none;
        border: none;
        border-radius: calc(var(--radius-sm) - 2px);
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-weight: 500;
        white-space: nowrap;
        cursor: pointer;
        transition: color var(--transition-fast), background var(--transition-fast);
    }
    .md .segment { height: 28px; font-size: var(--font-size-sm); }
    .sm .segment { height: 24px; font-size: var(--font-size-xs); padding: 0 var(--space-2); }
    .segment:hover:not(:disabled) {
        color: var(--color-text-primary);
        background: var(--color-bg-control-hover);
    }
    .segment[aria-checked='true'] {
        color: var(--color-text-primary);
        font-weight: 600;
        background: var(--color-bg-hover);
    }
    .segment[aria-checked='true']::after {
        content: '';
        position: absolute;
        left: var(--space-2);
        right: var(--space-2);
        bottom: 1px;
        height: 2px;
        border-radius: 1px;
        background: var(--color-accent);
    }
    .segment:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }

    .segmented-dropdown {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
    }
    .segmented-dropdown select {
        appearance: none;
        height: 32px;
        padding: 0 calc(var(--space-2) + 16px) 0 var(--space-3);
        background-color: var(--color-bg-control);
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%237a8494' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right var(--space-2) center;
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 600;
        cursor: pointer;
    }
    .sm select { height: 28px; font-size: var(--font-size-xs); }
    .segmented-dropdown select:hover {
        background-color: var(--color-bg-control-hover);
    }
    .shortcut {
        padding: 0 var(--space-1);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-xs);
        font-family: var(--font-ui);
        font-size: var(--font-size-2xs);
        color: var(--color-text-muted);
        line-height: 1.6;
    }
</style>
