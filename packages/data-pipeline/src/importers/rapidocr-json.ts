/**
 * Reader for the OCR the pipeline produces itself (issue #85): the JSON
 * that ocr/rapidocr_pages.py writes from a scan's checksum-accepted JP2
 * bundle. It yields the same OcrPage shape as the Archive's djvu XML, so
 * nothing downstream (parser, corrections, locators, oracle) knows which
 * engine read the page.
 *
 * Words come in the rendered image's pixels and are scaled here to the
 * scan's own, so the parser's geometry (column edges, lemma indent, type
 * height) means the same thing for every scan. Each recognised line is
 * one box; boxes that share a vertical band (a margin note beside its
 * line) are joined into one line, left to right, and the page reader's
 * column classification tells the margin apart as it does for djvu.
 */

import type { OcrPage, OcrLine, OcrWord } from './djvu-xml.js';

export const RAPIDOCR_FORMAT = 'rapidocr-pages/1';

export type RapidOcrWord = { t: string; x1: number; y1: number; x2: number; y2: number };
export type RapidOcrLine = { x1: number; y1: number; x2: number; y2: number; score: number; text: string; words: RapidOcrWord[] };
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

export function parseRapidOcrPages(doc: RapidOcrDocument): OcrPage[] {
    return doc.pages.map((p) => {
        const s = p.width / p.rendered_width;
        const lines: OcrLine[] = [];
        for (const group of joinLines(p.lines)) {
            const words: OcrWord[] = group
                .flatMap((l) => l.words)
                .filter((w) => w.t.trim())
                .map((w) => ({ text: w.t.trim(), x1: Math.round(w.x1 * s), x2: Math.round(w.x2 * s), y1: Math.round(w.y1 * s), y2: Math.round(w.y2 * s), margin: false }))
                .sort((a, b) => a.x1 - b.x1);
            if (words.length) lines.push({ words });
        }
        return { leaf: p.leaf, width: p.width, height: p.height, lines };
    });
}
