<script lang="ts">
    import { parseCommentaryMarkdown, type CommentaryInline } from '@codex-scriptura/core';

    /**
     * Renders Codex Commentary Markdown (issue #83) from the parser's tokens.
     * The content is never interpreted as HTML: every element here is one
     * of the parser's node kinds, so arbitrary stored text can only ever
     * produce paragraphs, quotes, headings, strong, emphasis, http(s) links
     * and line breaks.
     */
    let { content }: { content: string } = $props();
    const blocks = $derived(parseCommentaryMarkdown(content));
</script>

{#snippet inline(nodes: CommentaryInline[])}
    {#each nodes as node, i (i)}
        {#if node.type === 'text'}{node.text}{:else if node.type === 'break'}<br />{:else if node.type === 'strong'}<strong>{@render inline(node.children)}</strong>{:else if node.type === 'em'}<em>{@render inline(node.children)}</em>{:else}<a href={node.href} target="_blank" rel="noopener noreferrer">{@render inline(node.children)}</a>{/if}
    {/each}
{/snippet}

<div class="commentary">
    {#each blocks as block, i (i)}
        {#if block.type === 'heading'}
            <h4>{@render inline(block.children)}</h4>
        {:else if block.type === 'quote'}
            <blockquote>{@render inline(block.children)}</blockquote>
        {:else}
            <p>{@render inline(block.children)}</p>
        {/if}
    {/each}
</div>

<style>
    .commentary {
        font-size: var(--font-size-sm);
        line-height: 1.6;
        color: var(--color-text-primary);
    }
    .commentary p, .commentary blockquote, .commentary h4 { margin: 0 0 var(--space-3); }
    .commentary > :last-child { margin-bottom: 0; }
    h4 {
        font-size: var(--font-size-sm);
        font-weight: 600;
    }
    blockquote {
        padding-left: var(--space-3);
        border-left: 2px solid var(--color-border);
        color: var(--color-text-secondary);
    }
    a {
        color: var(--color-accent);
        text-decoration: underline;
        text-underline-offset: 2px;
    }
</style>
