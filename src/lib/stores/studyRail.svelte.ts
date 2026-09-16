/**
 * Study Rail state (issue #243): one tabbed rail per reader pane holding
 * up to four resident panels. Dictionary lookup, Who's here, entity
 * detail, lineage and (later) plugin panels all register as tabs; nothing
 * else may claim the column. Showing a fifth tab evicts the least
 * recently used one; re-showing an existing id updates it in place and
 * brings it forward instead of duplicating it.
 */

export type RailTabKind = 'entities' | 'entity' | 'lookup' | 'lineage' | 'plugin';

export type RailTab<P = unknown> = {
    /** Stable identity: 'entities', 'entity:<id>', 'lookup:<word>', 'lineage', 'plugin:<plugin>:<panel>'. */
    id: string;
    kind: RailTabKind;
    title: string;
    /** Mono qualifier in the header, e.g. "Person", "Gen 10", "Easton's". */
    qualifier?: string;
    /** Count badge on the tab strip. */
    badge?: number;
    payload?: P;
    /** Set by the store on show/activate; drives LRU eviction. */
    lastUsed: number;
};

export const RAIL_MAX_RESIDENT = 4;
export const RAIL_MIN_WIDTH = 320;
export const RAIL_MAX_WIDTH = 520;
export const RAIL_DEFAULT_WIDTH = 360;

export function clampRailWidth(w: number): number {
    if (!Number.isFinite(w)) return RAIL_DEFAULT_WIDTH;
    return Math.min(RAIL_MAX_WIDTH, Math.max(RAIL_MIN_WIDTH, Math.round(w)));
}

export class StudyRailState {
    tabs = $state<RailTab[]>([]);
    activeId = $state<string | null>(null);
    /** Visible. True with no tabs shows the empty state; false keeps tabs resident but hidden. */
    open = $state(false);

    #clock = 0;

    get active(): RailTab | null {
        return this.tabs.find((t) => t.id === this.activeId) ?? null;
    }

    /** Open (or refresh) a tab, activate it and make the rail visible. */
    show<P>(tab: Omit<RailTab<P>, 'lastUsed'>): void {
        const stamp = ++this.#clock;
        const idx = this.tabs.findIndex((t) => t.id === tab.id);
        if (idx === -1) {
            const next = [...this.tabs, { ...tab, lastUsed: stamp } as RailTab];
            // Evict least recently used beyond the residency limit; the tab
            // just added is the newest and can never be the victim.
            while (next.length > RAIL_MAX_RESIDENT) {
                let victim = 0;
                for (let i = 1; i < next.length; i++) if (next[i].lastUsed < next[victim].lastUsed) victim = i;
                next.splice(victim, 1);
            }
            this.tabs = next;
        } else {
            this.tabs = this.tabs.map((t, i) => (i === idx ? { ...t, ...tab, lastUsed: stamp } as RailTab : t));
        }
        this.activeId = tab.id;
        this.open = true;
    }

    /** Patch a resident tab without changing focus or order; no-op if absent. */
    update<P>(id: string, patch: Partial<Omit<RailTab<P>, 'id' | 'lastUsed'>>): void {
        const current = this.tabs.find((t) => t.id === id);
        if (!current) return;
        // Skip a patch that changes nothing so callers can re-apply freely
        // without churning the array (and any effect watching it).
        const same = (Object.keys(patch) as (keyof typeof patch)[]).every((k) => current[k] === patch[k]);
        if (same) return;
        this.tabs = this.tabs.map((t) => (t.id === id ? ({ ...t, ...patch } as RailTab) : t));
    }

    has(id: string): boolean {
        return this.tabs.some((t) => t.id === id);
    }

    activate(id: string): void {
        if (!this.has(id)) return;
        const stamp = ++this.#clock;
        this.tabs = this.tabs.map((t) => (t.id === id ? { ...t, lastUsed: stamp } : t));
        this.activeId = id;
        this.open = true;
    }

    /** Close one tab. The most recently used remaining tab takes over; closing the last tab closes the rail. */
    close(id: string): void {
        if (!this.has(id)) return;
        this.tabs = this.tabs.filter((t) => t.id !== id);
        if (this.activeId === id) {
            const next = [...this.tabs].sort((a, b) => b.lastUsed - a.lastUsed)[0];
            this.activeId = next?.id ?? null;
        }
        if (this.tabs.length === 0) this.open = false;
    }

    closeOthers(id: string): void {
        if (!this.has(id)) return;
        this.tabs = this.tabs.filter((t) => t.id === id);
        this.activeId = id;
    }

    closeAll(): void {
        this.tabs = [];
        this.activeId = null;
        this.open = false;
    }

    /** The header toggle: hide keeps tabs resident; show brings back the last active one (or the empty state). */
    toggle(): void {
        this.open = !this.open;
    }

    hide(): void {
        this.open = false;
    }
}
