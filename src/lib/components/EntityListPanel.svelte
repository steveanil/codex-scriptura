<script lang="ts">
    import type { Person, Place, BibleEvent } from '@codex-scriptura/core';

    let {
        persons,
        places,
        events,
        onEntitySelected,
        onClose,
    }: {
        persons: Person[];
        places: Place[];
        events: BibleEvent[];
        onEntitySelected: (payload: { id: string; type: 'person' | 'place' | 'event'; name: string }) => void;
        onClose: () => void;
    } = $props();

    function getInitials(name: string): string {
        return name.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase();
    }

    function confidenceLabel(c: number | undefined): 'certain' | 'probable' | 'possible' | 'uncertain' {
        if (c === undefined) return 'uncertain';
        if (c >= 0.9) return 'certain';
        if (c >= 0.7) return 'probable';
        if (c >= 0.5) return 'possible';
        return 'uncertain';
    }

    let showPersons = $state(false);
    let showPlaces = $state(false);
    let showEvents = $state(false);
</script>

<div class="panel">
    <div class="panel-header">
        <span class="panel-title">In this chapter</span>
        <button class="close-btn" onclick={onClose} aria-label="Close">×</button>
    </div>

    {#if persons.length > 0}
    <section class="entity-section">
        <button class="section-header" onclick={() => showPersons = !showPersons} aria-expanded={showPersons}>
            <span class="chevron" class:expanded={showPersons}>▶</span>
            <span class="section-dot" style="background: #378ADD;"></span>
            <span class="section-label">People</span>
            <span class="section-count">{persons.length}</span>
        </button>
        {#if showPersons}
        <div class="section-content">
            {#each persons as person}
            <button
                class="entity-row"
                onclick={() => onEntitySelected({ id: person.id, type: 'person', name: person.name })}
            >
                <span class="avatar">{getInitials(person.name)}</span>
                <span class="entity-row-name">{person.name}</span>
            </button>
            {/each}
        </div>
        {/if}
    </section>
    {/if}

    {#if places.length > 0}
    <section class="entity-section">
        <button class="section-header" onclick={() => showPlaces = !showPlaces} aria-expanded={showPlaces}>
            <span class="chevron" class:expanded={showPlaces}>▶</span>
            <span class="section-dot" style="background: #1D9E75;"></span>
            <span class="section-label">Places</span>
            <span class="section-count">{places.length}</span>
        </button>
        {#if showPlaces}
        <div class="section-content">
            {#each places as place}
            <button
                class="entity-row"
                onclick={() => onEntitySelected({ id: place.id, type: 'place', name: place.name })}
            >
                <span class="pin-icon">📍</span>
                <span class="entity-row-name">{place.name}</span>
                {#if place.confidence !== undefined && confidenceLabel(place.confidence) !== 'certain'}
                <span class="conf-badge">{confidenceLabel(place.confidence)}</span>
                {/if}
            </button>
            {/each}
        </div>
        {/if}
    </section>
    {/if}

    {#if events.length > 0}
    <section class="entity-section">
        <button class="section-header" onclick={() => showEvents = !showEvents} aria-expanded={showEvents}>
            <span class="chevron" class:expanded={showEvents}>▶</span>
            <span class="section-dot" style="background: #EF9F27;"></span>
            <span class="section-label">Events</span>
            <span class="section-count">{events.length}</span>
        </button>
        {#if showEvents}
        <div class="section-content">
            {#each events as event}
            <button
                class="entity-row event-row"
                onclick={() => onEntitySelected({ id: event.id, type: 'event', name: event.name })}
            >
                <span class="event-bar"></span>
                <span class="entity-row-name">{event.name}</span>
            </button>
            {/each}
        </div>
        {/if}
    </section>
    {/if}
</div>

<style>
    .panel {
        padding: var(--space-4);
        height: 100%;
        overflow-y: auto;
        box-sizing: border-box;
        animation: slideIn 180ms ease-out;
    }

    @keyframes slideIn {
        from { transform: translateX(100%); }
        to { transform: translateX(0); }
    }

    .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--space-4);
    }
    .panel-title {
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-text-muted);
    }
    .close-btn {
        background: none;
        border: none;
        cursor: pointer;
        color: var(--color-text-muted);
        font-size: var(--font-size-base);
        padding: 0 var(--space-1);
        border-radius: 4px;
        line-height: 1;
        transition: color var(--transition-fast), background var(--transition-fast);
    }
    .close-btn:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
    }

    .entity-section {
        margin-bottom: var(--space-5);
    }

    .section-header {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        width: 100%;
        background: none;
        border: none;
        padding: var(--space-2) 0;
        cursor: pointer;
        transition: opacity var(--transition-fast);
    }
    .section-header:hover { opacity: 0.8; }
    
    .chevron {
        font-size: 10px;
        color: var(--color-text-muted);
        transition: transform var(--transition-fast);
        display: inline-block;
    }
    .chevron.expanded { transform: rotate(90deg); }
    
    .section-content {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding-left: 20px; /* Indent underneath the header */
        margin-top: var(--space-1);
    }

    .section-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
    }
    .section-label {
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 600;
        color: var(--color-text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.06em;
    }
    .section-count {
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        margin-left: auto;
    }

    .entity-row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        width: 100%;
        padding: var(--space-2);
        background: none;
        border: none;
        border-radius: var(--radius-sm);
        cursor: pointer;
        text-align: left;
        transition: background var(--transition-fast);
    }
    .entity-row:hover {
        background: var(--color-bg-hover);
    }

    .avatar {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: var(--color-bg-surface);
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .pin-icon {
        font-size: 14px;
        flex-shrink: 0;
        line-height: 1;
        width: 20px;
        text-align: center;
    }

    .entity-row-name {
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-align: left;
    }

    .conf-badge {
        font-size: 10px;
        color: var(--color-text-muted);
        background: var(--color-bg-surface);
        padding: 1px 6px;
        border-radius: 9999px;
        flex-shrink: 0;
    }

    .event-row {
        padding-left: 0;
        gap: var(--space-3);
    }
    .event-bar {
        width: 3px;
        height: 28px;
        background: #EF9F27;
        border-radius: 2px;
        flex-shrink: 0;
    }
</style>
