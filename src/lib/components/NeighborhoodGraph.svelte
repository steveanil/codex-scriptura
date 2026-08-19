<script lang="ts">
    import { getNeighborhood, DEFAULT_MAX_NODES } from '$lib/engines/graph';
    import Button from '$lib/components/ui/Button.svelte';
    import {
        layoutNeighborhood,
        NEIGHBORHOOD_VIEW,
        VERSE_OT_COLOR,
        VERSE_NT_COLOR,
        PERSON_COLOR,
        PLACE_COLOR,
        EVENT_COLOR,
        type NeighborhoodLayout,
        type PlacedNode,
    } from '$lib/engines/neighborhoodLayout';
    import { findBook } from '@codex-scriptura/core';
    import type { GraphEdge } from '@codex-scriptura/core';

    let {
        seed,
        onRecenter,
        onOpenVerse,
        onBack,
    }: {
        /** Namespaced node ID: verse:Gen.1.1, person:moses_1, ... */
        seed: string;
        onRecenter: (nodeId: string) => void;
        onOpenVerse: (osisId: string) => void;
        onBack: () => void;
    } = $props();

    let hops = $state(1);
    let loading = $state(true);
    let truncated = $state(false);
    let layout = $state<NeighborhoodLayout | null>(null);
    let selectedId = $state<string | null>(null);

    // Guards interleaved loads on rapid recenter/hops clicks
    let loadGeneration = 0;
    $effect(() => {
        const s = seed;
        const h = hops;
        const gen = ++loadGeneration;
        loading = true;
        getNeighborhood(s, h).then((result) => {
            if (gen !== loadGeneration) return;
            layout = layoutNeighborhood(s, result.nodes, result.edges);
            truncated = result.truncated;
            selectedId = s;
            loading = false;
        });
    });

    const seedPlaced = $derived(layout?.nodes.find((p) => p.node.id === seed) ?? null);
    const selected = $derived(
        (selectedId && layout?.nodes.find((p) => p.node.id === selectedId)) || seedPlaced
    );

    const stats = $derived({
        nodes: layout?.nodes.length ?? 0,
        edges: layout?.edges.length ?? 0,
        verses: layout?.nodes.filter((p) => p.node.type === 'verse').length ?? 0,
        entities: layout?.nodes.filter((p) => p.node.type !== 'verse').length ?? 0,
    });

    // Neighbor IDs of the selected node - used to keep context visible
    // while everything unrelated fades back (same pattern as the ring).
    const selectedNeighbors = $derived.by(() => {
        const ids = new Set<string>();
        if (!selectedId || !layout) return ids;
        for (const { edge } of layout.edges) {
            if (edge.source === selectedId) ids.add(edge.target);
            if (edge.target === selectedId) ids.add(edge.source);
        }
        return ids;
    });

    function typeLabel(t: string): string {
        return t === 'verse' ? 'Verse' : t === 'person' ? 'Person' : t === 'place' ? 'Place' : 'Event';
    }

    function edgeStroke(edge: GraphEdge): string {
        if (edge.category === 'entity-mention') {
            return edge.type === 'person' ? PERSON_COLOR : edge.type === 'place' ? PLACE_COLOR : EVENT_COLOR;
        }
        // Cross-references: warm when the link crosses testaments, cool inside one
        const books = [edge.source, edge.target]
            .filter((id) => id.startsWith('verse:'))
            .map((id) => findBook(id.slice('verse:'.length).split('.')[0])?.testament);
        return books[0] !== books[1] ? '#d99a4a' : '#8f8ef6';
    }

    function edgeEmphasis(edge: GraphEdge): boolean {
        return selectedId !== null && (edge.source === selectedId || edge.target === selectedId);
    }

    function handleNodeClick(p: PlacedNode) {
        // First click inspects; a second click on the inspected node refocuses
        if (selectedId === p.node.id && p.node.id !== seed) {
            onRecenter(p.node.id);
        } else {
            selectedId = p.node.id;
        }
    }

    function osisOf(nodeId: string): string | null {
        return nodeId.startsWith('verse:') ? nodeId.slice('verse:'.length) : null;
    }

    const selectedVerseCount = $derived.by(() => {
        const data = selected?.node.data as { verseRefs?: string[] } | undefined;
        return data?.verseRefs?.length ?? null;
    });
</script>

<div class="graph-main">
    <div class="toolbar">
        <button class="back-chip" onclick={onBack} aria-label="Back to books overview">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
            </svg>
            Books
        </button>
        <h1 class="title">{seedPlaced?.node.label ?? '…'}</h1>
        <div class="hops-toggle" role="group" aria-label="Connection depth">
            <button class:active={hops === 1} onclick={() => (hops = 1)}>1 hop</button>
            <button class:active={hops === 2} onclick={() => (hops = 2)}>2 hops</button>
        </div>
        <span class="count">
            {#if loading}
                … loading
            {:else}
                {stats.verses} verses · {stats.entities} people, places &amp; events
                {#if truncated}
                    · first {DEFAULT_MAX_NODES} shown
                {/if}
            {/if}
        </span>
    </div>

    <div class="canvas-wrap">
        <svg viewBox="0 0 {NEIGHBORHOOD_VIEW.w} {NEIGHBORHOOD_VIEW.h}" preserveAspectRatio="xMidYMid meet">
            <rect
                x="0" y="0"
                width={NEIGHBORHOOD_VIEW.w} height={NEIGHBORHOOD_VIEW.h}
                fill="transparent"
                onclick={() => (selectedId = seed)}
                role="presentation"
            />
            {#if layout}
                {#each layout.edges as { edge, d } (edge.id)}
                    <path
                        class="edge"
                        {d}
                        fill="none"
                        stroke={edgeStroke(edge)}
                        stroke-width={edgeEmphasis(edge) ? 1.8 : 1}
                        stroke-dasharray={edge.category === 'entity-mention' ? '3 3' : 'none'}
                        opacity={selectedId === seed ? 0.45 : edgeEmphasis(edge) ? 0.75 : 0.1}
                    />
                {/each}

                {#each layout.nodes as p (p.node.id)}
                    {@const dimmed = selectedId !== seed && selectedId !== p.node.id && !selectedNeighbors.has(p.node.id)}
                    <circle
                        class="node"
                        cx={p.x} cy={p.y} r={p.r}
                        fill={p.fill}
                        opacity={dimmed ? 0.22 : 1}
                        stroke={p.node.id === selectedId ? '#ffffff' : p.depth === 0 ? 'rgba(255,255,255,.55)' : 'transparent'}
                        stroke-width={p.node.id === selectedId ? 2.5 : p.depth === 0 ? 1.5 : 0}
                        role="button"
                        tabindex="0"
                        aria-label="Inspect {p.node.label}"
                        onclick={() => handleNodeClick(p)}
                        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNodeClick(p); } }}
                    />
                    {#if p.showLabel}
                        <text
                            class="node-label"
                            class:entity={p.node.type !== 'verse'}
                            class:focused={p.node.id === selectedId}
                            x={p.lx} y={p.ly}
                            text-anchor={p.anchor}
                            opacity={dimmed ? 0.15 : 0.85}
                        >{p.node.label}</text>
                    {/if}
                {/each}
            {/if}
        </svg>

        <div class="legend">
            <span class="legend-item"><span class="dot" style="background:{VERSE_OT_COLOR}"></span>OT verse</span>
            <span class="legend-item"><span class="dot" style="background:{VERSE_NT_COLOR}"></span>NT verse</span>
            <span class="legend-item"><span class="dot" style="background:{PERSON_COLOR}"></span>Person</span>
            <span class="legend-item"><span class="dot" style="background:{PLACE_COLOR}"></span>Place</span>
            <span class="legend-item"><span class="dot" style="background:{EVENT_COLOR}"></span>Event</span>
            <span class="legend-note">· dashed = mentioned in</span>
        </div>
    </div>
</div>

<aside class="side-panel">
    {#if selected}
        <div class="node-head">
            <span class="node-dot" style="background:{selected.fill}"></span>
            <span class="node-name">{selected.node.label}</span>
        </div>
        <div class="node-sub">
            {typeLabel(selected.node.type)}
            {#if selected.depth > 0}
                · {selected.depth} hop{selected.depth > 1 ? 's' : ''} out
            {:else}
                · focus of this graph
            {/if}
        </div>

        <div class="stat-row">
            <div class="stat-card">
                <div class="stat-num">{selectedNeighbors.size || stats.nodes - 1}</div>
                <div class="stat-label">connections here</div>
            </div>
            {#if selectedVerseCount !== null}
                <div class="stat-card">
                    <div class="stat-num">{selectedVerseCount}</div>
                    <div class="stat-label">verses overall</div>
                </div>
            {/if}
        </div>

        <div class="actions">
            {#if osisOf(selected.node.id)}
                <Button variant="primary" fullWidth onclick={() => onOpenVerse(osisOf(selected.node.id)!)}>Open in reader</Button>
            {/if}
            {#if selected.node.id !== seed}
                <Button variant="secondary" fullWidth onclick={() => onRecenter(selected.node.id)}>Focus graph here</Button>
            {/if}
        </div>

        {#if truncated && selected.node.id === seed}
            <p class="hint-text">
                This neighborhood is larger than {DEFAULT_MAX_NODES} nodes - only the
                first {DEFAULT_MAX_NODES} are drawn. Focus a neighbor to explore further out.
            </p>
        {/if}
        <p class="hint-text">
            Click a node to inspect it; click it again to make it the new focus.
            Solid lines are cross-references, dashed lines connect people, places
            and events to the verses that mention them.
        </p>
    {/if}
</aside>

<style>
    .graph-main {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
    }
    .toolbar {
        height: 56px;
        flex: none;
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 0 20px;
        border-bottom: 1px solid var(--color-border-subtle);
    }
    .back-chip {
        height: 32px;
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 0 12px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        font-family: var(--font-ui);
        font-size: 12.5px;
        font-weight: 500;
        color: #c3cad4;
        cursor: pointer;
        white-space: nowrap;
        transition: background var(--transition-fast), color var(--transition-fast);
    }
    .back-chip:hover {
        background: rgba(255, 255, 255, 0.08);
        color: var(--color-text-primary);
    }
    .title {
        font-size: 17px;
        font-weight: 600;
        letter-spacing: -0.01em;
        color: var(--color-text-primary);
        margin: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .hops-toggle {
        display: flex;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        overflow: hidden;
    }
    .hops-toggle button {
        height: 30px;
        padding: 0 12px;
        background: transparent;
        border: none;
        font-family: var(--font-ui);
        font-size: 12px;
        font-weight: 500;
        color: #9aa3b0;
        cursor: pointer;
        transition: background var(--transition-fast), color var(--transition-fast);
    }
    .hops-toggle button.active {
        background: rgba(255, 255, 255, 0.09);
        color: var(--color-text-primary);
    }
    .count {
        margin-left: auto;
        font-family: var(--font-mono);
        font-size: 11.5px;
        color: var(--color-text-faint);
        white-space: nowrap;
    }
    .canvas-wrap {
        flex: 1;
        min-height: 0;
        position: relative;
        display: flex;
    }
    svg {
        width: 100%;
        height: 100%;
    }
    .node {
        cursor: pointer;
        transition: opacity var(--transition-fast);
    }
    .node:focus-visible {
        outline: 2px solid var(--color-accent);
        outline-offset: 2px;
    }
    .edge {
        pointer-events: none;
        transition: opacity var(--transition-fast);
    }
    .node-label {
        font-family: var(--font-ui);
        font-size: 10.5px;
        fill: #aab3bf;
        pointer-events: none;
        transition: opacity var(--transition-fast);
    }
    .node-label.entity {
        font-size: 11.5px;
        font-weight: 600;
        fill: #cdd5df;
    }
    .node-label.focused {
        fill: #ffffff;
        font-weight: 600;
    }
    .legend {
        position: absolute;
        left: 20px;
        bottom: 16px;
        display: flex;
        align-items: center;
        gap: 14px;
        font-family: var(--font-ui);
        font-size: 11.5px;
        color: #9aa3b0;
        flex-wrap: wrap;
    }
    .legend-item {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .legend .dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
    }
    .legend-note {
        color: var(--color-text-faint);
    }

    .side-panel {
        width: 320px;
        flex: none;
        background: var(--color-bg-elevated);
        border-left: 1px solid var(--color-border-subtle);
        padding: 22px 20px;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
    }
    .node-head {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 4px;
    }
    .node-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        flex: none;
    }
    .node-name {
        font-size: 17px;
        font-weight: 600;
        color: var(--color-text-primary);
    }
    .node-sub {
        font-size: 12.5px;
        color: var(--color-text-faint);
        margin-bottom: 18px;
    }
    .stat-row {
        display: flex;
        gap: 10px;
        margin-bottom: 18px;
    }
    .stat-card {
        flex: 1;
        padding: 12px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 10px;
    }
    .stat-num {
        font-size: 20px;
        font-weight: 650;
        color: var(--color-text-primary);
    }
    .stat-label {
        font-size: 11px;
        color: var(--color-text-faint);
        margin-top: 2px;
    }
    .actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 18px;
    }
    .hint-text {
        margin: 0 0 14px;
        font-size: 13px;
        line-height: 1.6;
        color: #b7bfca;
    }

    @media (max-width: 768px) {
        .side-panel {
            width: 100%;
            border-left: none;
            border-top: 1px solid var(--color-border-subtle);
            max-height: 40%;
        }
        .count {
            display: none;
        }
    }
</style>
