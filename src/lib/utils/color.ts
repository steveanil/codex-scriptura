/**
 * Color helpers for deriving the accent family (hover, subtle, highlight)
 * from the user's single accent-color preference. All inputs are hex colors
 * (#rgb or #rrggbb, as produced by <input type="color">); invalid input
 * falls through to safe defaults rather than throwing mid-render.
 */

export function hexToRgb(hex: string): [number, number, number] | null {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** `rgba()` string of a hex color at the given alpha; the hex itself when unparseable. */
export function withAlpha(hex: string, alpha: number): string {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function mixChannel(from: number, to: number, amount: number): number {
    return Math.round(from + (to - from) * amount);
}

/** Mix a hex color toward white by `amount` (0–1); the input when unparseable. */
export function lighten(hex: string, amount: number): string {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    return `rgb(${mixChannel(rgb[0], 255, amount)}, ${mixChannel(rgb[1], 255, amount)}, ${mixChannel(rgb[2], 255, amount)})`;
}

/** Mix a hex color toward black by `amount` (0–1); the input when unparseable. */
export function darken(hex: string, amount: number): string {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    return `rgb(${mixChannel(rgb[0], 0, amount)}, ${mixChannel(rgb[1], 0, amount)}, ${mixChannel(rgb[2], 0, amount)})`;
}
