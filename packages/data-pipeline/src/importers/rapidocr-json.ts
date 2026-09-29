/**
 * Reader for the OCR the pipeline produces itself (issue #85): the JSON
 * that ocr/rapidocr_pages.py writes from a scan's checksum-accepted JP2
 * bundle. It yields the same OcrPage shape as the Archive's djvu XML, so
 * nothing downstream (parser, corrections, locators, oracle) knows which
 * engine read the page.
 *
 * The recogniser gives each detected line its text and its characters
 * with horizontal spans; the spans are the recogniser's own estimate and
 * run nearly evenly across the line, so words are cut where it wrote a
 * space, where a span gap shows a space it dropped, and at the printed
 * column's edges, where a margin citation set close to the text is
 * detected as part of its line ("The FatherAug. De"). Everything is scaled
 * to the scan's own pixels, so the parser's geometry (column edges, lemma
 * indent, type height) means the same for every scan. Lines that share a
 * vertical band (a margin note beside its line) are joined into one line,
 * left to right, and the page reader's column classification tells the
 * margin apart as it does for djvu.
 */

import { classifyColumns, type OcrPage, type OcrLine, type OcrWord } from './djvu-xml.js';

export const RAPIDOCR_FORMAT = 'rapidocr-pages/2';

/** A recognised character and its horizontal span in rendered pixels; a space is a span at its position. */
export type RapidOcrChar = [string, number, number];
/** `pass` names the recovery pass that found a line the page pass dropped ("gap:native-low"); absent for the page pass. */
export type RapidOcrLine = { x1: number; y1: number; x2: number; y2: number; score: number; text: string; chars: RapidOcrChar[]; pass?: string };
export type RapidOcrPage = { leaf: number; width: number; height: number; rendered_width: number; rendered_height: number; lines: RapidOcrLine[] };
export type RapidOcrDocument = {
    format: string;
    item: string;
    /** The JP2 bundle the pages were rendered from, and its checksum. */
    source: { file: string; sha256: string };
    engine: Record<string, string>;
    models: Record<string, string>;
    config: Record<string, unknown>;
    pages: RapidOcrPage[];
};

/** Why a document cannot be read for `item` against the accepted bundle checksum, or null. */
export function rapidOcrProblem(doc: RapidOcrDocument, item: string, acceptedSha256: string | undefined): string | null {
    if (doc.format !== RAPIDOCR_FORMAT) return `format ${doc.format}, expected ${RAPIDOCR_FORMAT}`;
    if (doc.item !== item) return `document is for ${doc.item}, not ${item}`;
    if (!acceptedSha256) return `no accepted checksum for the ${item} bundle`;
    if (doc.source.sha256 !== acceptedSha256) return `generated from bundle ${doc.source.sha256.slice(0, 12)}, but the accepted bundle is ${acceptedSha256.slice(0, 12)}: run ocr:catena`;
    if (!Array.isArray(doc.pages) || doc.pages.length === 0) return 'no pages';
    return null;
}

// A gap this many character widths wide is a space the recogniser dropped; its spans are nearly uniform, so
// only a real blank shows as one. Letter-spaced small capitals are never cut. After punctuation the print's
// space is narrower and a dropped one commoner ("RABAN.Yet").
const GAP = 1.2;
const GAP_AFTER_PUNCTUATION = 0.5;
const PUNCTUATION = /[.,;:!?]/;
const UPPER = /^[A-Z]$/;

type Span = { text: string; x1: number; x2: number; chars: RapidOcrChar[]; margin?: boolean };

// The recogniser's models are Chinese-first and sometimes give full-width punctuation ("AMBROSE；Our")
const FULL_WIDTH: Record<string, string> = { '；': ';', '，': ',', '．': '.', '：': ':', '！': '!', '？': '?', '（': '(', '）': ')', '\u3000': ' ', '~': '' };
const narrow = (c: string): string => FULL_WIDTH[c] ?? c;

/**
 * Words the edition uses, counted from pages read by the other engine (the
 * Archive's OCR of the first-batch scans), for restoring the spaces this
 * recogniser drops inside a line ("receiveit", "andrequiringofthem"): a
 * word the edition never uses that is two or three words it does use is
 * cut there. The vocabulary comes from checksum-accepted inputs, so the
 * result is as reproducible as the rest.
 */
export type Vocabulary = Map<string, number>;

const bare = (w: string) => w.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');

export function vocabularyOf(pages: OcrPage[]): Vocabulary {
    const v: Vocabulary = new Map();
    for (const p of pages) for (const l of p.lines) for (const w of l.words) {
        const k = bare(w.text);
        if (k.length >= 2) v.set(k, (v.get(k) ?? 0) + 1);
    }
    return v;
}

const KNOWN = 5;
const MIN_PART = 2;
// Pieces the OCR of the other engine makes frequent (hyphenation fragments, inflections) but that are no word
// on their own: never a part, or "householder" comes out as "household er"
const AFFIXES = new Set(['er', 'ers', 'ing', 'ings', 'eth', 'ed', 'ness', 'ly', 'en', 'ty', 'es', 'est', 'ous', 'ment', 'ments', 'dis', 'un', 're', 'im', 'ab', 'ad', 'pro', 'de', 'ir', 'al', 'st', 'ch', 'con', 'ate', 'ful', 'fully', 'less', 'ic', 'ish', 'ism', 'ist', 'ise', 'ize', 'ent', 'ant', 'ance', 'ence', 'tion', 'sion', 'ity', 'ties', 'ive', 'ure', 'ard', 'ter', 'ter', 'ary', 'ory', 'ial', 'ual', 'ible', 'able', 'fed', 'red', 'ned', 'ted', 'sed', 'led', 'ded', 'ged', 'ked', 'ped', 'ved', 'zed', 'ies', 'ens', 'ess', 'ss', 'th', 'ns', 'll', 'nd', 'rd']);
const TWO_LETTER_WORDS = new Set(['it', 'of', 'to', 'he', 'we', 'be', 'is', 'in', 'at', 'on', 'or', 'an', 'as', 'by', 'no', 'so', 'if', 'up', 'do', 'go', 'me', 'my', 'us', 'am', 'ye', 'lo']);

function withinOneEdit(a: string, b: string): boolean {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { i++; j++; continue; }
        if (++edits > 1) return false;
        if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Indices at which to cut `word` into two or three vocabulary words, or null when it is one the edition uses or cannot be cut. */
export function dictionaryCuts(word: string, vocab: Vocabulary): number[] | null {
    const k = bare(word);
    if (k.length < 4 || (vocab.get(k) ?? 0) >= 1) return null;
    // Below six letters only two very common short words run together ("itis", "ofit")
    if (k.length < 6 && !(TWO_LETTER_WORDS.has(k.slice(0, 2)) && TWO_LETTER_WORDS.has(k.slice(2)) && (vocab.get(k.slice(0, 2)) ?? 0) >= 50 && (vocab.get(k.slice(2)) ?? 0) >= 50)) return null;
    // Only letters cut: the bare key must be the word itself, so an index in one is an index in the other
    if (k !== word.toLowerCase()) return null;
    // A word one glyph away from one the edition uses is that word misread, not two words
    for (const [v, n] of vocab) if (n >= KNOWN && withinOneEdit(k, v)) return null;
    const known = (s: string, atLeast: number) => (vocab.get(s) ?? 0) >= atLeast && !AFFIXES.has(s) && (s.length >= 3 || TWO_LETTER_WORDS.has(s));
    let best: { cuts: number[]; score: number } | null = null;
    for (let i = MIN_PART; i <= k.length - MIN_PART; i++) {
        const a = k.slice(0, i), rest = k.slice(i);
        if (!known(a, KNOWN)) continue;
        if (known(rest, KNOWN)) { const score = Math.min(vocab.get(a)!, vocab.get(rest)!); if (!best || score > best.score) best = { cuts: [i], score }; }
        // Three words need more evidence: each common, and none a two-letter word
        for (let j = i + 3; j <= k.length - 3; j++) {
            const b = k.slice(i, j), c = k.slice(j);
            if (a.length >= 3 && known(a, 3 * KNOWN) && known(b, 3 * KNOWN) && known(c, 3 * KNOWN)) { const score = Math.min(vocab.get(a)!, vocab.get(b)!, vocab.get(c)!) / 2; if (!best || score > best.score) best = { cuts: [i, j], score }; }
        }
    }
    return best?.cuts ?? null;
}

function cutByDictionary(w: Span, vocab: Vocabulary): Span[] {
    const cuts = dictionaryCuts(w.text, vocab);
    if (!cuts) return [w];
    const parts: Span[] = [];
    let from = 0;
    for (const to of [...cuts, w.chars.length]) {
        const cs = w.chars.slice(from, to);
        parts.push({ text: cs.map(([c]) => c).join(''), x1: Math.min(...cs.map(([, x1]) => x1)), x2: Math.max(...cs.map(([, , x2]) => x2)), chars: cs });
        from = to;
    }
    return parts;
}

/** Words of a line from its characters: cut at spaces and at gaps that are spaces the recogniser dropped. */
export function wordsOfLine(chars: RapidOcrChar[]): Span[] {
    const widths = chars.filter(([c, x1, x2]) => c !== ' ' && x2 > x1).map(([, x1, x2]) => x2 - x1).sort((a, b) => a - b);
    const median = widths.length ? widths[Math.floor(widths.length / 2)] : 0;
    const words: Span[] = [];
    let cur: Span | null = null;
    let prevX2: number | null = null;
    for (const ch of chars) {
        const [c, x1, x2] = ch;
        if (c === ' ' || c === '\u3000') { if (cur) words.push(cur); cur = null; prevX2 = x2; continue; }
        if (cur && prevX2 !== null) {
            const gap = (x1 - prevX2) / (median || 1);
            const last = cur.text[cur.text.length - 1];
            const cut = PUNCTUATION.test(last) ? gap > GAP_AFTER_PUNCTUATION : gap > GAP && !(UPPER.test(last) && UPPER.test(c));
            if (cut) { words.push(cur); cur = null; }
        }
        if (!cur) cur = { text: narrow(c), x1, x2, chars: [ch] };
        else { cur.text += narrow(c); cur.x1 = Math.min(cur.x1, x1); cur.x2 = Math.max(cur.x2, x2); cur.chars.push(ch); }
        prevX2 = x2;
    }
    if (cur) words.push(cur);
    return words.filter((w) => w.text.trim());
}

/** Lines whose vertical centres fall inside one another are one printed line. */
function joinLines(lines: RapidOcrLine[]): RapidOcrLine[][] {
    const sorted = [...lines].sort((a, b) => (a.y1 + a.y2) / 2 - (b.y1 + b.y2) / 2);
    const groups: RapidOcrLine[][] = [];
    for (const l of sorted) {
        const c = (l.y1 + l.y2) / 2;
        const g = groups.find((g) => g.some((x) => { const cx = (x.y1 + x.y2) / 2; return (c >= x.y1 && c <= x.y2) || (cx >= l.y1 && cx <= l.y2); }));
        if (g) g.push(l); else groups.push([l]);
    }
    return groups;
}

/**
 * A word straddling a column edge is a margin note the detector joined to its line: cut it where the edge
 * falls, by character centres, when at least two characters lie beyond it (the edge is a bucketed estimate,
 * so one character is noise).
 */
function cutAtEdges(w: Span, left: number, right: number): Span[] {
    const centre = ([, x1, x2]: RapidOcrChar) => (x1 + x2) / 2;
    let before = w.chars.filter((c) => centre(c) < left);
    let after = w.chars.filter((c) => centre(c) > right);
    if (before.length < 2) before = [];
    if (after.length < 2) after = [];
    if (!before.length && !after.length) return [w];
    const inside = w.chars.filter((c) => !before.includes(c) && !after.includes(c));
    const span = (cs: RapidOcrChar[], margin: boolean): Span | null => cs.length ? { text: cs.map(([c]) => c).join(''), x1: Math.min(...cs.map(([, x1]) => x1)), x2: Math.max(...cs.map(([, , x2]) => x2)), chars: cs, margin } : null;
    return [span(before, true), span(inside, false), span(after, true)].filter((s): s is Span => !!s && !!s.text.trim());
}

function toPage(p: RapidOcrPage, split: (w: Span) => Span[]): OcrPage {
    const s = p.width / p.rendered_width;
    const lines: OcrLine[] = [];
    for (const group of joinLines(p.lines)) {
        const words: OcrWord[] = group
            .flatMap((l) => wordsOfLine(l.chars).flatMap(split).map((w) => ({ ...w, y1: l.y1, y2: l.y2 })))
            .map((w) => ({ text: w.text.trim(), x1: Math.round(w.x1 * s), x2: Math.round(w.x2 * s), y1: Math.round(w.y1 * s), y2: Math.round(w.y2 * s), margin: false, ...(w.margin ? { forcedMargin: true } : {}) }))
            .sort((a, b) => a.x1 - b.x1);
        if (words.length) lines.push({ words });
    }
    return { leaf: p.leaf, width: p.width, height: p.height, lines };
}

export function parseRapidOcrPages(doc: RapidOcrDocument, vocab?: Vocabulary): OcrPage[] {
    return doc.pages.map((p) => {
        // First the words as the recogniser cut them, which fixes the column; then cut again at its edges,
        // and where the edition's vocabulary shows a dropped space
        const provisional = toPage(p, (w) => [w]);
        const { left, right } = classifyColumns(provisional);
        const s = p.width / p.rendered_width;
        return toPage(p, (w) => cutAtEdges(w, left / s, right / s).flatMap((x) => (vocab && !x.margin ? cutByDictionary(x, vocab) : [x])));
    });
}
