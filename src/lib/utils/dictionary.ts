import { resolveBook } from '@codex-scriptura/core';

// ─── Dictionary definition parsing ─────────────────────────
// Easton's entries arrive as one dense block: "A name applied (1) to …
// (Gen. 2:2). (2) to …" with abbreviated scripture refs. These helpers
// split the numbered senses into separate blocks and tokenize scripture
// references so the UI can render them as tappable, previewable links.

export type DictSegment =
    | { type: 'text'; text: string }
    | { type: 'ref'; label: string; book: string; chapter: number; verse: number };

export type DictSense = {
    /** Sense marker like "(2)", or null for un-numbered text */
    marker: string | null;
    segments: DictSegment[];
};

// Book token ("Gen.", "1 Cor.", "Ps.") followed by chapter:verse and an
// optional range ("5:3-12"). Chapter-only refs are skipped as too ambiguous.
const REF_PATTERN = /([1-3]?\s?[A-Z][a-z]+\.?)\s?(\d+):(\d+)(\s?[-–]\s?\d+)?/g;

// After a ref, bare verse continuations: "John 3:16, 17" - each ", 17"
// links to the same book and chapter.
const CONTINUATION = /^(,\s?)(\d+)(?![:\d])/;

/** Tokenize plain definition text into text/ref segments. */
export function linkifyRefs(text: string): DictSegment[] {
    const segments: DictSegment[] = [];
    let last = 0;

    REF_PATTERN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REF_PATTERN.exec(text)) !== null) {
        const [full, bookToken, chapterStr, verseStr, range] = m;
        const book = resolveBook(bookToken.replace(/\.$/, ''));
        if (!book) continue; // capitalized word + number that isn't a book

        if (m.index > last) segments.push({ type: 'text', text: text.slice(last, m.index) });
        const chapter = parseInt(chapterStr, 10);
        segments.push({
            type: 'ref',
            label: range ? full : `${bookToken} ${chapter}:${verseStr}`,
            book,
            chapter,
            verse: parseInt(verseStr, 10),
        });
        last = m.index + full.length;

        // Consume ", 17"-style continuations of the same chapter
        let rest = text.slice(last);
        let cont: RegExpMatchArray | null;
        while ((cont = rest.match(CONTINUATION)) !== null) {
            segments.push({ type: 'text', text: cont[1] });
            segments.push({
                type: 'ref',
                label: cont[2],
                book,
                chapter,
                verse: parseInt(cont[2], 10),
            });
            last += cont[0].length;
            rest = text.slice(last);
        }
        REF_PATTERN.lastIndex = last;
    }

    if (last < text.length) segments.push({ type: 'text', text: text.slice(last) });
    return segments;
}

/**
 * Split a definition into numbered senses. "(1) … (2) …" markers become
 * separate senses; leading text before "(1)" becomes an un-numbered sense.
 * Definitions with fewer than two markers stay as a single sense - a lone
 * "(1)" is more likely part of prose than an enumeration.
 */
export function parseDefinition(definition: string): DictSense[] {
    const text = definition.trim();
    if (!text) return [];

    const markers = [...text.matchAll(/\((\d+)\)\s*/g)];
    if (markers.length < 2) {
        return [{ marker: null, segments: linkifyRefs(text) }];
    }

    const senses: DictSense[] = [];
    const intro = text.slice(0, markers[0].index).trim();
    if (intro) senses.push({ marker: null, segments: linkifyRefs(intro) });

    for (let i = 0; i < markers.length; i++) {
        const start = markers[i].index + markers[i][0].length;
        const end = i + 1 < markers.length ? markers[i + 1].index : text.length;
        const body = text.slice(start, end).trim();
        if (body) senses.push({ marker: `(${markers[i][1]})`, segments: linkifyRefs(body) });
    }
    return senses;
}
