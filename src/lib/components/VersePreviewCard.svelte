<script lang="ts">
    import { ui } from '$lib/stores/ui.svelte';
    import { keepPreviewOpen, closePreview, forceClosePreview } from '$lib/actions/verseHover';
    import { getVerse } from '@codex-scriptura/db';
    import type { VerseRecord } from '@codex-scriptura/core';
    import { findBook } from '@codex-scriptura/core';

    let { onNavigate }: { onNavigate: (book: string, chapter: number, verse: number) => void } = $props();

    let verseRecord = $state<VerseRecord | null>(null);
    let loading = $state(false);
    let top = $state(0);
    let left = $state(0);
    let opacity = $state(0);
    let popoverEl = $state<HTMLElement>();

    // Computed text
    let formattedRef = $derived.by(() => {
        if (!ui.hoverPreview.osisId) return '';
        const parts = ui.hoverPreview.osisId.split('.');
        if (parts.length < 3) return ui.hoverPreview.osisId;
        const bookMeta = findBook(parts[0]);
        return `${bookMeta?.name ?? parts[0]} ${parts[1]}:${parts[2]}`;
    });

    $effect(() => {
        if (!ui.hoverPreview.isOpen || !ui.hoverPreview.osisId || !ui.hoverPreview.translationId) {
            verseRecord = null;
            opacity = 0;
            return;
        }

        const osisId = ui.hoverPreview.osisId;
        const transId = ui.hoverPreview.translationId;

        loading = true;
        let active = true;
        
        getVerse(transId, osisId).then(v => {
            if (!active) return;
            verseRecord = v ?? null;
            loading = false;
        });
        
        return () => { active = false; };
    });

    // Positioning logic
    $effect(() => {
        if (ui.hoverPreview.isOpen && ui.hoverPreview.triggerEl && popoverEl) {
            // Read layout in rAF to ensure CSS/styling is applied
            requestAnimationFrame(() => {
                if (!popoverEl || !ui.hoverPreview.triggerEl) return;
                const rect = ui.hoverPreview.triggerEl.getBoundingClientRect();
                const popRect = popoverEl.getBoundingClientRect();
                
                // Default position: above the element, centered.
                let calcTop = rect.top - popRect.height - 8;
                let calcLeft = rect.left + rect.width / 2 - popRect.width / 2;

                // Adjust if offscreen vertically
                if (calcTop < 10) {
                    calcTop = rect.bottom + 8;
                }

                // Adjust if offscreen horizontally
                if (calcLeft < 10) {
                    calcLeft = 10;
                } else if (calcLeft + popRect.width > window.innerWidth - 10) {
                    calcLeft = window.innerWidth - popRect.width - 10;
                }

                top = calcTop;
                left = calcLeft;
                opacity = 1;
            });
        }
    });

    function handleClick() {
        if (!ui.hoverPreview.osisId) return;
        const parts = ui.hoverPreview.osisId.split('.');
        const book = parts[0];
        const chapter = parseInt(parts[1], 10);
        const verseNum = parseInt(parts[2], 10);
        
        forceClosePreview();
        onNavigate(book, chapter, verseNum);
    }
</script>

{#if ui.hoverPreview.isOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
        bind:this={popoverEl}
        class="verse-preview-card"
        style="top: {top}px; left: {left}px; opacity: {opacity}; pointer-events: {opacity === 1 ? 'auto' : 'none'};"
        onmouseenter={keepPreviewOpen}
        onmouseleave={closePreview}
        onclick={handleClick}
        role="tooltip"
    >
        <div class="vpc-header">
            <span class="vpc-ref">{formattedRef}</span>
            <span class="vpc-trans">{ui.hoverPreview.translationId}</span>
        </div>
        <div class="vpc-body">
            {#if loading}
                <div class="vpc-loading">
                    <div class="vpc-shimmer"></div>
                    <div class="vpc-shimmer short"></div>
                </div>
            {:else if verseRecord}
                <p class="vpc-text">{verseRecord.text}</p>
            {:else}
                <p class="vpc-text vpc-error">Verse text not available.</p>
            {/if}
            <div class="vpc-hint">Click to jump &rarr;</div>
        </div>
    </div>
{/if}

<style>
    .verse-preview-card {
        position: fixed;
        z-index: 10000;
        width: 300px;
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg), 0 4px 20px rgba(0,0,0,0.15);
        padding: var(--space-3) var(--space-4);
        transition: opacity 0.15s ease-out;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        will-change: top, left, opacity;
    }
    
    .verse-preview-card:hover {
        border-color: var(--color-accent);
    }

    .vpc-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid var(--color-border-subtle);
        padding-bottom: var(--space-2);
    }

    .vpc-ref {
        font-family: var(--font-ui);
        font-weight: 700;
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
    }

    .vpc-trans {
        font-family: var(--font-ui);
        font-weight: 600;
        font-size: 10px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--color-text-muted);
        background: var(--color-bg-hover);
        padding: 2px 6px;
        border-radius: var(--radius-sm);
    }

    .vpc-body {
        margin-top: 2px;
    }

    .vpc-text {
        font-family: var(--font-scripture);
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: var(--color-text-secondary);
        margin: 0 0 var(--space-2);
        display: -webkit-box;
        line-clamp: 4;
        -webkit-line-clamp: 4;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    
    .vpc-error {
        color: var(--color-danger);
        font-style: italic;
    }

    .vpc-hint {
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: 600;
        color: var(--color-accent);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        opacity: 0;
        transition: opacity var(--transition-fast);
        margin-top: var(--space-1);
    }

    .verse-preview-card:hover .vpc-hint {
        opacity: 1;
    }

    /* Loading Shimmer */
    .vpc-loading {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        padding: var(--space-1) 0;
    }

    .vpc-shimmer {
        height: 12px;
        background: linear-gradient(90deg, var(--color-bg-surface) 25%, var(--color-bg-hover) 50%, var(--color-bg-surface) 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
        border-radius: 2px;
        width: 100%;
    }
    .vpc-shimmer.short { width: 60%; }

    @keyframes shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
    }
</style>
