/**
 * Verse gutter layout (issue #249). One marker per verse that has
 * cross-references or quotations, placed in a gutter outside the scripture
 * column at the verse's first line, so the serif measure carries no inline
 * decoration. Footnotes and provenance stack in the same gutter later.
 */
import type { CrossReference } from '@codex-scriptura/core';

export type VerseBox = {
    verse: number;
    osisId: string;
    /** Top of the verse's first line box, relative to the column. */
    top: number;
    /** Height of that first line box. */
    lineHeight: number;
};

export type GutterMark = {
    verse: number;
    osisId: string;
    /** Marker top, centred on the verse's first line. */
    top: number;
    refs: number;
    quotes: number;
    /** The strongest cross-reference's other end, for the hover preview. */
    topRef: string | null;
};

/** A pair is stored once and filed under both verses; the marker points at whichever end is not this verse. */
export function otherEnd(ref: CrossReference, osisId: string): string {
    return ref.sourceVerse === osisId ? ref.targetVerse : ref.sourceVerse;
}

const MARK_GAP = 2;

/**
 * Markers are centred on their verse's first line. Two verses that start
 * on the same line (prose) would collide, so a marker never sits above the
 * bottom of the one before it: later marks push down, in verse order. A
 * quotation mark stacks under its verse's reference mark.
 */
export function buildGutterMarks(boxes: VerseBox[], xrefs: Map<string, CrossReference[]>, markSize: number): GutterMark[] {
    const marks: GutterMark[] = [];
    let floor = -Infinity;
    for (const b of [...boxes].sort((x, y) => x.verse - y.verse)) {
        const refs = xrefs.get(b.osisId) ?? [];
        if (refs.length === 0) continue;
        const quotes = refs.filter((r) => r.type === 'quotation' && r.sourceVerse === b.osisId).length;
        const centred = Math.round(b.top + (b.lineHeight - markSize) / 2);
        const top = Math.max(centred, floor);
        floor = top + markSize + (quotes > 0 ? markSize + MARK_GAP : 0) + MARK_GAP;
        marks.push({ verse: b.verse, osisId: b.osisId, top, refs: refs.length, quotes, topRef: otherEnd(refs[0], b.osisId) });
    }
    return marks;
}
