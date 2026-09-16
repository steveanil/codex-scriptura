/**
 * Presentation rule for SegmentedControl (issue #252).
 *
 * A segmented row holds at most four options. From five on, the same
 * control renders as a labelled dropdown so the row never has to squeeze
 * or wrap: morphology search (#32) and boolean/proximity (v1.0) push the
 * search mode switcher past four, and a dropdown is what fits.
 */
export const SEGMENT_MAX = 4;

export type SegmentOption<T extends string = string> = {
    value: T;
    label: string;
    /** Tooltip; also read by screen readers when the label alone is terse. */
    title?: string;
    disabled?: boolean;
};

export function segmentedPresentation(optionCount: number): 'segments' | 'dropdown' {
    return optionCount > SEGMENT_MAX ? 'dropdown' : 'segments';
}

/** The option `delta` steps from `current`, wrapping and skipping disabled ones. */
export function stepValue<T extends string>(options: SegmentOption<T>[], current: T, delta: 1 | -1): T {
    const enabled = options.filter((o) => !o.disabled);
    if (enabled.length === 0) return current;
    const idx = enabled.findIndex((o) => o.value === current);
    const next = idx === -1 ? 0 : (idx + delta + enabled.length) % enabled.length;
    return enabled[next].value;
}
