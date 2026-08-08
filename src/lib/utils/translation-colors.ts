/**
 * Stable per-translation identity colors for comparison surfaces
 * (Divergence Map cards, divergence popover). Keyed so a translation
 * keeps its color across sessions; unknown ids hash into the palette.
 */
const COLUMN_COLORS: Record<string, string> = {
    KJV: '#d4a054',
    ASV: '#60a5fa',
    WEB: '#34d399',
    DBY: '#a78bfa',
    BSB: '#f472b6',
    OEB: '#2dd4bf',
};

const PALETTE = Object.values(COLUMN_COLORS);

export function translationColor(id: string): string {
    if (COLUMN_COLORS[id]) return COLUMN_COLORS[id];
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return PALETTE[h % PALETTE.length];
}
