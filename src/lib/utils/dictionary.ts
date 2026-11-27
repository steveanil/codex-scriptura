import { resolveBook } from '@codex-scriptura/core';

// ─── Dictionary definition parsing ─────────────────────────
// Easton's entries arrive as paragraphs of dense prose: "A name applied (1) to …
// (Gen. 2:2). (2) to …" with abbreviated scripture refs. These helpers
// split paragraphs and numbered senses into separate blocks and tokenize scripture
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

        // The optional space before a book name can be swallowed ("; John 19:17"); it belongs to the text
        const lead = full.length - full.trimStart().length;
        if (m.index + lead > last) segments.push({ type: 'text', text: text.slice(last, m.index + lead) });
        const chapter = parseInt(chapterStr, 10);
        segments.push({
            type: 'ref',
            label: range ? full.trimStart() : `${bookToken.trimStart()} ${chapter}:${verseStr}`,
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

const PARAGRAPH_BREAK = /\n[ \t]*\n/;

/**
 * The "(1) … (2) …" markers of a paragraph that read as numbered senses:
 * a run counting up from (1), so a chapter number like "(42)" never splits
 * the text. A run where an item ends in a comma ("accused him (1) of
 * sedition, (2) …") is a list inside a sentence and stays inline.
 */
function senseMarkers(paragraph: string): RegExpExecArray[] {
    const run: RegExpExecArray[] = [];
    for (const m of paragraph.matchAll(/\((\d+)\)\s*/g)) {
        if (parseInt(m[1], 10) === run.length + 1) run.push(m as RegExpExecArray);
    }
    if (run.length < 2) return [];
    const inline = run.slice(1).some((m) => paragraph.slice(0, m.index).trimEnd().endsWith(','));
    return inline ? [] : run;
}

/**
 * Split a definition into blocks: each blank-line paragraph of the stored
 * text, with numbered senses inside a paragraph split out further. Leading
 * text before "(1)" stays an un-numbered block. A lone "(1)" is more likely
 * part of prose than an enumeration, so it never splits.
 */
export function parseDefinition(definition: string): DictSense[] {
    const blocks: DictSense[] = [];
    for (const raw of definition.split(PARAGRAPH_BREAK)) {
        const text = raw.replace(/\s+/g, ' ').trim();
        if (!text) continue;

        const markers = senseMarkers(text);
        if (markers.length === 0) {
            blocks.push({ marker: null, segments: linkifyRefs(text) });
            continue;
        }

        const intro = text.slice(0, markers[0].index).trim();
        if (intro) blocks.push({ marker: null, segments: linkifyRefs(intro) });
        for (let i = 0; i < markers.length; i++) {
            const start = markers[i].index + markers[i][0].length;
            const end = i + 1 < markers.length ? markers[i + 1].index : text.length;
            const body = text.slice(start, end).trim();
            if (body) blocks.push({ marker: `(${markers[i][1]})`, segments: linkifyRefs(body) });
        }
    }
    return blocks;
}

// ─── Collapsing long definitions ───────────────────────────

/** [start, end) ranges a cut must not fall inside: parentheses and scripture refs. */
function protectedRanges(text: string): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    let depth = 0;
    let open = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '(') {
            if (depth === 0) open = i;
            depth++;
        } else if (text[i] === ')' && depth > 0) {
            depth--;
            if (depth === 0) ranges.push([open, i + 1]);
        }
    }
    for (const m of text.matchAll(new RegExp(REF_PATTERN))) {
        let end = m.index + m[0].length;
        let cont: RegExpMatchArray | null;
        while ((cont = text.slice(end).match(CONTINUATION)) !== null) end += cont[0].length;
        ranges.push([m.index, end]);
    }
    return ranges;
}

const insideAny = (i: number, ranges: Array<[number, number]>) => ranges.some(([s, e]) => i > s && i < e);

/**
 * Sentence ends: terminal punctuation (plus closing quotes) followed by a
 * capital. Abbreviations like "A.D." or "i.e." are skipped by looking at
 * the word before the stop.
 */
function sentenceEnds(text: string): number[] {
    const ends: number[] = [];
    for (const m of text.matchAll(/[.!?][”’"')]*(?=\s+[“‘"(]?[A-Z])/g)) {
        const word = /(\S+)$/.exec(text.slice(0, m.index))?.[1] ?? '';
        if (word.includes('.') || word.replace(/[^A-Za-z]/g, '').length <= 2) continue;
        ends.push(m.index + m[0].length);
    }
    return ends;
}

/**
 * Shorten a long definition for a collapsed view. Cuts at a paragraph
 * break near the budget, else at the last sentence end within it, else at
 * a word boundary (marked with an ellipsis). Never cuts inside a scripture
 * reference or a parenthesis, so a collapsed text has no half references.
 */
export function truncateDefinition(definition: string, budget: number): { text: string; truncated: boolean } {
    const text = definition.trim();
    if (text.length <= budget) return { text, truncated: false };

    const ranges = protectedRanges(text);
    let cut = -1;

    for (const m of text.matchAll(new RegExp(PARAGRAPH_BREAK, 'g'))) {
        if (m.index > budget * 1.25) break;
        if (m.index >= budget * 0.4) cut = m.index;
    }
    if (cut < 0) {
        const ends = sentenceEnds(text).filter((i) => !insideAny(i, ranges));
        cut = ends.filter((i) => i <= budget && i >= budget * 0.3).at(-1) ?? ends.find((i) => i > budget && i <= budget * 1.5) ?? -1;
    }
    let ellipsis = false;
    if (cut < 0) {
        for (let i = Math.min(budget, text.length - 1); i > 0; i--) {
            if (/\s/.test(text[i]) && !insideAny(i, ranges)) {
                cut = i;
                break;
            }
        }
        ellipsis = cut > 0;
    }

    const head = cut > 0 ? text.slice(0, cut).trimEnd() : '';
    if (!head || head.length >= text.length) return { text, truncated: false };
    return { text: ellipsis ? `${head} …` : head, truncated: true };
}
