/**
 * Match highlighting for search result cards. The cards render through
 * {@html}, so verse text must be HTML-escaped: matches run against the
 * ORIGINAL text (escaping first would let query words match inside
 * entities like &amp;), then each segment is escaped as the marked-up
 * string is assembled.
 */

import { escapeHtml } from '@codex-scriptura/core';
import { STOP_WORDS } from './config';

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Wrap every match of the pattern in <mark>, escaping everything. */
export function markMatches(text: string, pattern: RegExp): string {
    let out = '';
    let last = 0;
    for (const m of text.matchAll(pattern)) {
        const idx = m.index ?? 0;
        out += escapeHtml(text.slice(last, idx)) + `<mark>${escapeHtml(m[0])}</mark>`;
        last = idx + m[0].length;
    }
    return out + escapeHtml(text.slice(last));
}

/** Full Text: the whole phrase when the verse holds it, else each non-stop query word. */
export function highlightQuery(text: string, query: string): string {
    const q = query.trim();
    if (!q) return escapeHtml(text);
    if (text.toLowerCase().includes(q.toLowerCase())) {
        return markMatches(text, new RegExp(escapeRegExp(q), 'gi'));
    }
    const words = q.split(/\s+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w.toLowerCase()));
    if (words.length === 0) return escapeHtml(text);
    return markMatches(text, new RegExp(words.map(escapeRegExp).join('|'), 'gi'));
}

/** Word Study: the surface forms the engine counted, as whole words. */
export function highlightSurfaces(text: string, surfaces: string[]): string {
    if (surfaces.length === 0) return escapeHtml(text);
    return markMatches(text, new RegExp(`\\b(${surfaces.map(escapeRegExp).join('|')})\\b`, 'gi'));
}
