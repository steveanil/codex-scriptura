<script lang="ts">
    import { onMount } from 'svelte';
    import { replaceState } from '$app/navigation';
    import { page } from '$app/state';
    import { findBook, parseReference } from '@codex-scriptura/core';
    import { getBookCrossReferenceMatrix } from '$lib/engines/graph';
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

    // ─── State ────────────────────────────────────────────
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
    onMount(async () => {
        const matrix = await getBookCrossReferenceMatrix();
        let adj = adjacencyFromMatrix(matrix);
        if (adj.size === 0) adj = seededAdjacency();
        adjacency = adj;
        edges = buildEdges(layout, adj);
        edgesLoading = false;
    });

    function resolveBookId(raw: string): string | null {
        const parsed = parseReference(raw);
        const meta = parsed ? findBook(parsed.book) : findBook(raw.split('.')[0]);
        return meta && layout.nodeById.has(meta.osisId) ? meta.osisId : null;
    }

    // The URL carries the selection (?book=Gen, or ?verse=Gen.1.1 from the
    // reader) - follow it on deep links and when nav re-visits /graph.
    // Only page.url may be a dependency here: reading selectedBook would
    // re-fire this on every click with a not-yet-updated URL and clobber it.
    let appliedUrlParam: string | null | undefined;
    $effect(() => {
        const raw = page.url.searchParams.get('book') ?? page.url.searchParams.get('verse');
        if (raw === appliedUrlParam) return;
        appliedUrlParam = raw;
        selectedBook = raw ? resolveBookId(raw) : null;
    });

    function syncUrl() {
        const url = new URL(window.location.href);
        url.searchParams.delete('verse');
        if (selectedBook) url.searchParams.set('book', selectedBook);
        else url.searchParams.delete('book');
        replaceState(url, {});
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
                {#if edgesLoading}
                    … loading
                {:else if showAllLinks && !selectedBook && edges.length > SHOW_ALL_EDGE_CAP}
                    strongest {SHOW_ALL_EDGE_CAP} of {edges.length} links
                {:else}
                    {edges.length} links
                {/if}
            </span>
        </div>

        <!-- Ring canvas -->
        <div class="canvas-wrap">
            <svg viewBox="0 0 {RING_VIEW.w} {RING_VIEW.h}" preserveAspectRatio="xMidYMid meet">
                <rect x="0" y="0" width={RING_VIEW.w} height={RING_VIEW.h} fill="transparent" onclick={clearSelection} role="presentation" />

                <!-- section guide arcs + labels -->
                {#each layout.sections as sec (sec.name)}
                    <path d={sec.d} fill="none" stroke={sec.color} stroke-width="2" opacity="0.28" stroke-linecap="round" />
                    <text class="section-label" x={sec.lx} y={sec.ly} text-anchor={sec.anchor} fill={sec.color}>{sec.name}</text>
                {/each}

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
                        stroke={n.id === selectedBook ? '#ffffff' : connected && selectedBook ? 'rgba(255,255,255,.55)' : 'transparent'}
                        stroke-width={n.id === selectedBook ? 3 : connected && selectedBook ? 1.5 : 0}
                        role="button"
                        tabindex="0"
                        aria-label="Focus {n.name}"
                        onclick={() => selectBook(n.id)}
                        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectBook(n.id); } }}
                    />
                    <text
                        class="node-label"
                        class:focused={n.id === selectedBook}
                        x={n.lx}
                        y={n.ly}
                        text-anchor={n.anchor}
                        opacity={dim ? 0.12 : selectedBook ? (connected ? 1 : 0.12) : 0.82}
                    >{n.label}</text>
                {/each}
            </svg>

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
</div>

<style>
    .graph-page {
        display: flex;
        height: 100vh;
        background: var(--color-bg);
    }

    /* Phone widths: the 320px side panel would leave the ring a sliver,
       so stack it under the canvas instead (bottom nav takes 56px). */
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
            min-width: 0;
            flex: 1;
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
        font-size: 17px;
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
    .links-toggle:hover {
        background: rgba(255, 255, 255, 0.08);
        color: var(--color-text-primary);
    }
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
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 9px;
        min-width: 300px;
        color: var(--color-text-muted);
    }
    .search-field:focus-within {
        border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
    }
    .search-field input {
        background: none;
        border: none;
        outline: none;
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: 13px;
        width: 100%;
    }
    .search-field input::placeholder {
        color: var(--color-text-muted);
    }
    .count {
        font-family: var(--font-mono);
        font-size: 12px;
        font-weight: 500;
        color: var(--color-text-faint);
        white-space: nowrap;
    }

    /* ── Canvas ── */
    .canvas-wrap {
        flex: 1;
        min-height: 0;
        position: relative;
    }
    .canvas-wrap svg {
        display: block;
        width: 100%;
        height: 100%;
    }
    .node {
        cursor: pointer;
        transition: opacity 0.18s ease;
        outline: none;
    }
    .edge {
        transition: opacity 0.18s ease;
        pointer-events: none;
    }
    .node-label {
        font-family: var(--font-ui);
        font-size: 10.5px;
        font-weight: 500;
        fill: #c3cad4;
        pointer-events: none;
        transition: opacity 0.18s ease;
    }
    .node-label.focused {
        font-weight: 700;
    }
    .section-label {
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        opacity: 0.85;
        pointer-events: none;
    }

    /* ── Legend ── */
    .legend {
        position: absolute;
        left: 20px;
        bottom: 16px;
        display: flex;
        gap: 18px;
        align-items: center;
        font-size: 12px;
        color: #9aa4b2;
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
        color: var(--color-text-faint);
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
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--color-text-faint);
        margin-bottom: 12px;
    }
    .hint-text {
        margin: 0 0 22px;
        font-size: 13.5px;
        line-height: 1.6;
        color: #b7bfca;
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
        padding: 10px 13px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 10px;
        cursor: pointer;
        text-align: left;
        font-family: var(--font-ui);
        transition: background var(--transition-fast);
    }
    .link-row.hub {
        padding: 11px 13px;
    }
    .link-row:hover {
        background: rgba(255, 255, 255, 0.07);
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
        font-size: 13.5px;
        font-weight: 500;
        color: var(--color-text-primary);
    }
    .row-name.strong {
        font-weight: 600;
    }
    .row-links {
        margin-left: auto;
        font-family: var(--font-mono);
        font-size: 12px;
        font-weight: 500;
        color: var(--color-accent-hover);
    }
    .row-refs {
        margin-left: auto;
        font-family: var(--font-mono);
        font-size: 11.5px;
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
        font-size: 26px;
        font-weight: 600;
        letter-spacing: -0.02em;
        color: var(--color-text-primary);
    }
    .book-sub {
        font-family: var(--font-mono);
        font-size: 12px;
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
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 10px;
    }
    .stat-num {
        font-family: var(--font-mono);
        font-size: 22px;
        font-weight: 500;
        line-height: 1;
        color: var(--color-text-primary);
    }
    .stat-label {
        font-size: 11.5px;
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
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 9px;
        font-family: var(--font-ui);
        font-size: 13px;
        font-weight: 500;
        color: #c3cad4;
        cursor: pointer;
        transition: background var(--transition-fast), color var(--transition-fast);
    }
    .back-btn:hover {
        background: rgba(255, 255, 255, 0.08);
        color: var(--color-text-primary);
    }
</style>
