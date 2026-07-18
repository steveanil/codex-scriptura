<script lang="ts">
    import { verseHover } from '$lib/actions/verseHover';
    import { parseDefinition } from '$lib/utils/dictionary';

    let {
        definition,
        translationId = 'KJV',
        onNavigate,
    }: {
        definition: string;
        translationId?: string;
        /** Called when a scripture ref is clicked; refs render as plain text without it */
        onNavigate?: (book: string, chapter: number, verse: number) => void;
    } = $props();

    const senses = $derived(parseDefinition(definition));
</script>

{#each senses as sense, i (i)}
    <p class="dict-sense">
        {#if sense.marker}<span class="sense-marker">{sense.marker}</span>{/if}
        {#each sense.segments as seg}
            {#if seg.type === 'ref'}
                <button
                    class="dict-ref"
                    use:verseHover={{ osisId: `${seg.book}.${seg.chapter}.${seg.verse}`, translationId }}
                    onclick={() => onNavigate?.(seg.book, seg.chapter, seg.verse)}
                >{seg.label}</button>
            {:else}{seg.text}{/if}
        {/each}
    </p>
{/each}

<style>
    .dict-sense {
        /* Size comes from the host context (12px entity panel, sm word card) */
        font-size: inherit;
        color: var(--color-text-secondary);
        line-height: 1.6;
        margin: 0 0 var(--space-2);
    }
    .dict-sense:last-child {
        margin-bottom: 0;
    }
    .sense-marker {
        font-weight: 700;
        color: var(--color-accent);
        margin-right: 4px;
    }
    .dict-ref {
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        color: var(--color-accent);
        cursor: pointer;
        transition: color var(--transition-fast);
    }
    .dict-ref:hover,
    .dict-ref:focus-visible {
        color: var(--color-accent-hover);
        text-decoration: underline;
    }
</style>
