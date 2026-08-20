/**
 * Shared verse-rendering logic: red-letter spans, entity/lineage marks,
 * highlight resolution, OSIS labels. Extracted from ReaderPane so the
 * aligned parallel grid renders scripture through the exact same code
 * path - one implementation, never a fork (split-view rebuild, #24).
 */

import type { VerseRecord, Annotation, Person, Place, BibleEvent } from '@codex-scriptura/core';
import { findBook, parseOsisId, escapeHtml, escapeAttr, escapeRegex } from '@codex-scriptura/core';
import { MATCHABLE_NAMES, NAME_TO_ID } from '$lib/data/table-of-nations';

export type EntityRef = { id: string; type: 'person' | 'place' | 'event' | 'lineage'; name: string };
export type Enrichment = { persons: Person[]; places: Place[]; events: BibleEvent[] };

// Escaping now lives in @codex-scriptura/core (issue #174); re-exported so
// existing render-adjacent imports keep working.
export { escapeHtml };

// ─── OSIS labels ──────────────────────────────────────────────

/** Format an OSIS verse ID ("Gen.1.1") into a compact display label ("Gen 1:1") */
export function formatOsisLabel(osisId: string): string {
    const parts = osisId.split('.');
    if (parts.length === 3) {
        const book = findBook(parts[0]);
        return `${book?.abbrev ?? parts[0]} ${parts[1]}:${parts[2]}`;
    }
    if (parts.length === 2) return `${parts[0]} ${parts[1]}`;
    return osisId;
}

// ─── Entity resolution ────────────────────────────────────────

/**
 * Table-of-Nations names present in a Genesis verse become lineage marks -
 * tappable while plainly reading, opening the contextual lineage rail.
 * Case-sensitive so capitalized "Put" (Ham's son) never matches the verb.
 */
const lineageNameRegex = new RegExp(`\\b(${MATCHABLE_NAMES.join('|')})\\b`, 'g');

function getLineageRefsForVerse(verse: VerseRecord, bookId: string): EntityRef[] {
    if (bookId !== 'Gen') return [];
    const found = new Map<string, EntityRef>();
    lineageNameRegex.lastIndex = 0;
    for (let m = lineageNameRegex.exec(verse.text); m !== null; m = lineageNameRegex.exec(verse.text)) {
        const id = NAME_TO_ID.get(m[0].toLowerCase());
        if (id && !found.has(id)) found.set(id, { id, type: 'lineage', name: m[0] });
    }
    return [...found.values()];
}

export function getEntitiesForVerse(verse: VerseRecord, enrichment: Enrichment | null, bookId: string): EntityRef[] {
    const lineage = getLineageRefsForVerse(verse, bookId);
    const lineageNames = new Set(lineage.map(l => l.name.toLowerCase()));
    const result: EntityRef[] = [];
    if (enrichment) {
        const ref = verse.osisId;
        for (const p of enrichment.persons) {
            // Lineage takes precedence over the plain person mark for the same name
            if (p.verseRefs.includes(ref) && !lineageNames.has(p.name.toLowerCase())) {
                result.push({ id: p.id, type: 'person', name: p.name });
            }
        }
        for (const p of enrichment.places) {
            if (p.verseRefs.includes(ref) && !lineageNames.has(p.name.toLowerCase())) {
                result.push({ id: p.id, type: 'place', name: p.name });
            }
        }
        for (const e of enrichment.events) {
            if (e.verseRefs.includes(ref)) result.push({ id: e.id, type: 'event', name: e.name });
        }
    }
    return [...result, ...lineage];
}

// ─── Red letters (words of Jesus) ─────────────────────────────

/** Parse wj JSON and return an array of [start, end] ranges, or empty array. */
export function parseWjRanges(wjJson?: string): number[][] {
    if (!wjJson) return [];
    try {
        const ranges: number[][] = JSON.parse(wjJson);
        return Array.isArray(ranges) ? ranges : [];
    } catch {
        return [];
    }
}

/**
 * Wrap portions of escaped HTML in <span class="wj"> based on character offset
 * ranges from the original plain text. This must be called on segments that are
 * simple escaped text (no nested HTML tags) - i.e. the non-entity pieces.
 *
 * @param escapedHtml  The HTML-escaped string for a plain-text slice
 * @param plainStart   The start offset of this slice in the original plain text
 * @param plainEnd     The end offset of this slice in the original plain text
 * @param wjRanges     Sorted [start, end] ranges marking words of Jesus in the full verse text
 */
function wrapWjInEscapedSegment(escapedHtml: string, plainStart: number, plainEnd: number, wjRanges: number[][]): string {
    // Find which wj ranges overlap with [plainStart, plainEnd)
    const overlapping: number[][] = [];
    for (const [ws, we] of wjRanges) {
        const overlapStart = Math.max(ws, plainStart);
        const overlapEnd = Math.min(we, plainEnd);
        if (overlapStart < overlapEnd) {
            overlapping.push([overlapStart - plainStart, overlapEnd - plainStart]);
        }
    }

    if (overlapping.length === 0) return escapedHtml;

    // Now we need to insert <span class="wj"> at the right positions in the escaped HTML.
    // Build a mapping from plain-text char index (relative) to escaped-HTML char index.
    const plainToEscaped: number[] = [];
    let pi = 0;
    let ei = 0;
    while (ei < escapedHtml.length && pi <= (plainEnd - plainStart)) {
        plainToEscaped[pi] = ei;
        if (escapedHtml.startsWith('&amp;', ei)) { ei += 5; pi++; }
        else if (escapedHtml.startsWith('&lt;', ei)) { ei += 4; pi++; }
        else if (escapedHtml.startsWith('&gt;', ei)) { ei += 4; pi++; }
        else if (escapedHtml.startsWith('&quot;', ei)) { ei += 6; pi++; }
        else { ei++; pi++; }
    }
    plainToEscaped[pi] = ei; // sentinel for end

    let result = '';
    let lastEi = 0;
    for (const [rs, re] of overlapping) {
        const eStart = plainToEscaped[rs] ?? lastEi;
        const eEnd = plainToEscaped[re] ?? escapedHtml.length;
        result += escapedHtml.slice(lastEi, eStart);
        result += `<span class="wj">${escapedHtml.slice(eStart, eEnd)}</span>`;
        lastEi = eEnd;
    }
    result += escapedHtml.slice(lastEi);
    return result;
}

// ─── Verse HTML ───────────────────────────────────────────────

export type RenderVerseOptions = {
    redLetters: boolean;
    /** Lineage entity id currently focused in the rail - gets the lineage-active class. */
    lineageActiveId?: string | null;
};

export function renderVerseHtml(text: string, entities: EntityRef[], wjRanges: number[][] | undefined, opts: RenderVerseOptions): string {
    const applyWj = opts.redLetters && wjRanges && wjRanges.length > 0;

    if (entities.length === 0) {
        const escaped = escapeHtml(text);
        if (applyWj) return wrapWjInEscapedSegment(escaped, 0, text.length, wjRanges);
        return escaped;
    }

    const sorted = [...entities].sort((a, b) => b.name.length - a.name.length);
    const pattern = sorted.map(e => escapeRegex(e.name)).join('|');
    // Word-bounded and case-sensitive, like the lineage regex above: 45 person
    // and 33 place names are 3 chars or fewer, so an unanchored case-blind
    // match marks mid-word fragments (person "On" inside every "son")
    const regex = new RegExp(`\\b(${pattern})\\b`, 'g');
    const nameMap = new Map(sorted.map(e => [e.name.toLowerCase(), e]));
    let result = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        // Non-entity segment before this match
        const segEscaped = escapeHtml(text.slice(lastIndex, match.index));
        if (applyWj) {
            result += wrapWjInEscapedSegment(segEscaped, lastIndex, match.index, wjRanges);
        } else {
            result += segEscaped;
        }

        let entity = nameMap.get(match[0].toLowerCase());
        // Lineage names only count when capitalized exactly ("Put" the son, not "put" the verb)
        if (entity?.type === 'lineage' && match[0] !== entity.name) entity = undefined;
        if (entity) {
            // Entity mark - check if it's inside a wj range
            const matchStart = match.index;
            const matchEnd = match.index + match[0].length;
            const inWj = applyWj && wjRanges.some(([ws, we]) => ws <= matchStart && we >= matchEnd);
            const isLineage = entity.type === 'lineage';
            const isRailFocus = isLineage && entity.id === opts.lineageActiveId;
            const classes = `entity${isLineage ? ' lineage' : ''}${isRailFocus ? ' lineage-active' : ''}${inWj ? ' wj' : ''}`;
            const markHtml = `<mark class="${classes}" data-entity-id="${escapeAttr(entity.id)}" data-entity-type="${escapeAttr(entity.type)}" data-entity-name="${escapeAttr(entity.name)}">${escapeHtml(match[0])}</mark>`;
            result += markHtml;
        } else {
            const escaped = escapeHtml(match[0]);
            if (applyWj) {
                result += wrapWjInEscapedSegment(escaped, match.index, match.index + match[0].length, wjRanges);
            } else {
                result += escaped;
            }
        }
        lastIndex = match.index + match[0].length;
    }
    // Trailing segment
    const tailEscaped = escapeHtml(text.slice(lastIndex));
    if (applyWj) {
        result += wrapWjInEscapedSegment(tailEscaped, lastIndex, text.length, wjRanges);
    } else {
        result += tailEscaped;
    }
    return result;
}

/**
 * renderVerseHtml with divergence shading layered on top: the text is cut
 * at span boundaries (always token edges), each slice runs through the
 * SAME renderer with offset-clipped wj ranges, and divergent slices are
 * wrapped in <span class="dv">. Composition over the shared renderer -
 * never a second implementation of red letters or entity marks.
 */
export function renderVerseHtmlWithDivergence(
    text: string,
    entities: EntityRef[],
    wjRanges: number[][] | undefined,
    opts: RenderVerseOptions,
    divergenceSpans?: [number, number][]
): string {
    if (!divergenceSpans || divergenceSpans.length === 0) {
        return renderVerseHtml(text, entities, wjRanges, opts);
    }
    const clipWj = (start: number, end: number): number[][] =>
        (wjRanges ?? [])
            .map(([a, b]) => [Math.max(a, start) - start, Math.min(b, end) - start])
            .filter(([a, b]) => a < b);
    let html = '';
    let pos = 0;
    const emit = (start: number, end: number, divergent: boolean) => {
        if (start >= end) return;
        const piece = renderVerseHtml(text.slice(start, end), entities, clipWj(start, end), opts);
        // The char offsets ride along so a click on the shaded word can be
        // mapped back to the verse text (divergence popover).
        html += divergent ? `<span class="dv" data-dv-start="${start}" data-dv-end="${end}">${piece}</span>` : piece;
    };
    for (const [s, e] of divergenceSpans) {
        emit(pos, s, false);
        emit(Math.max(pos, s), e, true);
        pos = Math.max(pos, e);
    }
    emit(pos, text.length, false);
    return html;
}

// ─── Annotation resolution ────────────────────────────────────

export function isVerseInAnnotation(ch: number, v: number, ann: Annotation): boolean {
    // parseOsisId rejects malformed and sub-verse refs ("Gen.1.1a" from an
    // external source) outright - previously a NaN fallthrough here matched
    // every verse (issue #189).
    const start = parseOsisId(ann.verseStart);
    const end = parseOsisId(ann.verseEnd);
    if (!start || !end) return false;

    if (ch < start.chapter || ch > end.chapter) return false;
    if (ch === start.chapter && v < start.verse) return false;
    if (ch === end.chapter && v > end.verse) return false;
    return true;
}

/** Most recently modified highlight color covering the verse, or null. */
export function verseHighlightColor(chapter: number, verseNum: number, annotations: Annotation[]): string | null {
    const highlights = annotations.filter(a => a.type === 'highlight' && isVerseInAnnotation(chapter, verseNum, a));
    if (highlights.length === 0) return null;
    highlights.sort((a, b) => b.modified - a.modified);
    return highlights[0].color ?? null;
}
