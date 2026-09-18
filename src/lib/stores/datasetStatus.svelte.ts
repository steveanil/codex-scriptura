import { observeInstalledDatasets } from '@codex-scriptura/db';

// ─── Dataset status store (issues #168, #244) ──────────────
// One reactive view of every dataset the app knows: what the profile holds
// (a live query on the datasets table, so an install flips a dataset to
// installed the moment its identity row lands), what is downloading right
// now and how far along, and what failed. Features that need an
// enhancement dataset read `state(id)` and light up without a reload.

export type DatasetPhase = 'idle' | 'critical' | 'enhancing' | 'done';
export type DatasetUiState = 'installed' | 'loading' | 'failed' | 'absent';

export type DatasetProgress = {
    id: string;
    label: string;
    bytes?: number;
    /** 0-1 while downloading and inserting; null while queued. */
    fraction: number | null;
};

function createDatasetStatusStore() {
    let installed = $state<Set<string>>(new Set());
    let phase = $state<DatasetPhase>('idle');
    /** Datasets this boot intends to install, in order, whether or not they have started. */
    let queue = $state<DatasetProgress[]>([]);
    let failed = $state<Record<string, string>>({});
    let subscribed = false;

    function watch() {
        if (subscribed) return;
        subscribed = true;
        observeInstalledDatasets().subscribe({
            next: (rows) => { installed = new Set(rows.map((r) => r.id)); },
            error: (err) => console.error('[datasets] live query failed:', err),
        });
    }

    function entry(id: string): DatasetProgress | undefined {
        return queue.find((q) => q.id === id);
    }

    return {
        get installed() { return installed; },
        get phase() { return phase; },
        get queue() { return queue; },
        get failed() { return failed; },
        /** The dataset currently downloading, if any. */
        get active(): DatasetProgress | undefined {
            return queue.find((q) => q.fraction !== null && q.fraction < 1 && !installed.has(q.id));
        },
        /** True once the boot-critical datasets are in and the reader may open. */
        get criticalDone() { return phase === 'enhancing' || phase === 'done'; },
        /** Datasets still to come this boot (queued or in flight). */
        get remaining(): DatasetProgress[] {
            return queue.filter((q) => !installed.has(q.id) && !(q.id in failed));
        },

        watch,
        isInstalled(id: string): boolean { return installed.has(id); },
        state(id: string): DatasetUiState {
            if (installed.has(id)) return 'installed';
            if (id in failed) return 'failed';
            const q = entry(id);
            if (!q) return 'absent';
            // In flight (a retry after boot included), or still queued while boot is working through the plan
            if (q.fraction !== null && q.fraction < 1) return 'loading';
            if (phase === 'critical' || phase === 'enhancing') return 'loading';
            return 'absent';
        },

        setPhase(next: DatasetPhase) { phase = next; },
        /** Declare this boot's plan; datasets already installed are listed too so the screen can show them done. */
        plan(items: Array<Pick<DatasetProgress, 'id' | 'label' | 'bytes'>>) {
            queue = items.map((i) => ({ ...i, fraction: null }));
            failed = {};
        },
        progress(id: string, fraction: number) {
            const q = entry(id);
            if (q) q.fraction = Math.max(0, Math.min(1, fraction));
        },
        /** A dataset is starting (again): make sure it is on the plan and no longer marked failed. */
        begin(id: string, label: string, bytes?: number) {
            const q = entry(id);
            if (!q) queue = [...queue, { id, label, bytes, fraction: 0 }];
            else q.fraction = 0;
            if (id in failed) {
                const { [id]: _dropped, ...rest } = failed;
                failed = rest;
            }
        },
        fail(id: string, message: string) {
            failed = { ...failed, [id]: message };
        },
        /** Take a dataset off this boot's plan (a translation removed before the loop reached it). */
        drop(id: string) {
            queue = queue.filter((q) => q.id !== id);
        },
    };
}

export const datasetStatus = createDatasetStatusStore();
