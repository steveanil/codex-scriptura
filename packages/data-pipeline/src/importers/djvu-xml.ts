/**
 * Page-structured OCR from an Internet Archive scan (`*_djvu.xml`,
 * issue #85). Each page keeps its leaf index, so anything read from it can
 * be traced back to the exact scanned page, and each word keeps its
 * coordinates, so the printed margin (citations, verse markers) can be
 * told apart from the running text by column rather than guessed from
 * the words themselves.
 */

export type OcrWord = {
    text: string; x1: number; x2: number; y1: number; y2: number; margin: boolean;
    /** Set by a reader that already knows the word is margin text (a fragment it cut off at the column's edge). */
    forcedMargin?: boolean;
};
export type OcrLine = { words: OcrWord[] };
export type OcrPage = {
    /** 0-based leaf index in the scan, the archive's `/page/nN`. */
    leaf: number;
    width: number;
    height: number;
    lines: OcrLine[];
};

const OBJECT = /<OBJECT[^>]*width="(\d+)" height="(\d+)">([\s\S]*?)<\/OBJECT>/g;
const LINE = /<LINE>([\s\S]*?)<\/LINE>/g;
const WORD = /<WORD coords="(\d+),(\d+),(\d+),(\d+)(?:,\d+)?"[^>]*>([\s\S]*?)<\/WORD>/g;
const LEAF = /_(\d{4})\.djvu/;

function unescape(s: string): string {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

export function parseDjvuPages(xml: string): OcrPage[] {
    const pages: OcrPage[] = [];
    for (const obj of xml.matchAll(OBJECT)) {
        const body = obj[3];
        const leafMatch = LEAF.exec(body);
        if (!leafMatch) continue;
        const lines: OcrLine[] = [];
        for (const ln of body.matchAll(LINE)) {
            const words: OcrWord[] = [];
            for (const wd of ln[1].matchAll(WORD)) {
                const text = unescape(wd[5]).trim();
                if (!text) continue;
                // djvu coords are xmin, ymax (bottom), xmax, ymin (top)
                words.push({ text, x1: Number(wd[1]), y2: Number(wd[2]), x2: Number(wd[3]), y1: Number(wd[4]), margin: false });
            }
            if (words.length) lines.push({ words });
        }
        pages.push({ leaf: Number(leafMatch[1]) - 1, width: Number(obj[1]), height: Number(obj[2]), lines });
    }
    return pages;
}

const BUCKET = 20;

/** Most frequent value; `prefer` breaks ties (the smaller start for the left edge, the larger end for the right). */
function mode(values: number[], prefer: 'low' | 'high'): number {
    const counts = new Map<number, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || (prefer === 'low' ? a[0] - b[0] : b[0] - a[0]))[0][0];
}

/**
 * Mark words that sit in the printed margin. The running text is justified,
 * so most lines start and end on the same two edges; a word that starts
 * beyond the right edge or ends before the left one is margin text (the
 * 1841 Catena prints citations and "Ver. N" markers in the outer margin).
 * A word the OCR merged across the edge stays running text; the oracle
 * comparison catches those. Returns the edges for the caller's tests.
 */
export function classifyColumns(page: OcrPage): { left: number; right: number } {
    if (page.lines.length === 0) return { left: 0, right: page.width };
    // Only lines that reach a typical width vote for the edges, so short last lines and margin notes do not
    const widths = page.lines.map((l) => l.words[l.words.length - 1].x2 - l.words[0].x1);
    const typical = [...widths].sort((a, b) => a - b)[Math.floor(widths.length / 2)];
    const full = page.lines.filter((_, i) => widths[i] >= typical * 0.8);
    const voters = full.length >= 3 ? full : page.lines;
    // Two passes. First the edges by mode, which marks the margin notes; then the left edge again from the
    // running-text starts only, as the lowest start a real share of full-width lines have in common: not the
    // mode, which on a chapter-opening page of mostly indented lemma lines sits at the lemma indent, and
    // not the minimum, which one word the OCR glued to a line's start would set.
    const right = mode(voters.map((l) => Math.round(l.words[l.words.length - 1].x2 / BUCKET) * BUCKET), 'high');
    const slack = BUCKET / 2;
    let left = mode(voters.map((l) => Math.round(l.words[0].x1 / BUCKET) * BUCKET), 'low');
    // A tiny word starting well left of the column is a margin fragment the OCR glued to the line ("s," of "Mal. 3, 1."
    // before "2. As it is written"), whatever width its box was given
    // Fragments are judged only against the settled edge: on a chapter-opening page the first pass's edge
    // can sit at the lemma indent, which would make every verse number a fragment
    const mark = (fragments: boolean) => {
        for (const line of page.lines) for (const w of line.words) {
            const fragment = fragments && w.x1 < left - 2 * slack && w.text.replace(/[^A-Za-z0-9]/g, '').length <= 2;
            w.margin = !!w.forcedMargin || w.x1 > right + slack || w.x2 < left - slack || fragment;
        }
    };
    mark(false);
    // A skewed page drifts the starts over a few buckets, so the share is counted in a window around each
    // start rather than per bucket; the lowest start with a real share around it is the edge
    const starts = voters.map((l) => l.words.find((w) => !w.margin)).filter((w): w is OcrWord => !!w).map((w) => w.x1).sort((a, b) => a - b);
    const needed = Math.max(2, starts.length * 0.25);
    for (const s of starts) {
        if (starts.filter((x) => Math.abs(x - s) <= 2 * BUCKET).length >= needed) { left = s; break; }
    }
    mark(true);
    return { left, right };
}

/** Type size of a scan as a whole: the body's line height and advance per character. */
export type ScanMetrics = { height: number; charWidth: number };

// Height over real words: a stray one-letter fragment the OCR glued to a line must not make it "large type"
const lineHeight = (l: OcrLine): number => {
    const real = l.words.filter((w) => w.text.replace(/[^A-Za-z]/g, '').length >= 3);
    return median((real.length ? real : l.words).map((w) => w.y2 - w.y1));
};

// Advance per character over words of three or more characters; 0 when the line has none
const lineCharWidth = (l: OcrLine): number => {
    const real = l.words.filter((w) => w.text.length >= 3);
    const chars = real.reduce((a, w) => a + w.text.length, 0);
    return chars ? real.reduce((a, w) => a + (w.x2 - w.x1), 0) / chars : 0;
};

/**
 * The body type of a whole scan, from its full pages. A single page can
 * mislead: one carrying a long footnote has the footnote's height as its
 * median, one opening a chapter has the lemma's width.
 */
export function scanMetrics(pages: OcrPage[]): ScanMetrics {
    const lines = pages.filter((p) => p.lines.length >= 12).flatMap((p) => p.lines);
    const heights = lines.map(lineHeight);
    const height = median(heights);
    const charWidth = median(lines.map(lineCharWidth).filter((w, i) => w > 0 && heights[i] >= height * 0.9 && heights[i] <= height * 1.1));
    return { height, charWidth };
}

export type PageLine = {
    main: string;
    margin: string;
    y: number;
    /** Average advance per character over the line's words of three or more characters; 0 when there are none. */
    charWidth: number;
    /** Median word height on the line, in scan pixels. */
    height: number;
    /** How far the line's first running-text word starts right of the column edge, in scan pixels. */
    indent: number;
};

// The head's words may reach us run together ("GOSPELACCORDINGTO"), so the spaces are optional
const RUNNING_HEAD = /GOSPEL\s*ACCORDING|ACCORDING\s*TO|ST\.\s*(?:MATTHEW|MARK|LUKE|JOHN)|^VER\.|^\d{1,3}\s+[A-Z]|CHAP\.\s*[IVXLC]+\.?\s+\d{1,3}$/;
// "A 2", "A a 2", or the OCR's reversed "2 A", "2 A2"
const SIGNATURE = /^[A-Z]\s?[a-z]?\s?\d?$|^\d\s?[A-Z]\s?\d?$|^\d{1,2}$|^VOL\.\s*[IVX1l]+\.(?:\s*(?:PART\s*[IVX1l]+\.?|[A-Z]\s?\d?))?$/;

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * A page as running-text lines with their margin text, minus the running
 * head (returned separately with the printed page number it carries,
 * when the OCR read one) and any printer's signature mark at the foot.
 * The head is recognised by its wording ("GOSPEL ACCORDING TO", "ST.
 * MATTHEW", "VER. 7 10.", a page number beside "CHAP. N."); the OCR
 * sometimes splits it over two lines, so a second line that also looks
 * like a head goes with it. A chapter heading inside the text ("CHAP.
 * III." alone, no page number) is never a head.
 */
export function pageLines(page: OcrPage, scan?: ScanMetrics): { lines: PageLine[]; footnotes: PageLine[]; printedPage?: string } {
    const { left } = classifyColumns(page);
    const heights = page.lines.map(lineHeight);
    const charWidths = page.lines.map(lineCharWidth);
    // The page's own median stands where it agrees with the scan's; a page that is half footnote does not
    const pageBody = median(heights);
    const body = scan && Math.abs(pageBody - scan.height) > scan.height * 0.1 ? scan.height : pageBody;
    // Footnote type is narrower than the body's even where the OCR gives its word boxes nearly the body's height
    const bodyWidth = scan?.charWidth ?? median(charWidths.filter((w, i) => w > 0 && heights[i] >= body * 0.9 && heights[i] <= body * 1.1));
    let lines: PageLine[] = page.lines.map((l, i) => {
        const main = l.words.filter((w) => !w.margin);
        return {
            main: main.map((w) => w.text).join(' '),
            margin: l.words.filter((w) => w.margin).map((w) => w.text).join(' '),
            y: l.words[0].y1,
            height: heights[i],
            charWidth: charWidths[i],
            // A stray mark the OCR put before the first word ("- 12. And it came") does not set the indent
            indent: main.length ? (main.find((w) => /[A-Za-z0-9]/.test(w.text)) ?? main[0]).x1 - left : 0,
        };
    });
    let printedPage: string | undefined;
    let headLines = 0;
    // The head is within the first three lines: the OCR sometimes puts a stray margin fragment
    // ("tom.xm.") above it, and sometimes splits the head itself over two lines
    for (let i = 0; i < Math.min(3, page.lines.length); i++) {
        const all = page.lines[i].words.map((w) => w.text).join(' ');
        const small = heights[i] < body * 0.9;
        if (all.length < 60 && RUNNING_HEAD.test(all)) {
            headLines = i + 1;
            printedPage ??= (/^(\d{1,3})\s/.exec(all) ?? /\s(\d{1,3})\.?$/.exec(all))?.[1];
        } else if (small && page.lines[i].words.length <= 3 && headLines === i && !/^CHAP\.\s+[IVXLC]+\.?$/.test(all)) {
            headLines = i + 1;
        } else {
            break;
        }
    }
    lines = lines.slice(headLines);
    const last = lines[lines.length - 1];
    // The volume mark is unmistakable in any type; a lone letter or number only in the small type of a signature
    if (last && SIGNATURE.test(last.main.trim()) && (/^VOL/.test(last.main.trim()) || last.height < body * 0.95)) lines = lines.slice(0, -1);
    // Editorial footnotes at the foot of the page are set in smaller type; they are not part of the chain.
    // Only a full page can be judged this way: on a few lines the median height is not the body's.
    const footnotes: PageLine[] = [];
    if (page.lines.length >= 12) {
        // A line of a few words gives no reliable width: it is a footnote when a line above it is
        const realWords = (l: PageLine) => l.main.split(' ').filter((w) => w.replace(/[^A-Za-z]/g, '').length >= 3).length;
        // Footnote type is narrower as well as shorter; a lemma line, taller in the print but boxed short by an
        // engine that pads its boxes unevenly, is wider than the body and never trimmed
        const narrower = (l: PageLine, by: number) => l.charWidth === 0 || l.charWidth < bodyWidth * by;
        const footnote = (l: PageLine) => (l.height < body * 0.85 && narrower(l, 0.95)) || (realWords(l) >= 4 && l.charWidth < bodyWidth * 0.85 && l.height < body * 0.97);
        // A full line in clearly smaller type among the last eight is a footnote whatever lies below it (a line of
        // Hebrew or Greek the OCR boxed tall must not shield the note above it); the walk continues from there
        let cut = lines.length;
        for (let i = lines.length - 1; i >= Math.max(1, lines.length - 8); i--) if (lines[i].height < body * 0.85 && realWords(lines[i]) >= 4 && narrower(lines[i], 0.9)) cut = i;
        for (let i = cut - 1; i > 0; i--) {
            if (footnote(lines[i])) cut = i;
            // Undecided on its own: a line of a few words, or a narrow one the OCR boxed tall
            else if ((realWords(lines[i]) < 4 && lines[i].height < body * 0.97) || (lines[i].charWidth > 0 && lines[i].charWidth < bodyWidth * 0.85 && lines[i].height < body * 1.03)) continue;
            else break;
        }
        footnotes.push(...lines.splice(cut));
    }
    return { lines, footnotes, ...(printedPage ? { printedPage } : {}) };
}
