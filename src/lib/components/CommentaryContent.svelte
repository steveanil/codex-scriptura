<script lang="ts">
    import { parseCommentaryMarkdown, commentaryBlockKeys, sourceLocatorUrl, type CommentaryInline, type CommentaryExcerptMeta, type CommentarySourceLocator } from '@codex-scriptura/core';

    /**
     * Renders Codex Commentary Markdown (issue #83) from the parser's tokens.
     * The content is never interpreted as HTML: every element here is one
     * of the parser's node kinds, so arbitrary stored text can only ever
     * produce paragraphs, quotes, headings, strong, emphasis, http(s) links
     * and line breaks.
     *
     * With `excerpts` (issue #85) each excerpt that has a record shows what
     * is known of its margin citation and links to the scanned page it was
     * read from. A record is matched to its block by the block's own text,
     * so one made for another reading attaches to nothing. The citation
     * itself stays plain text whatever its status.
     */
    let { content, excerpts, source }: { content: string; excerpts?: CommentaryExcerptMeta[]; source?: CommentarySourceLocator } = $props();
    const blocks = $derived(parseCommentaryMarkdown(content));
    const records = $derived.by(() => {
        if (!excerpts?.length) return [];
        const byKey = new Map(excerpts.map((x) => [x.key, x]));
        return commentaryBlockKeys(content).map((k) => byKey.get(k));
    });
    const checkedBy = (x: CommentaryExcerptMeta) => `${x.reviewer === 'human' ? 'by a person' : 'by an AI reading, not yet read by a person'}${x.reviewed ? `, ${x.reviewed}` : ''}`;
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
        {@const meta = records[i]}
        {#if meta}
            <div class="excerpt-meta" data-citation={meta.citation ?? 'none'}>
                {#if meta.citation === 'checked'}
                    <span class="status checked" title="The margin citation was read against the scanned page {checkedBy(meta)}">Citation checked against the page <small>({checkedBy(meta)})</small></span>
                {:else if meta.citation === 'unverified'}
                    <span class="status unverified" title="The citation is what the OCR read in the margin of the scan; nobody has checked it against the page">Citation unverified (OCR reading)</span>
                {:else if meta.citation === 'unresolved'}
                    <span class="status unresolved">Citation unresolved</span>
                {/if}
                {#if meta.text === 'possibly-incomplete'}
                    <span class="status incomplete" title="A comparison suggests words are missing here and the page has not been read to settle it">This excerpt may be incomplete</span>
                {/if}
                {#if source}
                    <a class="page-link" href={sourceLocatorUrl({ ...source, leafStart: meta.leaf, leafEnd: meta.leaf })} target="_blank" rel="noopener noreferrer">Scanned page</a>
                    {#each Array.from({ length: (meta.leafEnd ?? meta.leaf) - meta.leaf }, (_, k) => meta.leaf + k + 1) as next (next)}
                        <a class="page-link" href={sourceLocatorUrl({ ...source, leafStart: next, leafEnd: next })} target="_blank" rel="noopener noreferrer">next page</a>
                    {/each}
                {/if}
                {#if meta.question}
                    <p class="question">Open question{meta.issue ? ` (#${meta.issue})` : ''}: {meta.question}</p>
                {/if}
            </div>
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
    .commentary p:has(+ .excerpt-meta) { margin-bottom: var(--space-1); }
    .excerpt-meta {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--space-1) var(--space-3);
        margin: 0 0 var(--space-3);
        font-size: var(--font-size-xs, 0.75rem);
        color: var(--color-text-secondary);
    }
    .status::before {
        content: '';
        display: inline-block;
        width: 0.5em;
        height: 0.5em;
        margin-right: 0.4em;
        border-radius: 50%;
        border: 1px solid currentColor;
    }
    .status.checked::before { background: currentColor; }
    .status.unresolved, .status.incomplete { color: var(--color-warning, var(--color-text-primary)); font-weight: 600; }
    .status small { font-size: inherit; opacity: 0.85; }
    .excerpt-meta .question { flex-basis: 100%; margin: 0; font-style: italic; }
    a {
        color: var(--color-accent);
        text-decoration: underline;
        text-underline-offset: 2px;
    }
</style>
