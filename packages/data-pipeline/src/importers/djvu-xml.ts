/**
 * Page-structured OCR from an Internet Archive scan (`*_djvu.xml`,
 * issue #85). Each page keeps its leaf index, so anything read from it can
 * be traced back to the exact scanned page, and each word keeps its
 * coordinates, so the printed margin (citations, verse markers) can be
 * told apart from the running text by column rather than guessed from
 * the words themselves.
 */

export type OcrWord = { text: string; x1: number; x2: number; y1: number; y2: number; margin: boolean };
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
    const left = mode(voters.map((l) => Math.round(l.words[0].x1 / BUCKET) * BUCKET), 'low');
    const right = mode(voters.map((l) => Math.round(l.words[l.words.length - 1].x2 / BUCKET) * BUCKET), 'high');
    const slack = BUCKET / 2;
    for (const line of page.lines) {
        for (const w of line.words) w.margin = w.x1 > right + slack || w.x2 < left - slack;
    }
    return { left, right };
}

export type PageLine = {
    main: string;
    margin: string;
    y: number;
    /** Median word height on the line, in scan pixels. */
    height: number;
    /** How far the line's first running-text word starts right of the column edge, in scan pixels. */
    indent: number;
};

const RUNNING_HEAD = /GOSPEL\s+ACCORDING|ST\.\s+(?:MATTHEW|MARK|LUKE|JOHN)|^VER\.|^\d{1,3}\s+[A-Z]|CHAP\.\s+[IVXLC]+\.?\s+\d{1,3}$/;
const SIGNATURE = /^[A-Z]\s?\d?$|^\d{1,2}$|^VOL\.\s+[IVX]+\.(?:\s+[A-Z]\s?\d?)?$/;

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
export function pageLines(page: OcrPage): { lines: PageLine[]; footnotes: PageLine[]; printedPage?: string } {
    const { left } = classifyColumns(page);
    const heights = page.lines.map((l) => median(l.words.map((w) => w.y2 - w.y1)));
    const body = median(heights);
    let lines: PageLine[] = page.lines.map((l, i) => {
        const main = l.words.filter((w) => !w.margin);
        return {
            main: main.map((w) => w.text).join(' '),
            margin: l.words.filter((w) => w.margin).map((w) => w.text).join(' '),
            y: l.words[0].y1,
            height: heights[i],
            indent: main.length ? main[0].x1 - left : 0,
        };
    });
    let printedPage: string | undefined;
    let headLines = 0;
    for (let i = 0; i < Math.min(2, page.lines.length); i++) {
        const all = page.lines[i].words.map((w) => w.text).join(' ');
        if (all.length >= 60 || !RUNNING_HEAD.test(all)) break;
        headLines = i + 1;
        printedPage ??= (/^(\d{1,3})\s/.exec(all) ?? /\s(\d{1,3})\.?$/.exec(all))?.[1];
    }
    lines = lines.slice(headLines);
    const last = lines[lines.length - 1];
    if (last && last.height < body * 0.95 && SIGNATURE.test(last.main.trim())) lines = lines.slice(0, -1);
    // Editorial footnotes at the foot of the page are set in smaller type; they are not part of the chain.
    // Only a full page can be judged this way: on a few lines the median height is not the body's.
    const footnotes: PageLine[] = [];
    if (page.lines.length >= 12) {
        while (lines.length > 1 && lines[lines.length - 1].height < body * 0.85) footnotes.unshift(lines.pop()!);
    }
    return { lines, footnotes, ...(printedPage ? { printedPage } : {}) };
}
