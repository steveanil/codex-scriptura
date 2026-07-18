<script lang="ts">
    import { ui } from '$lib/stores/ui.svelte';
    import {
        buildRailRows,
        ancestryPath,
        subtreeCount,
        branchColor,
        NATIONS,
    } from '$lib/data/table-of-nations';

    let {
        rootId,
        sourceVerse = null,
        onReroot,
        onClose,
    }: {
        rootId: string;
        sourceVerse?: number | null;
        onReroot: (id: string) => void;
        onClose: () => void;
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

<div class="lineage-rail">
    <!-- Header -->
    <div class="rail-header">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e0a44a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="3" width="6" height="5" rx="1.5" />
            <rect x="3" y="16" width="6" height="5" rx="1.5" />
            <rect x="15" y="16" width="6" height="5" rx="1.5" />
            <path d="M12 8v4" /><path d="M6 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
        </svg>
        <span class="rail-title">Lineage</span>
        {#if sourceVerse !== null}
            <span class="rail-source">from verse {sourceVerse}</span>
        {/if}
        <button class="rail-close" aria-label="Close lineage rail" onclick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12" />
            </svg>
        </button>
    </div>

    <!-- Breadcrumb -->
    <nav class="rail-crumb" aria-label="Ancestry breadcrumb">
        <button class="crumb-home" aria-label="Back to Noah" onclick={() => onReroot('noah')}>
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
        <button class="open-tree-btn" onclick={openFullTree}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" />
            </svg>
            Open in full tree
        </button>
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

    /* ── Header ── */
    .rail-header {
        flex: none;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 16px 18px 14px;
        border-bottom: 1px solid var(--color-border-subtle);
    }
    .rail-title {
        font-size: 15px;
        font-weight: 600;
        color: var(--color-text-primary);
    }
    .rail-source {
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 500;
        color: var(--color-text-faint);
    }
    .rail-close {
        margin-left: auto;
        background: none;
        border: none;
        padding: 2px;
        display: flex;
        color: var(--color-text-muted);
        cursor: pointer;
        border-radius: 4px;
        transition: color var(--transition-fast);
    }
    .rail-close:hover {
        color: var(--color-text-primary);
    }

    /* ── Breadcrumb ── */
    .rail-crumb {
        flex: none;
        display: flex;
        align-items: center;
        gap: 5px;
        flex-wrap: wrap;
        padding: 12px 18px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
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
        font-size: 12px;
        font-weight: 500;
        line-height: 1;
        color: var(--color-accent-hover);
        cursor: pointer;
    }
    .crumb-link:hover {
        text-decoration: underline;
    }
    .crumb-sep {
        color: #4a5260;
        font-size: 11px;
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
        padding: 8px 10px;
        border: none;
        background: none;
        border-radius: 9px;
        cursor: pointer;
        text-align: left;
        transition: background var(--transition-fast);
    }
    .rail-row:hover {
        background: rgba(255, 255, 255, 0.04);
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
        font-size: 15px;
        font-weight: 700;
        color: #e7eaf0;
    }
    .row-name.depth-1 {
        font-size: 13.5px;
        font-weight: 600;
        color: #dfe4ec;
    }
    .row-name.depth-2 {
        font-size: 13.5px;
        font-weight: 500;
        color: #b7bfca;
    }
    .row-relation {
        margin-left: auto;
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: 500;
        line-height: 1;
        color: #9aa4b2;
        background: rgba(255, 255, 255, 0.05);
        padding: 3px 7px;
        border-radius: 5px;
        white-space: nowrap;
    }
    .row-relation.focused {
        color: #e0a44a;
        background: rgba(224, 164, 74, 0.16);
    }

    /* ── Escalate footer ── */
    .rail-footer {
        flex: none;
        padding: 14px 16px;
        border-top: 1px solid var(--color-border-subtle);
    }
    .open-tree-btn {
        width: 100%;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 9px;
        background: color-mix(in srgb, var(--color-accent) 14%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-accent) 28%, transparent);
        border-radius: 10px;
        color: var(--color-accent-hover);
        font-family: var(--font-ui);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: background var(--transition-fast);
    }
    .open-tree-btn:hover {
        background: color-mix(in srgb, var(--color-accent) 22%, transparent);
    }
    .rail-count {
        text-align: center;
        margin-top: 9px;
        font-size: 11.5px;
        color: var(--color-text-faint);
    }
</style>
