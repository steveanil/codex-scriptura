<script lang="ts">
    import type { Snippet } from 'svelte';
    import { clampRailWidth, type RailTab, type RailTabKind, type StudyRailState } from '$lib/stores/studyRail.svelte';

    /**
     * The Study Rail (issue #243): the one right-hand column a reader pane
     * has. A fixed 56px header (kind icon, title, mono qualifier, overflow
     * menu, close), a tab strip once two or more panels are resident, a
     * drag handle on the left edge (320 to 520px), and a documented empty
     * state that says what the rail can show. Panel content comes from the
     * `content` snippet, keyed by the active tab.
     */
    let {
        rail,
        width,
        onResize,
        entityCount = 0,
        onOpenEntities,
        onOpenAnnotations,
        content,
    }: {
        rail: StudyRailState;
        width: number;
        onResize: (width: number) => void;
        /** People, places and events known for the chapter; 0 disables Who's here. */
        entityCount?: number;
        onOpenEntities: () => void;
        onOpenAnnotations: () => void;
        content: Snippet<[RailTab]>;
    } = $props();

    const active = $derived(rail.active);
    let menuOpen = $state(false);
    let resizing = $state(false);

    const ICONS: Record<RailTabKind, string> = {
        entities: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />',
        entity: '<circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />',
        lookup: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />',
        lineage: '<rect x="9" y="3" width="6" height="5" rx="1.5" /><rect x="3" y="16" width="6" height="5" rx="1.5" /><rect x="15" y="16" width="6" height="5" rx="1.5" /><path d="M12 8v4" /><path d="M6 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />',
        plugin: '<path d="M4 7h3a2 2 0 0 0 0-4 2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-3a2 2 0 0 0-4 0 2 2 0 0 0 2 2" />',
    };

    function startResize(e: PointerEvent) {
        e.preventDefault();
        resizing = true;
        const startX = e.clientX;
        const startWidth = width;
        function onMove(ev: PointerEvent) {
            // The handle is on the rail's left edge: dragging left grows it
            onResize(clampRailWidth(startWidth + (startX - ev.clientX)));
        }
        function onUp() {
            resizing = false;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }

    function onTabKey(e: KeyboardEvent, idx: number) {
        const n = rail.tabs.length;
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const next = (idx + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
            rail.activate(rail.tabs[next].id);
            (e.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
        }
    }

    function closeActive() {
        if (active) rail.close(active.id);
        else rail.hide();
    }
</script>

<svelte:window onkeydown={(e) => { if (menuOpen && e.key === 'Escape') menuOpen = false; }} />

<aside
    class="study-rail"
    class:resizing
    style="width: {width}px"
    aria-label="Study rail"
>
    <div
        class="rail-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize study rail"
        title="Drag to resize"
        onpointerdown={startResize}
    ></div>

    <header class="rail-header">
        {#if active}
            <svg class="rail-kind" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ICONS[active.kind]}</svg>
            <h2 class="section-heading rail-title" title={active.title}>{active.title}</h2>
            {#if active.qualifier}<span class="rail-qualifier">{active.qualifier}</span>{/if}
        {:else}
            <h2 class="section-heading rail-title">Study rail</h2>
        {/if}
        <div class="rail-actions">
            {#if rail.tabs.length > 0}
                <div class="rail-menu-wrap">
                    <button
                        class="rail-btn"
                        aria-label="Rail options"
                        title="Rail options"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        onclick={() => (menuOpen = !menuOpen)}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
                    </button>
                    {#if menuOpen}
                        <div class="rail-menu-overlay" onclick={() => (menuOpen = false)} role="presentation"></div>
                        <div class="rail-menu" role="menu">
                            {#if active && rail.tabs.length > 1}
                                <button role="menuitem" onclick={() => { rail.closeOthers(active.id); menuOpen = false; }}>Close other tabs</button>
                            {/if}
                            <button role="menuitem" onclick={() => { rail.closeAll(); menuOpen = false; }}>Close all tabs</button>
                            <button role="menuitem" onclick={() => { rail.hide(); menuOpen = false; }}>Hide rail, keep tabs</button>
                        </div>
                    {/if}
                </div>
            {/if}
            <button
                class="rail-btn rail-close"
                aria-label={active ? `Close ${active.title}` : 'Close study rail'}
                title={active ? 'Close this tab' : 'Close'}
                onclick={closeActive}
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
        </div>
    </header>

    {#if rail.tabs.length > 1}
        <div class="rail-tabs" role="tablist" aria-label="Open panels">
            {#each rail.tabs as t, i (t.id)}
                <button
                    class="rail-tab"
                    role="tab"
                    aria-selected={t.id === rail.activeId}
                    tabindex={t.id === rail.activeId ? 0 : -1}
                    title={t.title}
                    onclick={() => rail.activate(t.id)}
                    onkeydown={(e) => onTabKey(e, i)}
                >
                    <span class="rail-tab-title">{t.title}</span>
                    {#if t.badge}<span class="rail-tab-badge">{t.badge}</span>{/if}
                </button>
            {/each}
        </div>
    {/if}

    <div class="rail-body">
        {#if active}
            {#key active.id}
                {@render content(active)}
            {/key}
        {:else}
            <div class="rail-empty">
                <p class="rail-empty-lead">Nothing open yet. This rail can show:</p>
                <button class="rail-empty-item" onclick={onOpenEntities} disabled={entityCount === 0}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ICONS.entities}</svg>
                    <span>
                        <strong>Who's here</strong>
                        <small>{entityCount > 0 ? `${entityCount} people, places and events in this chapter` : 'No people, places or events recorded for this chapter'}</small>
                    </span>
                </button>
                <div class="rail-empty-item static">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ICONS.lookup}</svg>
                    <span>
                        <strong>Word lookup</strong>
                        <small>Double-click any word in the text for its Easton's entry</small>
                    </span>
                </div>
                <div class="rail-empty-item static">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ICONS.lineage}</svg>
                    <span>
                        <strong>Lineage</strong>
                        <small>Tap a name in the Table of Nations (Genesis 10) to trace its line</small>
                    </span>
                </div>
                <button class="rail-empty-item" onclick={onOpenAnnotations}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                    <span>
                        <strong>Annotations</strong>
                        <small>Notes, highlights and themes for this chapter</small>
                    </span>
                </button>
            </div>
        {/if}
    </div>
</aside>

<style>
    /* Raised surface: elevated bg plus a hairline, no shadow. */
    .study-rail {
        position: relative;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        min-height: 0;
        max-width: 60vw;
        overflow: hidden;
        background: var(--color-bg-elevated);
        border-left: 1px solid var(--color-border);
    }
    .study-rail.resizing {
        user-select: none;
    }
    .rail-resize-handle {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        width: 6px;
        cursor: col-resize;
        z-index: 5;
        touch-action: none;
    }
    .rail-resize-handle:hover,
    .resizing .rail-resize-handle {
        background: var(--color-accent-subtle);
        box-shadow: inset 2px 0 0 var(--color-accent);
    }

    /* ── Header: fixed 56px ── */
    .rail-header {
        flex: none;
        display: flex;
        align-items: center;
        gap: var(--space-2);
        height: var(--header-height);
        padding: 0 var(--space-2) 0 var(--space-4);
        border-bottom: 1px solid var(--color-border);
    }
    .rail-kind {
        flex: none;
        color: var(--color-text-muted);
    }
    .rail-title {
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }
    .rail-qualifier {
        flex: none;
        font-family: var(--font-mono);
        font-size: var(--font-size-2xs);
        font-weight: 500;
        color: var(--color-text-muted);
        white-space: nowrap;
    }
    .rail-actions {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 2px;
        flex: none;
    }
    .rail-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--row-h-sm);
        height: var(--row-h-sm);
        background: none;
        border: none;
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
        cursor: pointer;
        transition: color var(--transition-fast), background var(--transition-fast);
    }
    .rail-btn:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
    }

    /* ── Overflow menu: floating ── */
    .rail-menu-wrap {
        position: relative;
    }
    .rail-menu-overlay {
        position: fixed;
        inset: 0;
        z-index: 30;
    }
    .rail-menu {
        position: absolute;
        top: calc(100% + 4px);
        right: 0;
        z-index: 31;
        min-width: 180px;
        padding: var(--space-1);
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-floating);
        display: flex;
        flex-direction: column;
    }
    .rail-menu button {
        display: block;
        width: 100%;
        min-height: var(--row-h-sm);
        padding: 0 var(--space-3);
        background: none;
        border: none;
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        text-align: left;
        cursor: pointer;
    }
    .rail-menu button:hover {
        background: var(--color-bg-hover);
    }

    /* ── Tab strip ── */
    .rail-tabs {
        flex: none;
        display: flex;
        align-items: stretch;
        border-bottom: 1px solid var(--color-border);
        overflow-x: auto;
        scrollbar-width: none;
    }
    .rail-tabs::-webkit-scrollbar { display: none; }
    .rail-tab {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        min-height: var(--row-h-md);
        padding: 0 var(--space-3);
        max-width: 50%;
        background: none;
        border: none;
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 500;
        white-space: nowrap;
        cursor: pointer;
        transition: color var(--transition-fast);
    }
    .rail-tab:hover {
        color: var(--color-text-primary);
    }
    .rail-tab[aria-selected='true'] {
        color: var(--color-text-primary);
        font-weight: 600;
    }
    .rail-tab[aria-selected='true']::after {
        content: '';
        position: absolute;
        left: var(--space-3);
        right: var(--space-3);
        bottom: 0;
        height: 2px;
        background: var(--color-accent);
        border-radius: 1px;
    }
    .rail-tab-title {
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .rail-tab-badge {
        flex: none;
        padding: 0 6px;
        border-radius: var(--radius-pill);
        background: var(--color-bg-surface);
        color: var(--color-text-muted);
        font-size: var(--font-size-2xs);
        font-weight: 600;
        line-height: 1.6;
    }

    .rail-body {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    /* ── Empty state ── */
    .rail-empty {
        padding: var(--space-4);
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        overflow-y: auto;
    }
    .rail-empty-lead {
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
        margin-bottom: var(--space-2);
    }
    .rail-empty-item {
        display: flex;
        align-items: flex-start;
        gap: var(--space-3);
        width: 100%;
        min-height: var(--row-h-lg);
        padding: var(--space-2) var(--space-3);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        text-align: left;
        cursor: pointer;
        transition: background var(--transition-fast), border-color var(--transition-fast);
    }
    .rail-empty-item svg {
        flex: none;
        margin-top: 2px;
        color: var(--color-text-muted);
    }
    .rail-empty-item span {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .rail-empty-item strong {
        font-size: var(--font-size-sm);
        font-weight: 600;
    }
    .rail-empty-item small {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        line-height: 1.4;
    }
    button.rail-empty-item:hover:not(:disabled) {
        background: var(--color-bg-control-hover);
        border-color: var(--color-border-control);
    }
    .rail-empty-item:disabled {
        cursor: default;
        opacity: 0.6;
    }
    .rail-empty-item.static {
        cursor: default;
    }

    /* Phones: the rail covers the pane until #253 turns it into a sheet. */
    @media (max-width: 768px) {
        .study-rail {
            position: absolute;
            inset: 0;
            width: 100% !important;
            max-width: none;
            z-index: 20;
            border-left: none;
        }
        .rail-resize-handle { display: none; }
    }
</style>
