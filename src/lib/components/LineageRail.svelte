<script lang="ts">
    import { ui } from '$lib/stores/ui.svelte';
    import Button from '$lib/components/ui/Button.svelte';
    import {
        buildRailRows,
        ancestryPath,
        subtreeCount,
        branchColor,
        NATIONS,
    } from '$lib/data/table-of-nations';

    let {
        rootId,
        onReroot,
    }: {
        rootId: string;
        onReroot: (id: string) => void;
    } = $props();

    const rows = $derived(buildRailRows(rootId));
    const crumb = $derived(ancestryPath(rootId));
    const count = $derived(subtreeCount(rootId));
    const rootName = $derived(NATIONS[rootId]?.name ?? rootId);

    function openFullTree() {
        // Escalate the peek into the explorer, rooted on whatever the rail shows
        ui.openGenealogyTree(rootId);
    }
</script>

<!-- The Study Rail header names the tab and the seed verse; this is the
     tree itself. -->
<div class="lineage-rail">
    <!-- Breadcrumb -->
    <nav class="rail-crumb" aria-label="Ancestry breadcrumb">
        <button class="crumb-home" aria-label="Back to Noah" title="Back to Noah" onclick={() => onReroot('noah')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
        </button>
        {#each crumb as person (person.id)}
            <span class="crumb-sep">/</span>
            <button class="crumb-link" onclick={() => onReroot(person.id)}>{person.name}</button>
        {/each}
    </nav>

    <!-- Indented tree -->
    <div class="rail-rows">
        {#each rows as row (row.id)}
            <button
                class="rail-row"
                style="--indent: {14 + row.depth * 22}px"
                onclick={() => onReroot(row.id)}
            >
                <span class="row-dot" style="background:{branchColor(row.branch)}"></span>
                <span class="row-name depth-{Math.min(row.depth, 2)}">{row.name}</span>
                <span class="row-relation" class:focused={row.depth === 0}>{row.relation}</span>
            </button>
        {/each}
    </div>

    <!-- Escalate -->
    <div class="rail-footer">
        <Button variant="secondary" size="lg" fullWidth onclick={openFullTree}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" />
            </svg>
            Open in full tree
        </Button>
        <div class="rail-count">{count} descendants under {rootName}</div>
    </div>
</div>

<style>
    .lineage-rail {
        display: flex;
        flex-direction: column;
        flex: 1;
        height: 100%;
        min-height: 0;
        background: var(--color-bg-elevated);
    }

    /* ── Breadcrumb ── */
    .rail-crumb {
        flex: none;
        display: flex;
        align-items: center;
        gap: 5px;
        flex-wrap: wrap;
        padding: 12px 18px;
        border-bottom: 1px solid var(--color-border-subtle);
    }
    .crumb-home {
        background: none;
        border: none;
        padding: 0;
        margin-right: 2px;
        display: flex;
        color: var(--color-accent-hover);
        cursor: pointer;
    }
    .crumb-link {
        background: none;
        border: none;
        padding: 0;
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 500;
        line-height: 1;
        color: var(--color-accent-hover);
        cursor: pointer;
    }
    .crumb-link:hover {
        text-decoration: underline;
    }
    .crumb-sep {
        color: var(--color-text-muted);
        font-size: var(--font-size-2xs);
    }

    /* ── Indented rows ── */
    .rail-rows {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 8px 12px;
    }
    .rail-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-left: var(--indent, 14px);
        width: calc(100% - var(--indent, 14px));
        min-height: var(--row-h-md);
        padding: 0 10px;
        border: none;
        background: none;
        border-radius: var(--radius-md);
        cursor: pointer;
        text-align: left;
        transition: background var(--transition-fast);
    }
    .rail-row:hover {
        background: var(--color-bg-surface);
    }
    .row-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        flex: none;
    }
    .row-name {
        font-family: var(--font-ui);
    }
    .row-name.depth-0 {
        font-size: var(--font-size-md);
        font-weight: 700;
        color: var(--color-text-primary);
    }
    .row-name.depth-1 {
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: var(--color-text-primary);
    }
    .row-name.depth-2 {
        font-size: var(--font-size-sm);
        font-weight: 500;
        color: var(--color-text-secondary);
    }
    .row-relation {
        margin-left: auto;
        font-family: var(--font-ui);
        font-size: var(--font-size-2xs);
        font-weight: 500;
        line-height: 1;
        color: var(--color-text-muted);
        background: var(--color-bg-surface);
        padding: 3px 7px;
        border-radius: var(--radius-xs);
        white-space: nowrap;
    }
    .row-relation.focused {
        color: var(--cat-branch-root);
        background: color-mix(in srgb, var(--cat-branch-root) 16%, transparent);
    }

    /* ── Escalate footer ── */
    .rail-footer {
        flex: none;
        padding: 14px 16px;
        border-top: 1px solid var(--color-border-subtle);
    }
    .rail-count {
        text-align: center;
        margin-top: 9px;
        font-size: var(--font-size-2xs);
        color: var(--color-text-muted);
    }
</style>
