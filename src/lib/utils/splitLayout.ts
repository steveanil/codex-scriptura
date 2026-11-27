/**
 * Split-view workspace layout logic (issue #24): scroll syncing as a
 * fraction of scrollable height, flex-weight arithmetic for the draggable
 * dividers, and the divider pointer-drag wiring. Everything except
 * startDividerDrag is DOM-free and unit-tested.
 */

/**
 * Current scroll position as a 0-1 fraction of the scrollable height.
 * Fractions - never raw pixels - are what sync scroll exchanges between
 * panes, because panes have different content lengths.
 */
export function scrollFraction(scrollTop: number, scrollHeight: number, clientHeight: number): number {
    const range = scrollHeight - clientHeight;
    if (range <= 0) return 0;
    return Math.min(1, Math.max(0, scrollTop / range));
}

/** Convert a 0-1 fraction back to a scrollTop for a target pane. */
export function fractionToScrollTop(fraction: number, scrollHeight: number, clientHeight: number): number {
    const range = scrollHeight - clientHeight;
    if (range <= 0) return 0;
    return Math.min(1, Math.max(0, fraction)) * range;
}

/** Smallest share of the row a pane can be dragged down to. */
export const MIN_PANE_FRACTION = 0.15;

/**
 * Returns `weights` resized to `count` panes, preserving their proportions.
 * New panes join at the average weight so adding a pane doesn't wipe out
 * the user's sizing of the others.
 *
 * The result always sums to `count`. Panes render with `flex: <w> 1 0%`,
 * and flexbox hands out only that fraction of the free space when the
 * grow factors sum below 1 - so weights left over from a wider layout
 * (a pane dragged narrow, its neighbours then closed) would leave the
 * survivors short of the row. A lone pane always comes back as [1].
 */
export function normalizeWeights(weights: number[], count: number): number[] {
    if (count <= 0) return [];
    let valid = weights.filter((w) => Number.isFinite(w) && w > 0);
    if (valid.length > count) valid = valid.slice(0, count);
    if (valid.length < count) {
        const avg = valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 1;
        valid = [...valid, ...Array(count - valid.length).fill(avg)];
    }
    const total = valid.reduce((a, b) => a + b, 0);
    return valid.map((w) => (w / total) * count);
}

/**
 * Apply a divider drag: divider `idx` sits between panes idx and idx+1;
 * `deltaPx` is the pointer travel (positive = rightward) inside a row
 * `containerPx` wide. Only the two adjacent panes trade weight, and
 * neither may shrink below MIN_PANE_FRACTION of the row.
 */
export function dragWeights(weights: number[], idx: number, deltaPx: number, containerPx: number): number[] {
    if (idx < 0 || idx + 1 >= weights.length || containerPx <= 0) return weights;
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return weights;

    const minWeight = total * MIN_PANE_FRACTION;
    let delta = (deltaPx / containerPx) * total;
    // Clamp so both neighbours stay at or above the minimum
    delta = Math.min(delta, weights[idx + 1] - minWeight);
    delta = Math.max(delta, minWeight - weights[idx]);

    const next = [...weights];
    next[idx] += delta;
    next[idx + 1] -= delta;
    return next;
}

/**
 * Wire up one divider drag from its pointerdown event: captures the
 * pointer on the divider, streams reweighted arrays to `onDrag`, and
 * calls `onEnd` once on release or cancel.
 */
export function startDividerDrag(
    e: PointerEvent,
    opts: {
        /** Divider index: sits between panes index and index+1. */
        index: number;
        /** Row width in px at drag start. */
        rowWidth: number;
        /** Weights at drag start (a plain copy, not reactive state). */
        startWeights: number[];
        onDrag: (weights: number[]) => void;
        onEnd: () => void;
    }
): void {
    e.preventDefault();
    const divider = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    divider.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
        opts.onDrag(dragWeights(opts.startWeights, opts.index, ev.clientX - startX, opts.rowWidth));
    };
    const stop = () => {
        divider.removeEventListener('pointermove', move);
        divider.removeEventListener('pointerup', stop);
        divider.removeEventListener('pointercancel', stop);
        opts.onEnd();
    };
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', stop);
    divider.addEventListener('pointercancel', stop);
}
