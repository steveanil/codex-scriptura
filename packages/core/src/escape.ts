/**
 * The one home for string-escaping helpers. Previously triplicated across
 * verse-render.ts, the search page, and the db package with divergent
 * quote handling on an XSS-relevant helper (issue #174).
 */

/** Escape text for interpolation into HTML element content. */
export function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Escape text for interpolation into a double- or single-quoted HTML attribute. */
export function escapeAttr(s: string): string {
    return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Escape text for literal use inside a RegExp source. */
export function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
