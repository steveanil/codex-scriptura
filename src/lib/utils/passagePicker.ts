/**
 * Pure logic for the keyboard-driven passage picker (issue #246).
 */
import { BOOKS, parseReference, type BookMeta } from '@codex-scriptura/core';

/** Books whose name, abbreviation or OSIS id start with the query; all books for an empty query. */
export function filterBooks(query: string, books: readonly BookMeta[] = BOOKS): BookMeta[] {
    const q = query.trim().toLowerCase().replace(/\s+\d+.*$/, '');
    if (!q) return [...books];
    const starts = books.filter(
        (b) => b.name.toLowerCase().startsWith(q) || b.abbrev.toLowerCase().startsWith(q) || b.osisId.toLowerCase().startsWith(q)
    );
    if (starts.length > 0) return starts;
    return books.filter((b) => b.name.toLowerCase().includes(q));
}

export type PickerTarget = { book: string; chapter: number };

/**
 * What Enter should do: a typed reference wins ("Ps 23"); otherwise the
 * highlighted book at chapter 1, or nothing when it is the current book
 * (the picker just closes).
 */
export function enterTarget(query: string, highlighted: string | null, currentBook: string): PickerTarget | null {
    const ref = parseReference(query);
    if (ref) return { book: ref.book, chapter: ref.chapter };
    if (highlighted && highlighted !== currentBook) return { book: highlighted, chapter: 1 };
    return null;
}

/** Move the highlight through the visible list, wrapping at both ends. */
export function stepHighlight(visible: readonly BookMeta[], current: string | null, delta: 1 | -1): string | null {
    if (visible.length === 0) return null;
    const idx = visible.findIndex((b) => b.osisId === current);
    if (idx === -1) return visible[delta === 1 ? 0 : visible.length - 1].osisId;
    return visible[(idx + delta + visible.length) % visible.length].osisId;
}
