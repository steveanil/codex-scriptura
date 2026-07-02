<script lang="ts">
    import { untrack } from 'svelte';
    import * as d3 from 'd3-force';
    import { buildPersonSubgraph } from '$lib/engines/genealogy';
    import type { GraphNode, GraphEdge } from '@codex-scriptura/core';

    let {
        seedPersonId,
        onClose
    }: {
        seedPersonId: string;
        onClose: () => void;
    } = $props();

    // ── Local State ──
    /** Current seed — initialized from prop, updated on node click (recenter). */
    let currentSeed = $state('');
    let currentSeedLabel = $state('');
    let seedHistory = $state<string[]>([]);

    let depth = $state(2);
    let loading = $state(true);
    let truncated = $state(false);
    let containerW = $state(320);
    let containerH = $state(600);

    let nodes = $state<(GraphNode & d3.SimulationNodeDatum)[]>([]);
    let edges = $state<(GraphEdge & d3.SimulationLinkDatum<GraphNode & d3.SimulationNodeDatum>)[]>([]);

    let simulation: d3.Simulation<GraphNode & d3.SimulationNodeDatum, undefined> | null = null;
    let svgContainer: HTMLDivElement | undefined = undefined;

    // ── Pan + Zoom state ──
    let vbX = $state(0);
    let vbY = $state(0);
    let vbW = $state(320);
    let vbH = $state(600);
    let isPanning = $state(false);
    let panStartX = 0;
    let panStartY = 0;
    let panStartVbX = 0;
    let panStartVbY = 0;

    // Per-edge text labels are noise on big trees — only show them for small
    // trees or once the user has zoomed in enough to read them.
    const showEdgeLabels = $derived(nodes.length <= 12 || (vbW > 0 && containerW / vbW >= 1.4));

    // Sync when the parent changes the prop
    $effect(() => {
        currentSeed = seedPersonId;
        seedHistory = [];
    });

    // Refit the tree when the container is resized (e.g. panel drag-resize).
    // Only container dimensions may be dependencies here — tracking nodes/vb*
    // would make this refire on every simulation tick and clobber pan/zoom.
    $effect(() => {
        void containerW;
        void containerH;
        untrack(() => {
            if (!loading && nodes.length > 0) fitToContent();
        });
    });

    function edgeLabel(type: string): string {
        switch (type) {
            case 'father-of': return 'father';
            case 'mother-of': return 'mother';
            case 'spouse-of': return 'spouse';
            case 'sibling-of': return 'sibling';
            case 'half-sibling-same-father': return 'half-sibling';
            case 'ancestor-of': return 'ancestor';
            default: return type.replace(/-/g, ' ');
        }
    }

    function recenterOn(personId: string) {
        seedHistory = [...seedHistory, currentSeed];
        currentSeed = personId;
    }

    function goBack() {
        if (seedHistory.length === 0) return;
        const prev = seedHistory[seedHistory.length - 1];
        seedHistory = seedHistory.slice(0, -1);
        currentSeed = prev;
    }

    function resetView() {
        vbX = 0;
        vbY = 0;
        vbW = containerW;
        vbH = containerH;
    }

    function fitToContent() {
        if (nodes.length === 0) return resetView();
        const pad = 50;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const n of nodes) {
            minX = Math.min(minX, n.x ?? 0);
            maxX = Math.max(maxX, n.x ?? 0);
            minY = Math.min(minY, n.y ?? 0);
            maxY = Math.max(maxY, n.y ?? 0);
        }
        let w = maxX - minX + pad * 2;
        let h = maxY - minY + pad * 2;
        const aspect = containerW / containerH;
        if (w / h > aspect) h = w / aspect;
        else w = h * aspect;
        // Never zoom in past 1:1 — small trees render centered at natural size
        if (w < containerW) { w = containerW; h = containerH; }
        vbX = (minX + maxX) / 2 - w / 2;
        vbY = (minY + maxY) / 2 - h / 2;
        vbW = w;
        vbH = h;
    }

    /**
     * Assign each person a generation relative to the seed (0), walking
     * parent edges down (+1) / up (-1) and keeping spouses/siblings level.
     * Used to band the layout vertically: ancestors above, descendants below.
     */
    function assignGenerations(
        rawNodes: (GraphNode & d3.SimulationNodeDatum)[],
        rawEdges: GraphEdge[],
        seedNodeId: string
    ): Map<string, number> {
        const DOWN = new Set(['father-of', 'mother-of', 'ancestor-of']);
        const adj = new Map<string, { other: string; delta: number }[]>();
        for (const e of rawEdges) {
            const s = typeof e.source === 'string' ? e.source : (e.source as GraphNode).id;
            const t = typeof e.target === 'string' ? e.target : (e.target as GraphNode).id;
            const delta = DOWN.has(e.type) ? 1 : 0;
            if (!adj.has(s)) adj.set(s, []);
            if (!adj.has(t)) adj.set(t, []);
            adj.get(s)!.push({ other: t, delta });
            adj.get(t)!.push({ other: s, delta: -delta });
        }
        const gen = new Map<string, number>();
        const queue = [seedNodeId];
        gen.set(seedNodeId, 0);
        while (queue.length > 0) {
            const id = queue.shift()!;
            const g = gen.get(id)!;
            for (const { other, delta } of adj.get(id) ?? []) {
                if (!gen.has(other)) {
                    gen.set(other, g + delta);
                    queue.push(other);
                }
            }
        }
        for (const n of rawNodes) if (!gen.has(n.id)) gen.set(n.id, 0);
        return gen;
    }

    // ── Data Fetching & Layout ──
    $effect(() => {
        let active = true;

        async function loadGraph() {
            if (!currentSeed) return;
            loading = true;

            try {
                const res = await buildPersonSubgraph(currentSeed, depth);
                if (!active) return;

                truncated = res.truncated;

                if (simulation) simulation.stop();

                const rawNodes = res.nodes.map((n: GraphNode) => ({ ...n }));
                const rawEdges = res.edges.map((e: GraphEdge) => ({
                    ...e,
                    source: e.source,
                    target: e.target
                }));

                const nodeCount = rawNodes.length;
                const chargeStrength = nodeCount > 40 ? -260 : nodeCount > 15 ? -200 : -150;
                const linkDist = nodeCount > 40 ? 90 : nodeCount > 15 ? 75 : 60;

                const seedNode = rawNodes.find(
                    (n: GraphNode & d3.SimulationNodeDatum) => (n.data as { id: string })?.id === currentSeed
                );
                currentSeedLabel = seedNode?.label ?? currentSeed.replace(/_/g, ' ');

                // Band people into generations: ancestors above, descendants below
                const generations = assignGenerations(rawNodes, res.edges, seedNode?.id ?? rawNodes[0]?.id ?? '');
                const BAND_HEIGHT = 110;

                simulation = d3.forceSimulation<GraphNode & d3.SimulationNodeDatum>(rawNodes as (GraphNode & d3.SimulationNodeDatum)[])
                    .force('charge', d3.forceManyBody().strength(chargeStrength))
                    .force('x', d3.forceX(containerW / 2).strength(0.05))
                    .force('y', d3.forceY<GraphNode & d3.SimulationNodeDatum>(
                        (d) => containerH / 2 + (generations.get(d.id) ?? 0) * BAND_HEIGHT
                    ).strength(0.9))
                    .force('collide', d3.forceCollide().radius(34))
                    .force('link', d3.forceLink(rawEdges)
                        .id((d: any) => d.id)
                        .distance(linkDist)
                        .strength(0.3)
                    )
                    .on('tick', () => {
                        nodes = [...rawNodes];
                        edges = [...rawEdges];
                    });

                // Settle the layout synchronously, then stop — otherwise the
                // auto-running simulation keeps drifting after we fit the view.
                simulation.stop();
                while (simulation.alpha() > simulation.alphaMin()) simulation.tick();
                nodes = [...rawNodes];
                edges = [...rawEdges];

                // Zoom out just enough to show the whole tree
                fitToContent();

                loading = false;
            } catch (err) {
                console.error("GenealogyViewer load error", err);
                loading = false;
            }
        }

        loadGraph();

        return () => {
            active = false;
            if (simulation) simulation.stop();
        };
    });

    // ── Node Drag ──
    let draggedNode: (GraphNode & d3.SimulationNodeDatum) | null = null;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    /** True once the pointer actually moved during a node drag — suppresses the recenter click */
    let dragMoved = false;

    function svgPoint(clientX: number, clientY: number): { x: number; y: number } {
        if (!svgContainer) return { x: clientX, y: clientY };
        const rect = svgContainer.getBoundingClientRect();
        // Map client coords to viewBox coords
        const scaleX = vbW / rect.width;
        const scaleY = vbH / rect.height;
        return {
            x: vbX + (clientX - rect.left) * scaleX,
            y: vbY + (clientY - rect.top) * scaleY,
        };
    }

    function handleNodePointerDown(e: PointerEvent, node: GraphNode & d3.SimulationNodeDatum) {
        if (!simulation) return;
        e.stopPropagation();
        draggedNode = node;
        dragMoved = false;
        const pt = svgPoint(e.clientX, e.clientY);
        dragOffsetX = (node.x ?? 0) - pt.x;
        dragOffsetY = (node.y ?? 0) - pt.y;
        node.fx = node.x;
        node.fy = node.y;
        simulation.alphaTarget(0.3).restart();
    }

    // ── Pan (background drag) ──
    function handleBgPointerDown(e: PointerEvent) {
        if (draggedNode) return; // node drag takes priority
        isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panStartVbX = vbX;
        panStartVbY = vbY;
    }

    function handlePointerMove(e: PointerEvent) {
        if (draggedNode && simulation) {
            dragMoved = true;
            const pt = svgPoint(e.clientX, e.clientY);
            draggedNode.fx = pt.x + dragOffsetX;
            draggedNode.fy = pt.y + dragOffsetY;
        } else if (isPanning && svgContainer) {
            const rect = svgContainer.getBoundingClientRect();
            const scaleX = vbW / rect.width;
            const scaleY = vbH / rect.height;
            vbX = panStartVbX - (e.clientX - panStartX) * scaleX;
            vbY = panStartVbY - (e.clientY - panStartY) * scaleY;
        }
    }

    function handlePointerUp() {
        if (draggedNode && simulation) {
            draggedNode.fx = null;
            draggedNode.fy = null;
            draggedNode = null;
            simulation.alphaTarget(0);
        }
        isPanning = false;
    }

    // ── Zoom (wheel) ──
    function handleWheel(e: WheelEvent) {
        e.preventDefault();
        if (!svgContainer) return;
        const rect = svgContainer.getBoundingClientRect();

        // Zoom factor
        const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;

        // Mouse position in viewBox coords before zoom
        const mx = vbX + ((e.clientX - rect.left) / rect.width) * vbW;
        const my = vbY + ((e.clientY - rect.top) / rect.height) * vbH;

        const newW = vbW * factor;
        const newH = vbH * factor;

        // Clamp: don't zoom in below 100px or out beyond 10x container
        if (newW < 100 || newW > containerW * 10) return;

        // Adjust origin so zoom centers on mouse
        vbX = mx - ((e.clientX - rect.left) / rect.width) * newW;
        vbY = my - ((e.clientY - rect.top) / rect.height) * newH;
        vbW = newW;
        vbH = newH;
    }
</script>

<div class="genealogy-wrapper">
    <div class="viewer-header">
        <div class="viewer-title-row">
            {#if seedHistory.length > 0}
                <button class="back-btn" aria-label="Go back" onclick={goBack}>&larr;</button>
            {/if}
            <h3 class="viewer-title">{currentSeedLabel || 'Genealogy Tree'}</h3>
        </div>
        <button class="close-btn" aria-label="Close Viewer" onclick={onClose}>&times;</button>
    </div>

    <!-- Controls -->
    <div class="controls">
        <label class="depth-control" title="How many generations away from {currentSeedLabel || 'this person'} to include">
            Generations: {depth}
            <input type="range" min="1" max="4" bind:value={depth} disabled={loading} />
        </label>
        {#if !loading && nodes.length > 0}
            <span class="count-badge">{nodes.length} people</span>
        {/if}
        <button class="reset-btn" onclick={fitToContent} title="Fit the whole tree in view">Fit</button>
        {#if truncated}
            <span class="warning-badge" title="Family too large — some relatives are not shown. Lower the generations slider.">Partial</span>
        {/if}
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="svg-container"
         bind:this={svgContainer}
         bind:clientWidth={containerW}
         bind:clientHeight={containerH}
         onpointerdown={handleBgPointerDown}
         onpointermove={handlePointerMove}
         onpointerup={handlePointerUp}
         onpointercancel={handlePointerUp}
         onwheel={handleWheel}>

        {#if loading}
            <div class="loading-state">
                <div class="loading-spinner"></div>
                <p>Loading tree...</p>
            </div>
        {:else if nodes.length === 0}
            <div class="empty-state">
                <p>No relationships found.</p>
            </div>
        {:else}
            <svg viewBox="{vbX} {vbY} {vbW} {vbH}" width="100%" height="100%">
                <defs>
                    <marker id="arrowhead" viewBox="0 -5 10 10" refX="22" refY="0" orient="auto" markerWidth="6" markerHeight="6">
                        <path d="M0,-3L6,0L0,3" fill="var(--color-border)" />
                    </marker>
                </defs>

                <!-- Edges -->
                <g class="edges">
                    {#each edges as edge (edge.id)}
                        {@const sx = (edge.source as any).x}
                        {@const sy = (edge.source as any).y}
                        {@const tx = (edge.target as any).x}
                        {@const ty = (edge.target as any).y}
                        {@const isParent = edge.type === 'father-of' || edge.type === 'mother-of'}
                        {@const isSpouse = edge.type === 'spouse-of'}
                        <line
                            x1={sx} y1={sy} x2={tx} y2={ty}
                            class="edge-line"
                            class:parent={isParent}
                            class:spouse={isSpouse}
                            marker-end={isParent ? 'url(#arrowhead)' : ''}
                            stroke-dasharray={isSpouse ? '4 3' : 'none'}
                        />
                        {#if showEdgeLabels}
                            <text
                                x={(sx + tx) / 2}
                                y={(sy + ty) / 2 - 4}
                                class="edge-type-label"
                            >{edgeLabel(edge.type)}</text>
                        {/if}
                    {/each}
                </g>

                <!-- Nodes -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <g class="nodes">
                    {#each nodes as node (node.id)}
                        {@const personData = node.data as { id: string }}
                        <g
                            class="node-group"
                            transform="translate({node.x},{node.y})"
                            class:seed={personData?.id === currentSeed}
                            onpointerdown={(e) => handleNodePointerDown(e, node)}
                            onclick={() => {
                                if (dragMoved) return;
                                if (personData?.id && personData.id !== currentSeed) {
                                    recenterOn(personData.id);
                                }
                            }}
                        >
                            <circle class="node-circle" r="16" />
                            <text class="node-label" dy=".35em" y="24">
                                {node.label}
                            </text>
                            <text class="node-initial" dy=".3em">
                                {node.label.charAt(0)}
                            </text>
                        </g>
                    {/each}
                </g>
            </svg>
        {/if}
    </div>

    <div class="legend-bar">
        <span class="legend-item"><svg width="22" height="8"><line x1="0" y1="4" x2="16" y2="4" class="legend-parent" /><path d="M16,1L21,4L16,7" class="legend-arrow" /></svg> parent</span>
        <span class="legend-item"><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" class="legend-spouse" /></svg> spouse</span>
        <span class="legend-item"><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" class="legend-sibling" /></svg> sibling</span>
        <span class="legend-hint">Click a person to recenter</span>
    </div>
</div>

<style>
    .genealogy-wrapper {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--color-bg-elevated);
    }

    .viewer-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--space-3) var(--space-4);
        border-bottom: 1px solid var(--color-border);
    }

    .viewer-title-row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-width: 0;
    }

    .viewer-title {
        font-family: var(--font-ui);
        font-size: var(--font-size-base);
        font-weight: 600;
        margin: 0;
        color: var(--color-text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .back-btn {
        background: none;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        cursor: pointer;
        padding: 2px 6px;
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
        line-height: 1;
        transition: color var(--transition-fast), background var(--transition-fast);
        flex-shrink: 0;
    }
    .back-btn:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
    }

    .close-btn {
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px;
        color: var(--color-text-muted);
        font-size: var(--font-size-lg);
        line-height: 1;
        transition: color var(--transition-fast);
        border-radius: 4px;
    }
    .close-btn:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
    }

    .controls {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--space-2) var(--space-3);
        padding: var(--space-2) var(--space-4);
        border-bottom: 1px solid var(--color-border-subtle);
        background: var(--color-bg-surface);
    }

    .depth-control {
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 600;
        color: var(--color-text-secondary);
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }

    .depth-control input[type="range"] {
        width: 80px;
    }

    .reset-btn {
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: 600;
        background: var(--color-bg-hover);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: 2px 8px;
        color: var(--color-text-muted);
        cursor: pointer;
        transition: color var(--transition-fast), background var(--transition-fast);
    }
    .reset-btn:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-surface);
    }

    .count-badge {
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: 600;
        color: var(--color-text-muted);
        white-space: nowrap;
    }

    .legend-bar {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-1) var(--space-4);
        border-top: 1px solid var(--color-border-subtle);
        background: var(--color-bg-surface);
        font-family: var(--font-ui);
        font-size: 10px;
        color: var(--color-text-muted);
        flex-shrink: 0;
        overflow: hidden;
    }
    .legend-item {
        display: flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
    }
    .legend-hint {
        margin-left: auto;
        white-space: nowrap;
        opacity: 0.8;
    }
    .legend-parent {
        stroke: var(--color-text-muted);
        stroke-width: 2;
    }
    .legend-arrow {
        fill: none;
        stroke: var(--color-text-muted);
        stroke-width: 1.5;
    }
    .legend-spouse {
        stroke: var(--color-accent);
        stroke-width: 1.5;
        stroke-dasharray: 4 3;
    }
    .legend-sibling {
        stroke: var(--color-border);
        stroke-width: 1.5;
    }

    .warning-badge {
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: 700;
        background: rgba(234, 179, 8, 0.15);
        color: #ca8a04;
        padding: 2px 6px;
        border-radius: var(--radius-sm);
        border: 1px solid rgba(234, 179, 8, 0.3);
    }

    .svg-container {
        flex: 1;
        position: relative;
        overflow: hidden;
        touch-action: none;
        cursor: grab;
    }
    .svg-container:active {
        cursor: grabbing;
    }

    .loading-state, .empty-state {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--space-3);
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
    }

    .loading-spinner {
        width: 24px;
        height: 24px;
        border: 2px solid var(--color-border);
        border-top-color: var(--color-accent);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* SVG Graphical Elements */
    .edge-line {
        stroke: var(--color-border);
        stroke-width: 1.5;
        opacity: 0.6;
    }
    .edge-line.parent {
        stroke: var(--color-text-muted);
        stroke-width: 2;
    }
    .edge-line.spouse {
        stroke: var(--color-accent);
        stroke-width: 1.5;
        opacity: 0.5;
    }

    .edge-type-label {
        font-family: var(--font-ui);
        font-size: 8px;
        fill: var(--color-text-muted);
        text-anchor: middle;
        pointer-events: none;
        opacity: 0.7;
    }

    .node-group {
        cursor: pointer;
        transition: opacity var(--transition-fast);
    }
    .node-group:hover {
        opacity: 0.8;
    }

    .node-circle {
        fill: var(--color-bg-surface);
        stroke: var(--color-border);
        stroke-width: 2;
        transition: fill var(--transition-fast), stroke var(--transition-fast);
    }

    .node-group:hover .node-circle {
        stroke: var(--color-accent);
    }

    .node-group.seed .node-circle {
        fill: var(--color-accent-subtle);
        stroke: var(--color-accent);
        stroke-width: 3;
    }

    .node-label {
        font-family: var(--font-ui);
        font-size: 11px;
        font-weight: 500;
        fill: var(--color-text-secondary);
        text-anchor: middle;
        pointer-events: none;
    }

    .node-group.seed .node-label {
        font-weight: 700;
        fill: var(--color-text-primary);
    }

    .node-initial {
        font-family: var(--font-ui);
        font-size: 14px;
        font-weight: 600;
        fill: var(--color-text-muted);
        text-anchor: middle;
        pointer-events: none;
    }

    .node-group.seed .node-initial {
        fill: var(--color-accent);
    }
</style>
