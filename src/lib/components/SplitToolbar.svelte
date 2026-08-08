<script lang="ts">
    let {
        syncScroll,
        showRefs,
        showDivergence,
        mapOpen,
        canCompare,
        statusLabel,
        onToggleSyncScroll,
        onToggleRefs,
        onToggleDivergence,
        onToggleMap,
    }: {
        syncScroll: boolean;
        showRefs: boolean;
        showDivergence: boolean;
        mapOpen: boolean;
        /** Two or more panes show the lead's chapter in different translations. */
        canCompare: boolean;
        /** "Comparing KJV · ASV", or the reason nothing is comparable. */
        statusLabel: string;
        onToggleSyncScroll: () => void;
        onToggleRefs: () => void;
        onToggleDivergence: () => void;
        onToggleMap: () => void;
    } = $props();

    const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
    const needCompare = 'Needs two panes on the same chapter in different translations';
</script>

<div class="workspace-toolbar">
    <button
        class="toolbar-btn"
        id="sync-scroll-toggle"
        class:active={syncScroll}
        aria-pressed={syncScroll}
        onclick={onToggleSyncScroll}
        title="Scroll all panes together - verse-matched when they share a chapter"
    >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 3v18M16 3v18"/>
            <path d="M5 12h6M13 12h6"/>
        </svg>
        Sync scroll
    </button>
    <button
        class="toolbar-btn"
        id="refs-toggle"
        class:active={showRefs}
        aria-pressed={showRefs}
        onclick={onToggleRefs}
        title="Inline cross-reference and quotation markers"
    >Refs</button>
    <button
        class="toolbar-btn"
        id="divergence-toggle"
        class:active={showDivergence}
        aria-pressed={showDivergence}
        disabled={!canCompare}
        onclick={onToggleDivergence}
        title={canCompare ? 'Shade wording that differs between the compared translations' : needCompare}
    >Divergence</button>
    <!-- An open Map stays closable even when nothing is comparable -
         it explains the state itself and must not trap the user. -->
    <button
        class="toolbar-btn"
        id="dv-map-toggle"
        class:active={mapOpen}
        aria-pressed={mapOpen}
        disabled={!canCompare && !mapOpen}
        onclick={onToggleMap}
        title={canCompare || mapOpen ? 'Divergence map: every verse where the compared translations disagree' : needCompare}
    >Map</button>
    <span class="compare-status" class:comparing={canCompare} id="compare-status">
        {#if canCompare}<span class="status-dot" aria-hidden="true"></span>{/if}{statusLabel}
    </span>
    <span class="toolbar-hint"><kbd>{isMac ? '⌘\\' : 'Ctrl+\\'}</kbd> closes the split</span>
</div>

<style>
    .workspace-toolbar {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-1) var(--space-6);
        background: var(--color-bg-elevated);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
        min-width: 0;
    }

    .toolbar-btn {
        display: flex;
        flex: none;
        align-items: center;
        gap: var(--space-1);
        padding: var(--space-1) var(--space-2);
        background: none;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 500;
        white-space: nowrap;
        cursor: pointer;
        transition: all var(--transition-fast);
    }
    .toolbar-btn:hover:not(:disabled) {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
        border-color: var(--color-accent);
    }
    .toolbar-btn.active {
        color: var(--color-accent);
        background: var(--color-accent-subtle);
        border-color: var(--color-accent);
        font-weight: 600;
    }
    .toolbar-btn:disabled {
        opacity: 0.4;
        cursor: default;
    }

    /* Names what is being compared - or says why nothing is */
    .compare-status {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        margin-left: var(--space-2);
        color: var(--color-text-faint);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 0 1 auto;
        min-width: 0;
    }
    .compare-status.comparing {
        color: var(--color-text-muted);
    }
    .status-dot {
        flex: none;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--color-accent);
    }

    .toolbar-hint {
        margin-left: auto;
        color: var(--color-text-muted);
        font-size: var(--font-size-xs);
        white-space: nowrap;
        overflow: hidden;
        /* Hint, then status, are the things allowed to give way - the
           toggles must never be pushed out of the bar */
        flex: 0 1 auto;
        min-width: 0;
    }
    .toolbar-hint kbd {
        padding: 0 var(--space-1);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: 3px;
        font-family: var(--font-ui);
        font-size: 0.65rem;
    }

    @media (max-width: 1000px) {
        .toolbar-hint { display: none; }
    }
    /* Splits are desktop furniture; the shell stacks panes on phones */
    @media (max-width: 768px) {
        .workspace-toolbar { display: none; }
    }
</style>
