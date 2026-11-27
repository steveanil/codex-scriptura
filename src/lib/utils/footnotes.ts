/**
 * Reader footnotes (issue #39): the callout letters and the open-row state
 * one reader pane keeps. The callouts themselves are drawn by
 * renderVerseHtml; the row is VerseNotes.svelte.
 */

import type { VerseNote } from '@codex-scriptura/core';

/** Callout letter for the i-th note of a verse: a..z, then aa, ab, ... */
export function footnoteLetter(index: number): string {
    let n = index;
    let letters = '';
    do {
        letters = String.fromCharCode(97 + (n % 26)) + letters;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return letters;
}

/**
 * The lead-in a note reads with in the notes row: a cross-reference note
 * ("Isaiah 7:14") reads "See Isaiah 7:14", unless its own text already
 * starts that way (WEB has a few "see ..." and "compare ..." ones).
 */
export function noteLeadIn(note: VerseNote): string {
    if (note.kind !== 'xref') return '';
    const first = note.runs[0];
    const text = typeof first === 'string' ? first : first?.t ?? '';
    return /^(see|compare|cf\.?)\b/i.test(text.trim()) ? '' : 'See ';
}

/** The note row open in a pane: which verse, and which of its notes was clicked. */
export type OpenFootnote = { osisId: string; index: number };

/** The note index of the callout an event came from, or null when it did not come from one. */
export function calloutIndex(target: EventTarget | null): number | null {
    if (!(target instanceof Element)) return null;
    const callout = target.closest('.fn-call[data-note]');
    if (!callout) return null;
    const index = Number(callout.getAttribute('data-note'));
    return Number.isInteger(index) && index >= 0 ? index : null;
}

/** Clicking the open callout again closes the row; any other callout opens (or retargets) it. */
export function toggleFootnote(open: OpenFootnote | null, osisId: string, index: number): OpenFootnote | null {
    return open && open.osisId === osisId && open.index === index ? null : { osisId, index };
}

/**
 * Keyboard on a verse: Enter or Space on a callout toggles it like a click,
 * Escape closes this verse's open row. Returns the new open state, or
 * undefined when the key is not ours (the event is left alone).
 */
export function footnoteKeydown(e: KeyboardEvent, open: OpenFootnote | null, osisId: string): OpenFootnote | null | undefined {
    if (e.key === 'Escape') {
        if (open?.osisId !== osisId) return undefined;
        e.preventDefault();
        return null;
    }
    if (e.key !== 'Enter' && e.key !== ' ') return undefined;
    const index = calloutIndex(e.target);
    if (index === null) return undefined;
    e.preventDefault();
    return toggleFootnote(open, osisId, index);
}

/** Put focus back on the callout a row was opened from (after Escape inside the row). */
export function focusCallout(root: ParentNode | undefined, open: OpenFootnote): void {
    root?.querySelector<HTMLElement>(`.verse[data-osis="${CSS.escape(open.osisId)}"] .fn-call[data-note="${open.index}"]`)?.focus();
}
