<script lang="ts">
    import {
        loadFamilyGraph,
        resolveTreeRoot,
        layoutTree,
        subtreeCount,
        ancestryPath,
        hasBothLines,
        TREE_CARD_W,
        TREE_CARD_H,
        type FamilyGraph,
        type CrumbPerson,
        type LineagePreference,
    } from '$lib/engines/familyTree';

    let {
        rootId,
        onClose,
    }: {
        /** Theographic person id (or a display name to resolve) */
        rootId: string;
        onClose: () => void;
    } = $props();

    let graph = $state<FamilyGraph | null>(null);
    // Local exploration state, re-seeded whenever the opener changes the root
    let treeRoot = $state<string | null>(null);
    let homeRoot = $state<string | null>(null);
    let generations = $state(2);
    let notFound = $state(false);
    let line = $state<LineagePreference>('paternal');

    let graphPromise: Promise<FamilyGraph> | null = null;

    $effect(() => {
        const requested = rootId;
        let cancelled = false;
        (graphPromise ??= loadFamilyGraph()).then(async (g) => {
            if (cancelled) return;
            const resolved = await resolveTreeRoot(g, requested);
            if (cancelled) return;
            graph = g;
            treeRoot = resolved ?? null;
            homeRoot = resolved ?? null;
            notFound = !resolved;
            generations = 2;
            line = 'paternal';
        });
        return () => {
            cancelled = true;
        };
    });

    const tree = $derived(graph && treeRoot ? layoutTree(graph, treeRoot, generations) : null);
    const descendantCount = $derived(graph && treeRoot ? subtreeCount(graph, treeRoot) : 0);
    const homeName = $derived((graph && homeRoot && graph.names.get(homeRoot)) || '');

    // Both a father and a mother on record → two traceable lines (e.g. Jesus:
    // Matthew 1 through Joseph, Luke 3 through Mary and Heli)
    const twoLines = $derived(graph && treeRoot ? hasBothLines(graph, treeRoot) : false);

    // Long lineages (e.g. David back to Adam) collapse the middle of the crumb
    const crumb = $derived.by<(CrumbPerson | null)[]>(() => {
        if (!graph || !treeRoot) return [];
        const path = ancestryPath(graph, treeRoot, line);
        return path.length > 7 ? [path[0], null, ...path.slice(-5)] : path;
    });

    function recenter(id: string) {
        treeRoot = id;
        generations = 2;
        line = 'paternal';
    }

    function reset() {
        treeRoot = homeRoot;
        generations = 2;
        line = 'paternal';
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') onClose();
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onClose}>
    <div
        class="genealogy-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Genealogy tree"
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
    >
        <!-- Header -->
        <div class="tree-header">
            <div class="tree-title-row">
                <svg class="tree-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#e0a44a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="3" width="6" height="5" rx="1.5" />
                    <rect x="3" y="16" width="6" height="5" rx="1.5" />
                    <rect x="15" y="16" width="6" height="5" rx="1.5" />
                    <path d="M12 8v4" /><path d="M6 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
                </svg>
                <span class="tree-title">Genealogy</span>
                {#if tree}
                    <span class="tree-count">{descendantCount} descendants</span>
                {/if}
                <button class="reset-btn" onclick={reset} disabled={treeRoot === homeRoot && generations === 2}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />
                    </svg>
                    Reset to {homeName || 'start'}
                </button>
                <button class="close-btn" aria-label="Close genealogy tree" onclick={onClose}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                </button>
            </div>
            <div class="tree-controls-row">
                {#if twoLines}
                    <div class="line-toggle" role="group" aria-label="Lineage side">
                        <button
                            class="line-btn"
                            class:active={line === 'paternal'}
                            aria-pressed={line === 'paternal'}
                            onclick={() => (line = 'paternal')}
                        >Father’s line</button>
                        <button
                            class="line-btn"
                            class:active={line === 'maternal'}
                            aria-pressed={line === 'maternal'}
                            onclick={() => (line = 'maternal')}
                        >Mother’s line</button>
                    </div>
                {/if}
                <nav class="crumb" aria-label="Lineage breadcrumb">
                    {#each crumb as person, i (person ? person.id : '…')}
                        {#if person}
                            <button class="crumb-link" onclick={() => recenter(person.id)}>{person.name}</button>
                        {:else}
                            <span class="crumb-sep">…</span>
                        {/if}
                        {#if i < crumb.length - 1}<span class="crumb-sep">/</span>{/if}
                    {/each}
                </nav>
                <div class="gens-control">
                    <span class="gens-label">Generations</span>
                    <input type="range" min="1" max="3" bind:value={generations} aria-label="Generations shown" />
                    <span class="gens-value">{generations}</span>
                </div>
            </div>
        </div>

        <!-- Tree canvas -->
        <div class="tree-scroll">
            {#if tree}
                <svg width={tree.width} height={tree.height}>
                    {#each tree.edges as edge, i (i)}
                        <path d={edge.d} fill="none" stroke={edge.color} stroke-width="1.5" opacity="0.45" />
                    {/each}
                    {#each tree.nodes as n (n.id)}
                        {@const clickable = n.kids > 0 && !n.isRoot}
                        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                        <g
                            class="person-card"
                            class:clickable
                            role={clickable ? 'button' : 'img'}
                            tabindex={clickable ? 0 : undefined}
                            aria-label="{n.name}, {n.kids} children"
                            onclick={() => { if (clickable) recenter(n.id); }}
                            onkeydown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && clickable) { e.preventDefault(); recenter(n.id); } }}
                        >
                            <rect
                                x={n.x} y={n.y} width={TREE_CARD_W} height={TREE_CARD_H} rx="9"
                                fill={n.isRoot ? 'rgba(224,164,74,.14)' : 'rgba(255,255,255,.045)'}
                                stroke={n.isRoot ? '#e0a44a' : 'rgba(255,255,255,.09)'}
                                stroke-width="1.2"
                            />
                            <rect x={n.x} y={n.y} width="3" height={TREE_CARD_H} rx="1.5" fill={n.color} />
                            <circle cx={n.x + 19} cy={n.y + TREE_CARD_H / 2} r="10" fill={n.color} />
                            <text class="card-initial" x={n.x + 19} y={n.y + TREE_CARD_H / 2 + 3.4} text-anchor="middle">{n.name[0]}</text>
                            <text class="card-name" x={n.x + 37} y={n.y + 15}>{n.name}</text>
                            <text class="card-sub" x={n.x + 37} y={n.y + 27}>
                                {n.more ? `+${n.more} desc.` : n.kids ? `${n.kids} ${n.kids > 1 ? 'children' : 'child'}` : 'no issue'}
                            </text>
                        </g>
                    {/each}
                </svg>
            {:else}
                <div class="tree-empty">
                    {notFound ? 'No family records found for this person.' : 'Loading family records…'}
                </div>
            {/if}
        </div>

        <!-- Legend: the current root's direct children color the branches -->
        <div class="tree-legend">
            {#each (tree?.branches ?? []).slice(0, 6) as b (b.id)}
                <span class="legend-item"><span class="swatch" style="background:{b.color}"></span>{b.name}</span>
            {/each}
            {#if tree && tree.branches.length > 6}
                <span class="legend-item legend-more">+{tree.branches.length - 6} more</span>
            {/if}
            <span class="legend-hint">Click a person to re-center · Esc to close</span>
        </div>
    </div>
</div>

<style>
    .modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 1000;
        background: rgba(9, 12, 16, 0.6);
        backdrop-filter: blur(2px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px;
        animation: backdrop-in 0.18s ease;
    }
    @keyframes backdrop-in {
        from { opacity: 0; }
        to { opacity: 1; }
    }

    .genealogy-modal {
        width: min(1180px, 100%);
        height: min(780px, 100%);
        display: flex;
        flex-direction: column;
        background: var(--color-bg-deep);
        border: 1px solid var(--color-border);
        border-radius: 14px;
        overflow: hidden;
        box-shadow: 0 30px 70px -30px rgba(18, 22, 28, 0.45), 0 2px 8px rgba(18, 22, 28, 0.12);
        animation: modal-in 0.18s ease;
    }
    @keyframes modal-in {
        from { opacity: 0; transform: translateY(8px) scale(0.985); }
        to { opacity: 1; transform: none; }
    }

    /* ── Header ── */
    .tree-header {
        flex: none;
        padding: 18px 24px 14px;
        border-bottom: 1px solid var(--color-border-subtle);
    }
    .tree-title-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 14px;
    }
    .tree-icon {
        flex: none;
    }
    .tree-title {
        font-size: 17px;
        font-weight: 600;
        letter-spacing: -0.01em;
        color: var(--color-text-primary);
    }
    .tree-count {
        font-family: var(--font-mono);
        font-size: 12px;
        font-weight: 500;
        color: var(--color-text-faint);
    }
    .reset-btn {
        margin-left: auto;
        height: 30px;
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
        transition: background var(--transition-fast), color var(--transition-fast);
    }
    .reset-btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.08);
        color: var(--color-text-primary);
    }
    .reset-btn:disabled {
        opacity: 0.45;
        cursor: default;
    }
    .close-btn {
        background: none;
        border: none;
        padding: 4px;
        display: flex;
        color: var(--color-text-muted);
        cursor: pointer;
        border-radius: 6px;
        transition: color var(--transition-fast), background var(--transition-fast);
    }
    .close-btn:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
    }
    .tree-controls-row {
        display: flex;
        align-items: center;
        gap: 16px;
    }
    .line-toggle {
        display: flex;
        flex: none;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        overflow: hidden;
    }
    .line-btn {
        background: none;
        border: none;
        padding: 5px 10px;
        font-family: var(--font-ui);
        font-size: 11.5px;
        font-weight: 500;
        color: var(--color-text-muted);
        cursor: pointer;
        transition: background var(--transition-fast), color var(--transition-fast);
    }
    .line-btn + .line-btn {
        border-left: 1px solid rgba(255, 255, 255, 0.08);
    }
    .line-btn:hover {
        color: var(--color-text-primary);
    }
    .line-btn.active {
        background: rgba(224, 164, 74, 0.14);
        color: #e0a44a;
    }

    .crumb {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        min-width: 0;
    }
    .crumb-link {
        background: none;
        border: none;
        padding: 0;
        font-family: var(--font-ui);
        font-size: 12.5px;
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
    .gens-control {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 10px;
        flex: none;
    }
    .gens-label {
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--color-text-faint);
    }
    .gens-control input[type='range'] {
        width: 120px;
        accent-color: #5e9ed6;
    }
    .gens-value {
        font-family: var(--font-mono);
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
        width: 14px;
    }

    /* ── Tree canvas ── */
    .tree-scroll {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 8px 0;
    }
    .tree-scroll svg {
        display: block;
    }
    .tree-empty {
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--font-ui);
        font-size: 13.5px;
        color: var(--color-text-muted);
    }
    .person-card {
        outline: none;
    }
    .person-card.clickable {
        cursor: pointer;
    }
    .person-card.clickable:hover rect:first-of-type {
        stroke: rgba(255, 255, 255, 0.25);
    }
    .person-card rect,
    .person-card circle {
        transition: stroke 0.18s ease;
    }
    .card-initial {
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: 700;
        fill: #0f1319;
        pointer-events: none;
    }
    .card-name {
        font-family: var(--font-ui);
        font-size: 13px;
        font-weight: 600;
        fill: #e7eaf0;
        pointer-events: none;
    }
    .card-sub {
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: 500;
        fill: #7a8494;
        pointer-events: none;
    }

    /* ── Legend ── */
    .tree-legend {
        flex: none;
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px 18px;
        padding: 12px 24px;
        border-top: 1px solid var(--color-border-subtle);
        font-size: 12px;
        color: #9aa4b2;
    }
    .legend-more {
        color: var(--color-text-faint);
    }
    .legend-item {
        display: flex;
        align-items: center;
        gap: 7px;
    }
    .swatch {
        width: 10px;
        height: 10px;
        border-radius: 3px;
    }
    .legend-hint {
        margin-left: auto;
        color: var(--color-text-faint);
    }
</style>
