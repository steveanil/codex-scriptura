<script lang="ts">
    import { onMount } from 'svelte';
    import { goto, replaceState } from '$app/navigation';
    import { page } from '$app/state';
    import { findBook, parseReference, parseOsisId } from '@codex-scriptura/core';
    import { readerHref } from '$lib/utils/readerHref';
    import { getBookCrossReferenceMatrix } from '$lib/engines/graph';
    import NeighborhoodGraph from '$lib/components/NeighborhoodGraph.svelte';
    import InlineError from '$lib/components/ui/InlineError.svelte';
    import EmptyState from '$lib/components/ui/EmptyState.svelte';
    import DatasetGate from '$lib/components/DatasetGate.svelte';
    import { datasetStatus } from '$lib/stores/datasetStatus.svelte';
    import { retryDataset } from '$lib/seed';
    import {
        RING_VIEW,
        OT_NODE_COLOR,
        NT_NODE_COLOR,
        EDGE_SAME_TESTAMENT,
        EDGE_CROSS_TESTAMENT,
        layoutRing,
        buildEdges,
        adjacencyFromMatrix,
        seededAdjacency,
        degrees,
        type Adjacency,
        type RingEdge,
    } from '$lib/engines/canonRing';
    import { RING_VIEW_COMPACT, RING_CENTER, RING_R, RING_HIT_BAND, LABEL_FONT, SECTION_FONT, SECTION_FONT_COMPACT, nodeAt } from '$lib/engines/canonRing';

    // ─── State ────────────────────────────────────────────
    // Neighborhood focus (issue #21): a namespaced node ID puts the page in
    // verse/entity neighborhood mode instead of the book ring overview.
    let focusSeed = $state<string | null>(null);
    let selectedBook = $state<string | null>(null);
    let showAllLinks = $state(false);
    let searchInput = $state('');
    let adjacency = $state<Adjacency>(new Map());
    let edges = $state<RingEdge[]>([]);
    let edgesLoading = $state(true);

    const layout = layoutRing();
    const degreeById = $derived(degrees(adjacency));

    // "Show all" draws only the strongest links - the full edge set is ~1,800
    // paths (near-complete graph at book level), which stalls paint and reads
    // as a smear. Same cap principle as the verse-level graph.
    const SHOW_ALL_EDGE_CAP = 300;

    const strongestEdges = $derived(
        [...edges].sort((a, b) => b.weight - a.weight).slice(0, SHOW_ALL_EDGE_CAP),
    );

    // Only edges that are actually visible get mounted - hidden edges used to
    // sit in the DOM at opacity 0 and re-transition en masse on every toggle.
    type DrawnEdge = { edge: RingEdge; opacity: number; active: boolean };
    const drawnEdges = $derived.by((): DrawnEdge[] => {
        if (selectedBook !== null) {
            const sel = selectedBook;
            return edges
                .filter((e) => e.a === sel || e.b === sel)
                .map((edge) => ({ edge, opacity: 0.6, active: true }));
        }
        if (showAllLinks) {
            const max = strongestEdges[0]?.weight ?? 1;
            return strongestEdges.map((edge) => ({
                edge,
                opacity: 0.05 + 0.13 * Math.sqrt(edge.weight / max),
                active: false,
            }));
        }
        return [];
    });

    // ─── Data ─────────────────────────────────────────────
    // The book matrix is a shipped aggregate (issue #38) that may still be
    // streaming in behind a live app (issue #244): the load re-runs when
    // the dataset lands, so the ring fills in without a reload.
    const xrefState = $derived(datasetStatus.state('book-matrix'));
    let retryingXrefs = $state(false);
    $effect(() => {
        if (xrefState === 'absent') {
            // The deploy carries no cross-references: the ring shows the canon only, and nothing is still coming
            adjacency = seededAdjacency();
            edges = buildEdges(layout, adjacency);
            edgesLoading = false;
            return;
        }
        if (xrefState !== 'installed') return;
        let active = true;
        getBookCrossReferenceMatrix().then((matrix) => {
            if (!active) return;
            let adj = adjacencyFromMatrix(matrix);
            if (adj.size === 0) adj = seededAdjacency();
            adjacency = adj;
            edges = buildEdges(layout, adj);
            edgesLoading = false;
        });
        return () => { active = false; };
    });
    async function retryXrefs() {
        retryingXrefs = true;
        try { await retryDataset('book-matrix'); } finally { retryingXrefs = false; }
    }

    function resolveBookId(raw: string): string | null {
        const parsed = parseReference(raw);
        const meta = parsed ? findBook(parsed.book) : findBook(raw.split('.')[0]);
        return meta && layout.nodeById.has(meta.osisId) ? meta.osisId : null;
    }

    // The URL carries the selection (?book=Gen for the ring; ?verse=Gen.1.1
    // or ?person=/?place=/?event= for a neighborhood focus) - follow it on
    // deep links and when nav re-visits /graph.
    // Only page.url may be a dependency here: reading selectedBook would
    // re-fire this on every click with a not-yet-updated URL and clobber it.
    let appliedUrlParam: string | null | undefined;
    $effect(() => {
        const params = page.url.searchParams;
        const entityParam = (['person', 'place', 'event'] as const).find((k) => params.get(k));
        const raw = entityParam
            ? `${entityParam}:${params.get(entityParam)}`
            : (params.get('verse') ?? params.get('book'));
        if (raw === appliedUrlParam) return;
        appliedUrlParam = raw;

        if (raw && entityParam) {
            focusSeed = raw;
        } else if (raw && raw.split('.').length === 3) {
            // A full verse reference opens its neighborhood; partial ones
            // (and plain book names) keep the ring behavior.
            focusSeed = `verse:${raw}`;
        } else {
            focusSeed = null;
            selectedBook = raw ? resolveBookId(raw) : null;
        }
    });

    function syncUrl() {
        const url = new URL(window.location.href);
        for (const key of ['verse', 'person', 'place', 'event']) url.searchParams.delete(key);
        if (selectedBook) url.searchParams.set('book', selectedBook);
        else url.searchParams.delete('book');
        replaceState(url, {});
    }

    // ─── Neighborhood mode (issue #21) ────────────────────
    /**
     * Focus a node's neighborhood. State is set directly (same pattern as
     * selectBook) - replaceState performs shallow routing, so the URL
     * effect cannot be relied on to re-fire; appliedUrlParam is kept in
     * step so a later effect run doesn't clobber the selection.
     */
    function focusNode(nodeId: string) {
        const sep = nodeId.indexOf(':');
        const type = nodeId.slice(0, sep);
        const id = nodeId.slice(sep + 1);
        focusSeed = nodeId;
        appliedUrlParam = type === 'verse' ? id : nodeId;
        const url = new URL(window.location.href);
        for (const key of ['book', 'verse', 'person', 'place', 'event']) url.searchParams.delete(key);
        url.searchParams.set(type, id);
        replaceState(url, {});
    }

    /** Leave focus mode; a verse seed drops back to its book on the ring. */
    function exitFocus() {
        const seedBook = focusSeed?.startsWith('verse:')
            ? (findBook(focusSeed.slice('verse:'.length).split('.')[0])?.osisId ?? null)
            : null;
        focusSeed = null;
        selectedBook = seedBook && layout.nodeById.has(seedBook) ? seedBook : null;
        appliedUrlParam = selectedBook;
        syncUrl();
    }

    function openVerseInReader(osisId: string) {
        const ref = parseOsisId(osisId);
        if (ref) goto(readerHref(ref.book, ref.chapter, ref.verse));
    }

    // ─── Selection ────────────────────────────────────────
    function selectBook(id: string) {
        selectedBook = selectedBook === id ? null : id;
        syncUrl();
    }

    function clearSelection() {
        if (selectedBook !== null) {
            selectedBook = null;
            syncUrl();
        }
    }

    function handleSearch(e: Event) {
        e.preventDefault();
        const raw = searchInput.trim();
        if (!raw) return;
        const parsed = parseReference(raw);
        // A full verse reference ("John 3:16") opens its neighborhood;
        // a book or chapter reference focuses the ring.
        if (parsed?.verse) {
            searchInput = '';
            focusNode(`verse:${parsed.book}.${parsed.chapter}.${parsed.verse}`);
            return;
        }
        const meta = parsed ? findBook(parsed.book) : findBook(raw);
        if (meta && layout.nodeById.has(meta.osisId)) {
            selectedBook = meta.osisId;
            searchInput = '';
            syncUrl();
        }
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') clearSelection();
    }

    // ─── Ring sizing ──────────────────────────────────────
    // Book labels are drawn only when they would render at 8px or more. Below
    // that (phones) the ring crops to nodes and section labels, the selected
    // book is named in the middle, and a tap anywhere in the ring band picks
    // the nearest book, since most nodes are smaller than a fingertip there.
    let canvasW = $state(0);
    let canvasH = $state(0);
    const compact = $derived(
        canvasW > 0 && LABEL_FONT * Math.min(canvasW / RING_VIEW.w, canvasH / RING_VIEW.h) < 8,
    );
    const view = $derived(compact ? RING_VIEW_COMPACT : RING_VIEW);
    const sectionFont = $derived(compact ? SECTION_FONT_COMPACT : SECTION_FONT);
    const ringBand = (() => {
        const { x, y } = RING_CENTER;
        const circle = (r: number) => `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
        return circle(RING_R + RING_HIT_BAND) + ' ' + circle(RING_R - RING_HIT_BAND);
    })();

    function pickFromBand(e: MouseEvent) {
        const svg = (e.currentTarget as SVGElement).ownerSVGElement;
        const ctm = svg?.getScreenCTM();
        if (!ctm) return;
        const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
        const hit = nodeAt(layout, p.x, p.y);
        if (hit) selectBook(hit.id);
    }

    // ─── Presentation ─────────────────────────────────────
    const isConnected = (id: string) =>
        selectedBook !== null && (id === selectedBook || (adjacency.get(selectedBook)?.has(id) ?? false));

    type PanelBook = {
        name: string;
        section: string;
        testament: string;
        color: string;
        chapters: number;
        degree: number;
        links: { id: string; name: string; weight: number; fill: string }[];
    };

    const panelBook = $derived.by((): PanelBook | null => {
        if (!selectedBook) return null;
        const node = layout.nodeById.get(selectedBook);
        if (!node) return null;
        const links = [...(adjacency.get(selectedBook) ?? new Map<string, number>())]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 7)
            .map(([id, weight]) => {
                const n = layout.nodeById.get(id);
                return { id, name: n?.name ?? id, weight, fill: n?.fill ?? OT_NODE_COLOR };
            });
        return {
            name: node.name,
            section: node.section,
            testament: node.testament === 'OT' ? 'Old Testament' : 'New Testament',
            color: node.fill,
            chapters: node.chapters,
            degree: degreeById.get(selectedBook) ?? 0,
            links,
        };
    });

    const topHubs = $derived(
        [...layout.nodes]
            .sort((a, b) => (degreeById.get(b.id) ?? 0) - (degreeById.get(a.id) ?? 0))
            .slice(0, 6)
            .map((n) => ({ id: n.id, name: n.name, degree: degreeById.get(n.id) ?? 0, fill: n.fill })),
    );
</script>

<svelte:head>
    <title>Scripture Graph - Codex Scriptura</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<div class="graph-page">
    {#if focusSeed}
    <DatasetGate datasets={['cross-references', 'persons', 'places', 'events']} label="cross-references and the people, places and events" skeleton="card">
        <NeighborhoodGraph
            seed={focusSeed}
            onRecenter={focusNode}
            onOpenVerse={openVerseInReader}
            onBack={exitFocus}
        />
    </DatasetGate>
    {:else}
    <div class="graph-main">
        <!-- Toolbar -->
        <div class="toolbar">
            <h1 class="title">Scripture Graph</h1>
            <button class="links-toggle" onclick={() => (showAllLinks = !showAllLinks)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <circle cx="4" cy="20" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="20" cy="4" r="2" />
                    <path d="M5.5 18.5l5-5" /><path d="M13.5 10.5l5-5" />
                </svg>
                {showAllLinks ? 'Hide all links' : 'Show all links'}
            </button>
            <form class="search-wrap" onsubmit={handleSearch}>
                <div class="search-field">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                    </svg>
                    <input type="text" placeholder="Jump to a book or reference…" bind:value={searchInput} aria-label="Jump to a book or reference" />
                </div>
            </form>
            <span class="count">
                66 books ·
                {#if xrefState === 'loading'}
                    loading book connections…
                {:else if xrefState === 'failed'}
                    book connections unavailable
                {:else if xrefState === 'absent'}
                    book connections not included
                {:else if edgesLoading}
                    … loading
                {:else if showAllLinks && !selectedBook && edges.length > SHOW_ALL_EDGE_CAP}
                    strongest {SHOW_ALL_EDGE_CAP} of {edges.length} links
                {:else}
                    {edges.length} links
                {/if}
            </span>
        </div>

        {#if xrefState === 'failed'}
            <div class="graph-error">
                <InlineError message="The book connection matrix could not be loaded, so the ring has no links." detail={datasetStatus.failed['book-matrix']} onRetry={retryXrefs} retrying={retryingXrefs} />
            </div>
        {:else if xrefState === 'absent'}
            <div class="graph-error">
                <EmptyState message="This library does not include the book connection matrix, so the ring shows the canon without links." />
            </div>
        {/if}

        <!-- Ring canvas -->
        <div class="canvas-wrap">
            <div class="ring-box" bind:clientWidth={canvasW} bind:clientHeight={canvasH}>
            <svg viewBox="{view.x} {view.y} {view.w} {view.h}" preserveAspectRatio="xMidYMid meet">
                <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="transparent" onclick={clearSelection} role="presentation" />

                <!-- section guide arcs + labels, tangent to the ring and turned to stay upright -->
                {#each layout.sections as sec (sec.name)}
                    {@const sx = compact ? sec.clx : sec.lx}
                    {@const sy = compact ? sec.cly : sec.ly}
                    <path d={sec.d} fill="none" stroke={sec.color} stroke-width="2" opacity="0.28" stroke-linecap="round" />
                    <text
                        class="section-label"
                        x={sx}
                        y={sy}
                        dy="0.35em"
                        font-size={sectionFont}
                        text-anchor="middle"
                        transform="rotate({sec.rotate} {sx} {sy})"
                        fill={sec.color}
                    >{sec.name}</text>
                {/each}

                {#if compact}
                    <path class="ring-band" d={ringBand} fill="transparent" fill-rule="evenodd" onclick={pickFromBand} role="presentation" />
                {/if}

                <!-- edges (none by default; strongest faint on "show all"; strong when touching the selection) -->
                {#each drawnEdges as { edge, opacity, active } (edge.a + '|' + edge.b)}
                    <path
                        class="edge"
                        d={edge.d}
                        fill="none"
                        stroke={edge.crossTestament ? EDGE_CROSS_TESTAMENT : EDGE_SAME_TESTAMENT}
                        stroke-width={active ? 1.7 : 0.7}
                        {opacity}
                    />
                {/each}

                <!-- book nodes + labels -->
                {#each layout.nodes as n (n.id)}
                    {@const connected = isConnected(n.id)}
                    {@const dim = selectedBook !== null && !connected}
                    <circle
                        class="node"
                        cx={n.x}
                        cy={n.y}
                        r={n.r}
                        fill={n.fill}
                        opacity={dim ? 0.14 : 1}
                        stroke={n.id === selectedBook ? 'var(--color-text-primary)' : connected && selectedBook ? 'color-mix(in srgb, var(--color-text-primary) 55%, transparent)' : 'transparent'}
                        stroke-width={n.id === selectedBook ? 3 : connected && selectedBook ? 1.5 : 0}
                        role="button"
                        tabindex="0"
                        aria-label="Focus {n.name}"
                        onclick={() => selectBook(n.id)}
                        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectBook(n.id); } }}
                    />
                    {#if !compact}
                        <text
                            class="node-label"
                            class:focused={n.id === selectedBook}
                            x={n.lx}
                            y={n.ly}
                            dy="0.35em"
                            font-size={LABEL_FONT}
                            text-anchor={n.anchor}
                            transform="rotate({n.rotate} {n.lx} {n.ly})"
                            opacity={dim ? 0.12 : selectedBook ? (connected ? 1 : 0.12) : 0.82}
                        >{n.label}</text>
                    {/if}
                {/each}

                {#if compact && selectedBook}
                    <text class="ring-caption" x={RING_CENTER.x} y={RING_CENTER.y} dy="0.35em" font-size="34" text-anchor="middle">
                        {layout.nodeById.get(selectedBook)?.name}
                    </text>
                {/if}
            </svg>
            </div>

            <!-- Legend -->
            <div class="legend">
                <span class="legend-item"><span class="dot" style="background:{OT_NODE_COLOR}"></span>Old Testament</span>
                <span class="legend-item"><span class="dot" style="background:{NT_NODE_COLOR}"></span>New Testament</span>
                <span class="legend-note">· node size = chapters</span>
            </div>
        </div>
    </div>

    <!-- Right panel -->
    <aside class="side-panel">
        {#if panelBook}
            <div class="book-head">
                <span class="book-dot" style="background:{panelBook.color}"></span>
                <span class="book-name">{panelBook.name}</span>
            </div>
            <div class="book-sub">{panelBook.section} · {panelBook.testament}</div>
            <div class="stat-row">
                <div class="stat-card">
                    <div class="stat-num">{panelBook.degree}</div>
                    <div class="stat-label">connected books</div>
                </div>
                <div class="stat-card">
                    <div class="stat-num">{panelBook.chapters}</div>
                    <div class="stat-label">chapters</div>
                </div>
            </div>
            <div class="kicker">Strongest links</div>
            <div class="row-list">
                {#each panelBook.links as link (link.id)}
                    <button class="link-row" onclick={() => selectBook(link.id)}>
                        <span class="row-dot small" style="background:{link.fill}"></span>
                        <span class="row-name">{link.name}</span>
                        <span class="row-refs">{link.weight} refs</span>
                    </button>
                {/each}
            </div>
            <button class="back-btn" onclick={clearSelection}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />
                </svg>
                Back to all books
            </button>
        {:else}
            <div class="kicker">Focus a book</div>
            <p class="hint-text">
                Click any book on the ring to reveal only its cross-references - everything else fades back.
                Click empty space to reset.
            </p>
            <div class="kicker">Most connected</div>
            <div class="row-list">
                {#each topHubs as hub (hub.id)}
                    <button class="link-row hub" onclick={() => selectBook(hub.id)}>
                        <span class="row-dot" style="background:{hub.fill}"></span>
                        <span class="row-name strong">{hub.name}</span>
                        <span class="row-links">{hub.degree} links</span>
                    </button>
                {/each}
            </div>
        {/if}
    </aside>
    {/if}
</div>

<style>
    .graph-page {
        display: flex;
        height: 100vh;
        background: var(--color-bg);
    }

    .graph-main {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
    }

    /* ── Toolbar ── */
    .toolbar {
        height: 56px;
        flex: none;
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 0 20px;
        border-bottom: 1px solid var(--color-border-subtle);
    }
    .title {
        font-size: var(--font-size-lg);
        font-weight: 600;
        letter-spacing: -0.01em;
        color: var(--color-text-primary);
        margin: 0;
        white-space: nowrap;
    }
    .links-toggle {
        height: 32px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 12px;
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-sm);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 500;
        color: var(--color-text-secondary);
        cursor: pointer;
        white-space: nowrap;
        transition: background var(--transition-fast), color var(--transition-fast);
    }
    .links-toggle:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }
    /* The form takes the free space and the field fills it up to a comfortable
       width, so it can shrink but never spill over its neighbours. */
    .search-wrap {
        flex: 1;
        display: flex;
        justify-content: center;
        min-width: 0;
    }
    .search-field {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 34px;
        padding: 0 14px;
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border-subtle);
        border-radius: var(--radius-md);
        flex: 1;
        min-width: 0;
        max-width: 360px;
        color: var(--color-text-muted);
    }
    .search-field svg {
        flex: none;
    }
    .search-field:focus-within {
        box-shadow: var(--focus-ring);
    }
    .search-field input {
        background: none;
        border: none;
        outline: none;
        box-shadow: none;
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        width: 100%;
    }
    .search-field input::placeholder {
        color: var(--color-text-muted);
    }
    .count {
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        font-weight: 500;
        color: var(--color-text-muted);
        white-space: nowrap;
    }

    /* ── Canvas ── */
    .canvas-wrap {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }
    .ring-box {
        flex: 1;
        min-height: 0;
        position: relative;
    }
    /* Absolute so the measured box, not the SVG's intrinsic size, decides the scale */
    .canvas-wrap svg {
        position: absolute;
        inset: 0;
        display: block;
        width: 100%;
        height: 100%;
    }
    .node {
        cursor: pointer;
        transition: opacity 0.18s ease;
        outline: none;
    }
    /* SVG ignores the global box-shadow focus ring, so draw it as a stroke */
    .node:focus-visible {
        stroke: var(--color-accent);
        stroke-width: 3px;
        opacity: 1;
    }
    .ring-band {
        cursor: pointer;
    }
    .ring-caption {
        font-family: var(--font-ui);
        font-weight: 600;
        fill: var(--color-text-primary);
        stroke: var(--color-bg);
        stroke-width: 6px;
        stroke-linejoin: round;
        paint-order: stroke;
        pointer-events: none;
    }
    .edge {
        transition: opacity 0.18s ease;
        pointer-events: none;
    }
    /* Label font sizes come from the layout constants as attributes (user
       units), because the ring geometry reserves room for exactly that size. */
    .node-label {
        font-family: var(--font-ui);
        font-weight: 500;
        fill: var(--color-text-secondary);
        pointer-events: none;
        transition: opacity 0.18s ease;
    }
    .node-label.focused {
        font-weight: 700;
    }
    .section-label {
        font-family: var(--font-mono);
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        opacity: 0.85;
        pointer-events: none;
    }

    /* ── Legend ── */
    .legend {
        flex: none;
        display: flex;
        flex-wrap: wrap;
        gap: 6px 18px;
        align-items: center;
        padding: 6px 20px 14px;
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
    }
    .legend-item {
        display: flex;
        align-items: center;
        gap: 7px;
    }
    .legend .dot {
        width: 11px;
        height: 11px;
        border-radius: 50%;
    }
    .legend-note {
        color: var(--color-text-muted);
    }

    /* ── Right panel ── */
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
    .kicker {
        font-family: var(--font-mono);
        font-size: var(--font-size-2xs);
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--color-text-muted);
        margin-bottom: 12px;
    }
    .hint-text {
        margin: 0 0 22px;
        font-size: var(--font-size-sm);
        line-height: 1.6;
        color: var(--color-text-secondary);
    }
    .row-list {
        display: flex;
        flex-direction: column;
        gap: 7px;
    }
    .row-list:has(.hub) {
        gap: 8px;
    }
    .link-row {
        display: flex;
        align-items: center;
        gap: 11px;
        min-height: var(--row-h-lg);
        padding: 0 13px;
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border-subtle);
        border-radius: var(--radius-md);
        cursor: pointer;
        text-align: left;
        font-family: var(--font-ui);
        transition: background var(--transition-fast);
    }
    .link-row:hover {
        background: var(--color-bg-hover);
    }
    .row-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex: none;
    }
    .row-dot.small {
        width: 9px;
        height: 9px;
    }
    .row-name {
        font-size: var(--font-size-sm);
        font-weight: 500;
        color: var(--color-text-primary);
    }
    .row-name.strong {
        font-weight: 600;
    }
    .row-links {
        margin-left: auto;
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        font-weight: 500;
        color: var(--color-accent-hover);
    }
    .row-refs {
        margin-left: auto;
        font-family: var(--font-mono);
        font-size: var(--font-size-2xs);
        font-weight: 500;
        color: var(--color-text-muted);
    }

    /* selected-book header */
    .book-head {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 6px;
    }
    .book-dot {
        width: 13px;
        height: 13px;
        border-radius: 50%;
        flex: none;
    }
    .book-name {
        font-size: var(--font-size-display);
        font-weight: 600;
        letter-spacing: -0.02em;
        color: var(--color-text-primary);
    }
    .book-sub {
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        font-weight: 500;
        line-height: 1.4;
        color: var(--color-accent-hover);
        margin-bottom: 20px;
    }
    .stat-row {
        display: flex;
        gap: 10px;
        margin-bottom: 22px;
    }
    .stat-card {
        flex: 1;
        padding: 12px 14px;
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border-subtle);
        border-radius: var(--radius-md);
    }
    .stat-num {
        font-family: var(--font-mono);
        font-size: var(--font-size-2xl);
        font-weight: 500;
        line-height: 1;
        color: var(--color-text-primary);
    }
    .stat-label {
        font-size: var(--font-size-2xs);
        color: var(--color-text-muted);
        margin-top: 5px;
    }
    .back-btn {
        margin-top: auto;
        height: 38px;
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-md);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 500;
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: background var(--transition-fast), color var(--transition-fast);
    }
    .back-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }
    .graph-error { padding: 0 var(--space-4) var(--space-3); }

    /* Phone widths: the 320px side panel would leave the ring a sliver,
       so stack it under the canvas instead (bottom nav takes 56px).
       Kept last so it overrides the base rules above at equal specificity. */
    @media (max-width: 768px) {
        .graph-page {
            flex-direction: column;
            height: calc(100dvh - var(--mobile-nav-height));
        }
        .side-panel {
            width: 100%;
            max-height: 42%;
            border-left: none;
            border-top: 1px solid var(--color-border-subtle);
        }
        .search-field {
            max-width: none;
        }
        .count {
            display: none;
        }
        .toolbar {
            gap: 10px;
            padding: 0 12px;
        }
        /* The bottom tab bar already names the page */
        .title {
            display: none;
        }
        .legend {
            padding: 4px 12px 10px;
        }
    }
    /* Tablets have the width for the fully labelled ring; give it the height too */
    @media (min-width: 600px) and (max-width: 768px) {
        .side-panel {
            max-height: 30%;
        }
    }
</style>
