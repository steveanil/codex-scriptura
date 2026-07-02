<script lang="ts">
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import { BOOKS } from '@codex-scriptura/core';
    import type { GraphNode, GraphEdge, NeighborhoodResult, BookConnectionMatrix } from '@codex-scriptura/core';
    import { getNeighborhood, getBookCrossReferenceMatrix } from '$lib/engines/graph';
    import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from 'd3-force';
    import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';

    // ── Types ─────────────────────────────────────────────
    type SimNode = GraphNode & SimulationNodeDatum & { x: number; y: number; radius: number; fx?: number | null; fy?: number | null };
    type SimLink = SimulationLinkDatum<SimNode> & { data: GraphEdge };

    // ── View mode ─────────────────────────────────────────
    let viewMode = $state<'book' | 'verse'>('book');
    let verseInput = $state('Gen.1.1');
    let loading = $state(false);
    let truncated = $state(false);
    let nodeCount = $state(0);
    let edgeCount = $state(0);

    // ── Edge type filters ─────────────────────────────────
    const EDGE_TYPES = ['quotation', 'allusion', 'theme', 'keyword', 'parallel', 'unclassified'] as const;
    let activeEdgeTypes = $state<Set<string>>(new Set(EDGE_TYPES));

    function toggleEdgeType(t: string) {
        const next = new Set(activeEdgeTypes);
        if (next.has(t)) {
            if (next.size > 1) next.delete(t);
        } else {
            next.add(t);
        }
        activeEdgeTypes = next;
    }

    // ── Hover / selection ─────────────────────────────────
    let hoveredNode = $state<SimNode | null>(null);
    let selectedNode = $state<SimNode | null>(null);
    let mousePos = $state({ x: 0, y: 0 });

    // ── Canvas ────────────────────────────────────────────
    let canvasEl: HTMLCanvasElement;
    let width = $state(900);
    let height = $state(600);
    let simNodes: SimNode[] = [];
    let simLinks: SimLink[] = [];
    let simulation: ReturnType<typeof forceSimulation<SimNode>> | null = null;
    let animFrameId: number = 0;
    let transform = $state({ x: 0, y: 0, k: 1 });

    // ── Drag state ────────────────────────────────────────
    let draggedNode = $state<SimNode | null>(null);
    let didDrag = false;

    // ── Node colors ───────────────────────────────────────
    const NODE_COLORS: Record<string, string> = {
        verse:   '#6366f1', // indigo
        book:    '#f59e0b', // amber (fallback — overridden per-testament in book mode)
        person:  '#3b82f6', // blue
        place:   '#10b981', // emerald
        event:   '#f97316', // orange
        chapter: '#8b5cf6', // violet
    };

    // Feature 5: testament-based book colors
    const TESTAMENT_COLORS: Record<string, string> = {
        OT: '#f59e0b', // amber
        NT: '#6366f1', // indigo
    };

    const EDGE_TYPE_COLORS: Record<string, string> = {
        quotation:     '#ef4444',
        allusion:      '#f59e0b',
        theme:         '#8b5cf6',
        keyword:       '#64748b',
        parallel:      '#06b6d4',
        unclassified:  '#374151',
        person:        '#3b82f6',
        place:         '#10b981',
        event:         '#f97316',
    };

    // ── Book-level graph builder ──────────────────────────
    async function loadBookGraph() {
        loading = true;
        truncated = false;

        const matrix = await getBookCrossReferenceMatrix();

        // Build nodes from canonical book list
        const canonBooks = BOOKS.filter(b => b.testament === 'OT' || b.testament === 'NT');
        const nodes: SimNode[] = canonBooks.map((b, i) => {
            // Count total connections for this book
            const row = matrix.get(b.osisId);
            let totalRefs = 0;
            if (row) for (const count of row.values()) totalRefs += count;
            return {
                id: `book:${b.osisId}`,
                type: 'book' as const,
                label: b.abbrev,
                data: b,
                x: 0,
                y: 0,
                radius: Math.max(6, Math.min(22, 4 + Math.sqrt(totalRefs) * 0.3)),
                index: i,
            };
        });

        // Build edges from matrix — only include edges above a threshold
        const edges: SimLink[] = [];
        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        for (const [srcBook, targets] of matrix) {
            for (const [tgtBook, count] of targets) {
                if (srcBook === tgtBook) continue;
                if (count < 5) continue; // filter noise
                const src = nodeMap.get(`book:${srcBook}`);
                const tgt = nodeMap.get(`book:${tgtBook}`);
                if (!src || !tgt) continue;
                // Deduplicate: only keep one direction
                const edgeId = [srcBook, tgtBook].sort().join('-');
                if (edges.some(e => e.data.id === edgeId)) continue;
                edges.push({
                    source: src,
                    target: tgt,
                    data: {
                        id: edgeId,
                        source: `book:${srcBook}`,
                        target: `book:${tgtBook}`,
                        category: 'cross-reference',
                        type: 'unclassified',
                        weight: count,
                    },
                });
            }
        }

        simNodes = nodes;
        simLinks = edges;
        nodeCount = nodes.length;
        edgeCount = edges.length;
        startSimulation();
        loading = false;
    }

    // ── Verse-level neighborhood ──────────────────────────
    async function loadVerseGraph() {
        loading = true;
        truncated = false;

        const filters = {
            edgeTypes: [...activeEdgeTypes],
            maxNodes: 80,
        };

        const result: NeighborhoodResult = await getNeighborhood(
            `verse:${verseInput}`,
            1,
            filters,
        );

        truncated = result.truncated;

        const nodes: SimNode[] = result.nodes.map((n, i) => ({
            ...n,
            x: 0,
            y: 0,
            radius: n.type === 'verse' ? 8 : 10,
            index: i,
        }));

        // Mark the seed node larger
        const seedIdx = nodes.findIndex(n => n.id === `verse:${verseInput}`);
        if (seedIdx >= 0) {
            nodes[seedIdx].radius = 14;
        }

        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        const links: SimLink[] = result.edges
            .filter(e => nodeMap.has(e.source) && nodeMap.has(e.target))
            .map(e => ({
                source: nodeMap.get(e.source)!,
                target: nodeMap.get(e.target)!,
                data: e,
            }));

        simNodes = nodes;
        simLinks = links;
        nodeCount = nodes.length;
        edgeCount = links.length;
        startSimulation();
        loading = false;
    }

    // ── Simulation ────────────────────────────────────────
    function startSimulation() {
        if (simulation) simulation.stop();
        if (animFrameId) cancelAnimationFrame(animFrameId);

        // Reset transform
        transform = { x: width / 2, y: height / 2, k: 1 };

        simulation = forceSimulation<SimNode>(simNodes);

        if (viewMode === 'book') {
            // Book mode: 66 nodes, many heavy edges.
            // Use log-scaled link strength so mega-connections (Gen↔Matt) don't
            // collapse the graph. Higher repulsion + larger distance to spread out.
            simulation
                .force('link', forceLink<SimNode, SimLink>(simLinks)
                    .id(d => d.id)
                    .distance(150)
                    .strength(d => 0.03 + Math.log1p(d.data.weight || 1) * 0.01)
                )
                .force('charge', forceManyBody<SimNode>().strength(-500))
                .force('x', forceX<SimNode>(0).strength(0.04))
                .force('y', forceY<SimNode>(0).strength(0.04))
                .force('collide', forceCollide<SimNode>(d => d.radius + 6));
        } else {
            // Verse mode: smaller neighborhood, entity nodes are leaves.
            // Stronger links keep the graph compact; moderate repulsion prevents overlap.
            simulation
                .force('link', forceLink<SimNode, SimLink>(simLinks)
                    .id(d => d.id)
                    .distance(d => {
                        // Entity-mention edges shorter to keep entities near their verse
                        if (d.data.category === 'entity-mention') return 50;
                        return 80;
                    })
                    .strength(d => {
                        if (d.data.category === 'entity-mention') return 0.4;
                        return 0.1 + Math.log1p(d.data.weight || 1) * 0.05;
                    })
                )
                .force('charge', forceManyBody<SimNode>().strength(-80))
                .force('x', forceX<SimNode>(0).strength(0.05))
                .force('y', forceY<SimNode>(0).strength(0.05))
                .force('collide', forceCollide<SimNode>(d => d.radius + 4));
        }

        simulation
            .alphaDecay(0.02)
            .on('tick', () => {
                renderCanvas();
            });

        // Warm start
        for (let i = 0; i < 100; i++) simulation.tick();
        renderCanvas();
    }

    // ── Canvas rendering ──────────────────────────────────
    function renderCanvas() {
        if (!canvasEl) return;
        const ctx = canvasEl.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvasEl.width = width * dpr;
        canvasEl.height = height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        ctx.clearRect(0, 0, width, height);
        ctx.save();
        ctx.translate(transform.x, transform.y);
        ctx.scale(transform.k, transform.k);

        // Build set of edge IDs connected to hovered node (feature 2)
        const hoveredId = hoveredNode?.id ?? null;
        const connectedNodeIds = new Set<string>();
        const connectedEdgeSet = new Set<SimLink>();
        if (hoveredId) {
            for (const link of simLinks) {
                const src = (link.source as SimNode).id;
                const tgt = (link.target as SimNode).id;
                if (src === hoveredId || tgt === hoveredId) {
                    connectedEdgeSet.add(link);
                    connectedNodeIds.add(src);
                    connectedNodeIds.add(tgt);
                }
            }
        }
        const dimming = hoveredId !== null;

        // Draw edges
        for (const link of simLinks) {
            const src = link.source as SimNode;
            const tgt = link.target as SimNode;
            const isConnected = connectedEdgeSet.has(link);
            ctx.beginPath();
            ctx.moveTo(src.x, src.y);
            ctx.lineTo(tgt.x, tgt.y);
            const edgeColor = EDGE_TYPE_COLORS[link.data.type] ?? '#555';
            ctx.strokeStyle = edgeColor;

            let baseAlpha = viewMode === 'book'
                ? Math.min(0.6, 0.05 + Math.sqrt(link.data.weight || 1) * 0.02)
                : 0.3;
            // Dim non-connected edges when hovering
            if (dimming && !isConnected) baseAlpha *= 0.12;
            else if (dimming && isConnected) baseAlpha = Math.max(baseAlpha, 0.7);
            ctx.globalAlpha = baseAlpha;

            ctx.lineWidth = viewMode === 'book'
                ? Math.min(3, 0.5 + Math.sqrt(link.data.weight || 1) * 0.15)
                : 1;
            // Thicken connected edges on hover
            if (dimming && isConnected) ctx.lineWidth = Math.max(ctx.lineWidth, 2);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // Feature 6: Edge labels on connected edges when hovering a node
        if (dimming) {
            ctx.font = '8px Inter, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (const link of connectedEdgeSet) {
                const src = link.source as SimNode;
                const tgt = link.target as SimNode;
                const mx = (src.x + tgt.x) / 2;
                const my = (src.y + tgt.y) / 2;
                const w = link.data.weight ?? 1;
                const label = w > 1 ? `${link.data.type} (${w})` : link.data.type;

                // Background pill for readability
                const metrics = ctx.measureText(label);
                const pw = metrics.width + 6;
                const ph = 12;
                ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
                ctx.beginPath();
                ctx.roundRect(mx - pw / 2, my - ph / 2, pw, ph, 3);
                ctx.fill();

                ctx.fillStyle = EDGE_TYPE_COLORS[link.data.type] ?? '#cbd5e1';
                ctx.globalAlpha = 0.95;
                ctx.fillText(label, mx, my);
                ctx.globalAlpha = 1;
            }
        }

        // Draw nodes
        for (const node of simNodes) {
            const isHovered = hoveredNode?.id === node.id;
            const isSelected = selectedNode?.id === node.id;

            // Feature 5: testament colors for book nodes
            let color: string;
            const bookData = node.data as Record<string, unknown> | undefined;
            if (node.type === 'book' && bookData?.testament) {
                color = TESTAMENT_COLORS[bookData.testament as string] ?? NODE_COLORS.book;
            } else {
                color = NODE_COLORS[node.type] ?? '#888';
            }

            // Dim unrelated nodes when hovering (feature 2)
            let nodeAlpha = isHovered || isSelected ? 1 : 0.85;
            if (dimming && !isHovered && !connectedNodeIds.has(node.id)) nodeAlpha = 0.15;

            ctx.beginPath();
            ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.globalAlpha = nodeAlpha;
            ctx.fill();

            if (isHovered || isSelected) {
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.stroke();
            }

            // Feature 7: Enhanced seed node emphasis (verse mode)
            if (viewMode === 'verse' && node.id === `verse:${verseInput}`) {
                // Outer glow ring
                ctx.beginPath();
                ctx.arc(node.x, node.y, node.radius + 6, 0, Math.PI * 2);
                ctx.strokeStyle = NODE_COLORS.verse;
                ctx.lineWidth = 1;
                ctx.globalAlpha = 0.25;
                ctx.stroke();
                // Inner emphasis ring
                ctx.beginPath();
                ctx.arc(node.x, node.y, node.radius + 3, 0, Math.PI * 2);
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5;
                ctx.globalAlpha = 0.7;
                ctx.stroke();
            }

            // Labels — hide dimmed labels for clarity
            if (dimming && !isHovered && !connectedNodeIds.has(node.id)) continue;
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#e2e8f0';
            ctx.font = `${isHovered || isSelected ? '11px' : '9px'} Inter, system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(node.label, node.x, node.y + node.radius + 3);
        }

        ctx.restore();
    }

    // ── Mouse interaction ─────────────────────────────────
    function canvasCoords(e: MouseEvent): { cx: number; cy: number } {
        const rect = canvasEl.getBoundingClientRect();
        return { cx: e.clientX - rect.left, cy: e.clientY - rect.top };
    }

    function getNodeAt(cx: number, cy: number): SimNode | null {
        const gx = (cx - transform.x) / transform.k;
        const gy = (cy - transform.y) / transform.k;
        for (let i = simNodes.length - 1; i >= 0; i--) {
            const n = simNodes[i];
            const dx = gx - n.x;
            const dy = gy - n.y;
            if (dx * dx + dy * dy < (n.radius + 4) ** 2) return n;
        }
        return null;
    }

    // Threshold in CSS pixels — if mouse moves less than this from mousedown,
    // treat it as a click rather than a drag.
    const DRAG_THRESHOLD = 4;
    let isPanning = false;
    let panStart = { x: 0, y: 0 };
    let mouseDownPos = { x: 0, y: 0 };

    function handleMouseDown(e: MouseEvent) {
        const { cx, cy } = canvasCoords(e);
        mouseDownPos = { x: e.clientX, y: e.clientY };
        didDrag = false;

        const node = getNodeAt(cx, cy);
        if (node) {
            // Start node drag
            draggedNode = node;
            // Pin node so the simulation doesn't fight us
            node.fx = node.x;
            node.fy = node.y;
            // Reheat simulation so other nodes adjust
            simulation?.alphaTarget(0.3).restart();
            canvasEl.style.cursor = 'grabbing';
        } else {
            // Start canvas pan
            isPanning = true;
            panStart = { x: e.clientX - transform.x, y: e.clientY - transform.y };
            canvasEl.style.cursor = 'grabbing';
        }
    }

    function handleMouseMove(e: MouseEvent) {
        const { cx, cy } = canvasCoords(e);

        if (draggedNode) {
            // Move the pinned node to follow the mouse in graph-space
            const gx = (cx - transform.x) / transform.k;
            const gy = (cy - transform.y) / transform.k;
            draggedNode.fx = gx;
            draggedNode.fy = gy;

            const dx = e.clientX - mouseDownPos.x;
            const dy = e.clientY - mouseDownPos.y;
            if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
                didDrag = true;
            }
            return; // simulation tick handles rendering
        }

        if (isPanning) {
            transform = { ...transform, x: e.clientX - panStart.x, y: e.clientY - panStart.y };
            renderCanvas();
            return;
        }

        // Hover detection (no button held)
        mousePos = { x: cx, y: cy };
        const node = getNodeAt(cx, cy);
        if (node !== hoveredNode) {
            hoveredNode = node;
            canvasEl.style.cursor = node ? 'pointer' : 'grab';
            renderCanvas();
        }
    }

    function handleMouseUp(e: MouseEvent) {
        if (draggedNode) {
            // Release the node — unpin it so the simulation can settle
            draggedNode.fx = null;
            draggedNode.fy = null;
            simulation?.alphaTarget(0); // cool down

            // If this was a click (not a drag), trigger navigation
            if (!didDrag) {
                handleNodeClick(draggedNode);
            }

            draggedNode = null;
            didDrag = false;
        }

        if (isPanning) {
            isPanning = false;
        }

        const { cx, cy } = canvasCoords(e);
        const node = getNodeAt(cx, cy);
        canvasEl.style.cursor = node ? 'pointer' : 'grab';
    }

    function handleNodeClick(node: SimNode) {
        // Feature 4: select node to inspect — don't navigate immediately
        selectedNode = selectedNode?.id === node.id ? null : node;
        renderCanvas();
    }

    // Feature 4: detail panel actions
    function navigateToNode(node: SimNode) {
        if (node.type === 'verse') {
            const osisId = node.id.replace('verse:', '');
            verseInput = osisId;
            viewMode = 'verse';
            loadVerseGraph();
        } else if (node.type === 'book') {
            const bookId = node.id.replace('book:', '');
            goto(`/read?book=${bookId}&chapter=1`);
        }
    }

    function getNodeConnections(node: SimNode): { count: number; neighbors: SimNode[] } {
        const neighbors: SimNode[] = [];
        for (const link of simLinks) {
            const src = link.source as SimNode;
            const tgt = link.target as SimNode;
            if (src.id === node.id) neighbors.push(tgt);
            else if (tgt.id === node.id) neighbors.push(src);
        }
        return { count: neighbors.length, neighbors };
    }

    // Feature 3: fit all nodes into the viewport
    function fitToView() {
        if (simNodes.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of simNodes) {
            minX = Math.min(minX, n.x - n.radius);
            minY = Math.min(minY, n.y - n.radius);
            maxX = Math.max(maxX, n.x + n.radius);
            maxY = Math.max(maxY, n.y + n.radius);
        }

        const graphW = maxX - minX;
        const graphH = maxY - minY;
        if (graphW === 0 || graphH === 0) return;

        const padding = 40;
        const scaleX = (width - padding * 2) / graphW;
        const scaleY = (height - padding * 2) / graphH;
        const k = Math.min(scaleX, scaleY, 2); // clamp max zoom to 2x

        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        transform = {
            x: width / 2 - cx * k,
            y: height / 2 - cy * k,
            k,
        };
        renderCanvas();
    }

    function handleClick(e: MouseEvent) {
        // Node clicks are handled in handleMouseUp to distinguish click vs drag.
        // This only handles clicks on empty canvas (deselect).
        if (!didDrag && !draggedNode) {
            const { cx, cy } = canvasCoords(e);
            const node = getNodeAt(cx, cy);
            if (!node) {
                selectedNode = null;
                renderCanvas();
            }
        }
    }

    // Feature 9: Double-click to navigate directly
    function handleDblClick(e: MouseEvent) {
        const { cx, cy } = canvasCoords(e);
        const node = getNodeAt(cx, cy);
        if (node) {
            navigateToNode(node);
        }
    }

    function handleWheel(e: WheelEvent) {
        e.preventDefault();
        const { cx: mx, cy: my } = canvasCoords(e);

        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        const newK = Math.max(0.2, Math.min(5, transform.k * factor));

        // Zoom toward mouse position
        const newX = mx - (mx - transform.x) * (newK / transform.k);
        const newY = my - (my - transform.y) * (newK / transform.k);

        transform = { x: newX, y: newY, k: newK };
        renderCanvas();
    }

    // ── Feature 10: Keyboard shortcuts ──────────────────────
    const PAN_STEP = 40;
    const ZOOM_STEP = 1.15;

    function handleKeyDown(e: KeyboardEvent) {
        // Don't intercept when typing in an input
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                transform = { ...transform, x: transform.x + PAN_STEP };
                renderCanvas();
                break;
            case 'ArrowRight':
                e.preventDefault();
                transform = { ...transform, x: transform.x - PAN_STEP };
                renderCanvas();
                break;
            case 'ArrowUp':
                e.preventDefault();
                transform = { ...transform, y: transform.y + PAN_STEP };
                renderCanvas();
                break;
            case 'ArrowDown':
                e.preventDefault();
                transform = { ...transform, y: transform.y - PAN_STEP };
                renderCanvas();
                break;
            case '=':
            case '+': {
                e.preventDefault();
                const newK = Math.min(5, transform.k * ZOOM_STEP);
                // Zoom toward center of viewport
                const cx = width / 2;
                const cy = height / 2;
                transform = {
                    x: cx - (cx - transform.x) * (newK / transform.k),
                    y: cy - (cy - transform.y) * (newK / transform.k),
                    k: newK,
                };
                renderCanvas();
                break;
            }
            case '-': {
                e.preventDefault();
                const newK = Math.max(0.2, transform.k / ZOOM_STEP);
                const cx = width / 2;
                const cy = height / 2;
                transform = {
                    x: cx - (cx - transform.x) * (newK / transform.k),
                    y: cy - (cy - transform.y) * (newK / transform.k),
                    k: newK,
                };
                renderCanvas();
                break;
            }
            case 'Escape':
                selectedNode = null;
                hoveredNode = null;
                renderCanvas();
                break;
            case 'f':
            case 'F':
                e.preventDefault();
                fitToView();
                break;
        }
    }

    // ── Resize ────────────────────────────────────────────
    function handleResize() {
        const container = canvasEl?.parentElement;
        if (container) {
            width = container.clientWidth;
            height = container.clientHeight;
            transform = { x: width / 2, y: height / 2, k: transform.k };
            renderCanvas();
        }
    }

    // ── Lifecycle ─────────────────────────────────────────
    onMount(() => {
        handleResize();
        window.addEventListener('resize', handleResize);
        window.addEventListener('keydown', handleKeyDown);

        // Check URL params
        const params = new URL(window.location.href).searchParams;
        const v = params.get('verse');
        if (v) {
            verseInput = v;
            viewMode = 'verse';
            loadVerseGraph();
        } else {
            loadBookGraph();
        }

        return () => {
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('keydown', handleKeyDown);
            if (simulation) simulation.stop();
            if (animFrameId) cancelAnimationFrame(animFrameId);
        };
    });

    // ── Verse submit ──────────────────────────────────────
    function handleVerseSubmit(e: Event) {
        e.preventDefault();
        if (verseInput.trim()) {
            viewMode = 'verse';
            loadVerseGraph();
        }
    }

    function switchToBooks() {
        viewMode = 'book';
        selectedNode = null;
        hoveredNode = null;
        loadBookGraph();
    }
</script>

<svelte:head>
    <title>Scripture Graph — Codex Scriptura</title>
</svelte:head>

<div class="graph-page">
    <!-- Toolbar -->
    <div class="graph-toolbar">
        <div class="toolbar-left">
            <h1 class="graph-title">Scripture Graph</h1>
            <div class="mode-toggle">
                <button class="mode-btn" class:active={viewMode === 'book'} onclick={switchToBooks}>Books</button>
                <button class="mode-btn" class:active={viewMode === 'verse'} onclick={() => { viewMode = 'verse'; loadVerseGraph(); }}>Verse</button>
            </div>
        </div>

        {#if viewMode === 'verse'}
            <form class="verse-form" onsubmit={handleVerseSubmit}>
                <input
                    type="text"
                    class="verse-input"
                    placeholder="e.g. Gen.1.1, John.3.16"
                    bind:value={verseInput}
                />
                <button type="submit" class="verse-go">Go</button>
            </form>
        {/if}

        <div class="toolbar-right">
            <span class="graph-stats">
                {nodeCount} nodes · {edgeCount} edges
                {#if truncated}
                    <span class="truncated-badge">truncated</span>
                {/if}
            </span>
        </div>
    </div>

    <!-- Edge type filter (verse mode only) -->
    {#if viewMode === 'verse'}
        <div class="filter-bar">
            <span class="filter-label">Edge types</span>
            {#each EDGE_TYPES as t}
                <button
                    class="filter-chip"
                    class:active={activeEdgeTypes.has(t)}
                    style="--chip-color: {EDGE_TYPE_COLORS[t]}"
                    onclick={() => { toggleEdgeType(t); loadVerseGraph(); }}
                >{t}</button>
            {/each}
        </div>
    {/if}

    <!-- Canvas -->
    <div class="graph-canvas-wrap" id="graph-canvas-wrap">
        {#if loading}
            <div class="graph-loading">
                <div class="loading-spinner"></div>
                <p>Building graph…</p>
            </div>
        {/if}
        <canvas
            bind:this={canvasEl}
            style="width: {width}px; height: {height}px;"
            onmousemove={handleMouseMove}
            onclick={handleClick}
            ondblclick={handleDblClick}
            onmousedown={handleMouseDown}
            onmouseup={handleMouseUp}
            onmouseleave={(e) => handleMouseUp(e)}
            onwheel={handleWheel}
        ></canvas>

        <!-- Controls: fit-to-view + zoom indicator -->
        <div class="graph-controls">
            <span class="zoom-badge">{Math.round(transform.k * 100)}%</span>
            <button class="control-btn" onclick={fitToView} title="Fit to view (F)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" />
                </svg>
            </button>
        </div>

        <!-- Keyboard shortcuts hint (bottom-left) -->
        <div class="keyboard-hint">
            <kbd>Arrows</kbd> pan
            <kbd>+</kbd><kbd>-</kbd> zoom
            <kbd>F</kbd> fit
            <kbd>Esc</kbd> deselect
            <span class="hint-sep">|</span>
            Double-click to navigate
        </div>

        <!-- Feature 1: Tooltip follows mouse -->
        {#if hoveredNode && !draggedNode}
            {@const tipX = Math.min(mousePos.x + 14, width - 160)}
            {@const tipY = mousePos.y > height - 80 ? mousePos.y - 60 : mousePos.y + 14}
            <div class="graph-tooltip" style="left: {tipX}px; top: {tipY}px; pointer-events: none;">
                <span class="tooltip-type">{hoveredNode.type}{#if viewMode === 'book' && hoveredNode.data}
                    {' · '}{(hoveredNode.data as Record<string, unknown>).testament}
                {/if}</span>
                <span class="tooltip-label">{hoveredNode.label}</span>
                <span class="tooltip-hint">Click to inspect · dbl-click to go</span>
            </div>
        {/if}

        <!-- Feature 4: Selected node detail panel -->
        {#if selectedNode}
            {@const conn = getNodeConnections(selectedNode)}
            <div class="detail-panel">
                <div class="detail-header">
                    <span class="detail-type">{selectedNode.type}</span>
                    <button class="detail-close" onclick={() => { selectedNode = null; renderCanvas(); }}>✕</button>
                </div>
                <h3 class="detail-label">{selectedNode.label}</h3>
                <p class="detail-stat">{conn.count} connection{conn.count !== 1 ? 's' : ''}</p>

                {#if conn.neighbors.length > 0}
                    <div class="detail-neighbors">
                        {#each conn.neighbors.slice(0, 8) as nb}
                            <span class="neighbor-chip" style="--chip-bg: {NODE_COLORS[nb.type] ?? '#888'}">{nb.label}</span>
                        {/each}
                        {#if conn.neighbors.length > 8}
                            <span class="neighbor-more">+{conn.neighbors.length - 8} more</span>
                        {/if}
                    </div>
                {/if}

                <div class="detail-actions">
                    {#if selectedNode.type === 'verse'}
                        <button class="detail-action-btn primary" onclick={() => navigateToNode(selectedNode!)}>
                            Explore neighborhood
                        </button>
                        <button class="detail-action-btn" onclick={() => goto(`/read?verse=${selectedNode!.id.replace('verse:', '')}`)}>
                            Read in context
                        </button>
                    {:else if selectedNode.type === 'book'}
                        <button class="detail-action-btn primary" onclick={() => navigateToNode(selectedNode!)}>
                            Read book
                        </button>
                    {:else}
                        <button class="detail-action-btn" onclick={() => { selectedNode = null; renderCanvas(); }}>
                            Dismiss
                        </button>
                    {/if}
                </div>
            </div>
        {/if}
    </div>

    <!-- Legend -->
    <div class="graph-legend">
        {#if viewMode === 'book'}
            <span class="legend-item"><span class="legend-dot" style="background: {TESTAMENT_COLORS.OT}"></span> Old Testament</span>
            <span class="legend-item"><span class="legend-dot" style="background: {TESTAMENT_COLORS.NT}"></span> New Testament</span>
        {:else}
            <span class="legend-item"><span class="legend-dot" style="background: {NODE_COLORS.verse}"></span> Verse</span>
            <span class="legend-item"><span class="legend-dot" style="background: {NODE_COLORS.person}"></span> Person</span>
            <span class="legend-item"><span class="legend-dot" style="background: {NODE_COLORS.place}"></span> Place</span>
            <span class="legend-item"><span class="legend-dot" style="background: {NODE_COLORS.event}"></span> Event</span>
        {/if}
    </div>
</div>

<style>
    .graph-page {
        display: flex;
        flex-direction: column;
        height: 100vh;
        background: var(--color-bg-base);
    }

    /* ── Toolbar ── */
    .graph-toolbar {
        display: flex;
        align-items: center;
        gap: var(--space-4);
        padding: var(--space-3) var(--space-4);
        background: var(--color-bg-elevated);
        border-bottom: 1px solid var(--color-border);
        flex-wrap: wrap;
    }
    .toolbar-left {
        display: flex;
        align-items: center;
        gap: var(--space-3);
    }
    .toolbar-right {
        margin-left: auto;
    }
    .graph-title {
        font-size: var(--font-size-lg);
        font-weight: 700;
        color: var(--color-text-primary);
        margin: 0;
        white-space: nowrap;
    }

    .mode-toggle {
        display: inline-flex;
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: 3px;
        gap: 2px;
    }
    .mode-btn {
        padding: 5px var(--space-3);
        background: none;
        border: none;
        border-radius: calc(var(--radius-md) - 2px);
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 500;
        cursor: pointer;
        transition: all var(--transition-fast);
    }
    .mode-btn:hover { color: var(--color-text-primary); }
    .mode-btn.active {
        background: var(--color-accent);
        color: #fff;
        font-weight: 600;
    }

    .verse-form {
        display: flex;
        gap: var(--space-2);
    }
    .verse-input {
        padding: 5px var(--space-3);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
        width: 180px;
        outline: none;
    }
    .verse-input:focus {
        border-color: var(--color-accent);
        box-shadow: var(--shadow-glow);
    }
    .verse-go {
        padding: 5px var(--space-3);
        background: var(--color-accent);
        border: none;
        border-radius: var(--radius-sm);
        color: #fff;
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 600;
        cursor: pointer;
        transition: opacity var(--transition-fast);
    }
    .verse-go:hover { opacity: 0.85; }

    .graph-stats {
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }
    .truncated-badge {
        background: rgba(239, 68, 68, 0.15);
        color: #ef4444;
        font-size: 10px;
        font-weight: 600;
        padding: 1px 6px;
        border-radius: var(--radius-full);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    /* ── Filter bar ── */
    .filter-bar {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-4);
        background: var(--color-bg-elevated);
        border-bottom: 1px solid var(--color-border-subtle);
        flex-wrap: wrap;
    }
    .filter-label {
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-text-muted);
        white-space: nowrap;
    }
    .filter-chip {
        padding: 3px var(--space-2);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-full);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: all var(--transition-fast);
    }
    .filter-chip:hover {
        border-color: var(--chip-color, var(--color-border));
        color: var(--chip-color, var(--color-text-primary));
    }
    .filter-chip.active {
        background: var(--chip-color, var(--color-accent));
        border-color: var(--chip-color, var(--color-accent));
        color: #fff;
    }

    /* ── Canvas ── */
    .graph-canvas-wrap {
        flex: 1;
        position: relative;
        overflow: hidden;
    }
    .graph-canvas-wrap canvas {
        display: block;
    }

    .graph-loading {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--space-3);
        background: rgba(0, 0, 0, 0.4);
        z-index: 10;
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
    }
    .loading-spinner {
        width: 28px;
        height: 28px;
        border: 2px solid var(--color-border);
        border-top-color: var(--color-accent);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Graph controls (fit-to-view) ── */
    .graph-controls {
        position: absolute;
        bottom: var(--space-3);
        right: var(--space-3);
        display: flex;
        gap: var(--space-1);
        z-index: 5;
    }
    .control-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: all var(--transition-fast);
        box-shadow: var(--shadow-sm);
    }
    .control-btn:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
        border-color: var(--color-accent);
    }
    .zoom-badge {
        font-family: var(--font-mono, monospace);
        font-size: 10px;
        font-weight: 600;
        color: var(--color-text-muted);
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: 4px 8px;
        box-shadow: var(--shadow-sm);
        user-select: none;
    }

    /* ── Keyboard hints ── */
    .keyboard-hint {
        position: absolute;
        bottom: var(--space-3);
        left: var(--space-3);
        font-family: var(--font-ui);
        font-size: 10px;
        color: var(--color-text-muted);
        display: flex;
        align-items: center;
        gap: 4px;
        opacity: 0.6;
        user-select: none;
    }
    .keyboard-hint kbd {
        display: inline-block;
        padding: 1px 4px;
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: 3px;
        font-family: var(--font-mono, monospace);
        font-size: 9px;
        line-height: 1.4;
    }
    .hint-sep {
        color: var(--color-border);
        margin: 0 2px;
    }

    /* ── Tooltip (follows mouse) ── */
    .graph-tooltip {
        position: absolute;
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: var(--space-2) var(--space-3);
        display: flex;
        flex-direction: column;
        gap: 2px;
        box-shadow: var(--shadow-md);
        z-index: 6;
        max-width: 160px;
    }
    .tooltip-type {
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-text-muted);
    }
    .tooltip-label {
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: var(--color-text-primary);
    }
    .tooltip-hint {
        font-size: var(--font-size-xs);
        color: var(--color-accent);
    }

    /* ── Detail panel ── */
    .detail-panel {
        position: absolute;
        top: var(--space-3);
        right: var(--space-3);
        width: 240px;
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-3);
        box-shadow: var(--shadow-md);
        z-index: 5;
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }
    .detail-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }
    .detail-type {
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-text-muted);
    }
    .detail-close {
        background: none;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        font-size: 14px;
        padding: 0 2px;
        line-height: 1;
    }
    .detail-close:hover { color: var(--color-text-primary); }
    .detail-label {
        font-family: var(--font-ui);
        font-size: var(--font-size-base);
        font-weight: 700;
        color: var(--color-text-primary);
        margin: 0;
    }
    .detail-stat {
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        margin: 0;
    }
    .detail-neighbors {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }
    .neighbor-chip {
        display: inline-block;
        padding: 2px 6px;
        border-radius: var(--radius-full);
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: 500;
        color: #fff;
        background: var(--chip-bg);
        opacity: 0.85;
    }
    .neighbor-more {
        font-family: var(--font-ui);
        font-size: 10px;
        color: var(--color-text-muted);
        padding: 2px 4px;
    }
    .detail-actions {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        margin-top: var(--space-1);
    }
    .detail-action-btn {
        padding: 6px var(--space-3);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        background: var(--color-bg-surface);
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 600;
        cursor: pointer;
        text-align: center;
        transition: all var(--transition-fast);
    }
    .detail-action-btn:hover {
        border-color: var(--color-accent);
        color: var(--color-text-primary);
    }
    .detail-action-btn.primary {
        background: var(--color-accent);
        border-color: var(--color-accent);
        color: #fff;
    }
    .detail-action-btn.primary:hover {
        opacity: 0.9;
    }

    /* ── Legend ── */
    .graph-legend {
        display: flex;
        align-items: center;
        gap: var(--space-4);
        padding: var(--space-2) var(--space-4);
        background: var(--color-bg-elevated);
        border-top: 1px solid var(--color-border-subtle);
    }
    .legend-item {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
    }
    .legend-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
    }
</style>
