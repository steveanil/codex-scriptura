import { describe, it, expect } from 'vitest';
import { parseRapidOcrPages, rapidOcrProblem, wordsOfLine, RAPIDOCR_FORMAT, type RapidOcrDocument, type RapidOcrChar } from './rapidocr-json.js';
import { pageLines, scanMetrics } from './djvu-xml.js';

const doc = (pages: RapidOcrDocument['pages'], extra: Partial<RapidOcrDocument> = {}): RapidOcrDocument => ({
    format: RAPIDOCR_FORMAT, item: 'scan', source: { file: 'scan_jp2.zip', sha256: 'abc' }, engine: {}, models: {}, config: {}, pages, ...extra,
});
/** Characters spaced `width` apart from x1, as the recogniser lays them out: a space keeps its slot. */
const spans = (x1: number, text: string, width = 12): RapidOcrChar[] => [...text].map((c, i) => [c, x1 + i * width, x1 + (i + 1) * width]);
const line = (x1: number, y1: number, text: string, width = 12): RapidOcrDocument['pages'][number]['lines'][number] => ({ x1, y1, x2: x1 + text.length * width, y2: y1 + 20, score: 0.9, text, chars: spans(x1, text, width) });

describe('RapidOCR page documents (issue #85)', () => {
    it('cuts words at the recogniser\'s spaces and at gaps that are spaces it dropped, never inside small capitals', () => {
        expect(wordsOfLine(spans(0, 'than of Gentiles')).map((w) => w.text)).toEqual(['than', 'of', 'Gentiles']);
        // "Gentiles.Unless": a blank the recogniser left after the full stop
        const dropped: RapidOcrChar[] = [...spans(0, 'Gentiles.'), ...spans(150, 'Unless')];
        expect(wordsOfLine(dropped).map((w) => w.text)).toEqual(['Gentiles.', 'Unless']);
        const wide: RapidOcrChar[] = [...spans(0, 'reaching'), ...spans(120, 'Herod')];
        expect(wordsOfLine(wide).map((w) => w.text)).toEqual(['reaching', 'Herod']);
        // letter-spaced small capitals: J E R O M E with wide gaps stays one token
        const caps: RapidOcrChar[] = [...'JEROME'].map((c, i) => [c, i * 30, i * 30 + 12]);
        expect(wordsOfLine(caps).map((w) => w.text)).toEqual(['JEROME']);
    });

    it('yields the djvu reader\'s page shape, scaled to the scan\'s pixels, with a margin note joined to its line', () => {
        const pages = parseRapidOcrPages(doc([{ leaf: 12, width: 2000, height: 3000, rendered_width: 1000, rendered_height: 1500, lines: [
            ...Array.from({ length: 6 }, (_, i) => line(150, 100 + i * 30, 'Now a certain man was sick of a palsy')),
            line(150, 300, 'named Lazarus of Bethany'),
            line(20, 302, 'Aug.'),
        ] }]));
        expect(pages).toHaveLength(1);
        expect(pages[0]).toMatchObject({ leaf: 12, width: 2000, height: 3000 });
        expect(pages[0].lines).toHaveLength(7);
        expect(pages[0].lines[0].words[0]).toEqual({ text: 'Now', x1: 300, x2: 372, y1: 200, y2: 240, margin: false });
        expect(pages[0].lines[6].words.map((w) => w.text)).toEqual(['Aug.', 'named', 'Lazarus', 'of', 'Bethany']);
    });

    it('cuts a margin citation the detector joined to its line at the column\'s edge', () => {
        const body = Array.from({ length: 12 }, (_, i) => line(150, 100 + i * 30, 'line of the running text'));
        // the margin note begins where the body column ends (24 characters from 150 = 438), as on the page
        const glued = line(126, 500, 'reveal it. AuG. The FatherAug.De');
        const [p] = parseRapidOcrPages(doc([{ leaf: 1, width: 1000, height: 1500, rendered_width: 1000, rendered_height: 1500, lines: [...body, glued] }]));
        const words = p.lines[12].words.map((w) => w.text);
        expect(words).toEqual(['reveal', 'it.', 'AuG.', 'The', 'Father', 'Aug.De']);
        const { lines } = pageLines(p, scanMetrics([p]));
        expect(lines[12].main).toBe('reveal it. AuG. The Father');
        expect(lines[12].margin).toBe('Aug.De');
    });

    it('refuses a document that is not for this item or not from the accepted bundle', () => {
        const d = doc([{ leaf: 1, width: 10, height: 10, rendered_width: 10, rendered_height: 10, lines: [] }]);
        expect(rapidOcrProblem(d, 'scan', 'abc')).toBeNull();
        expect(rapidOcrProblem(d, 'other', 'abc')).toMatch(/for scan, not other/);
        expect(rapidOcrProblem(d, 'scan', 'def')).toMatch(/run ocr:catena/);
        expect(rapidOcrProblem(d, 'scan', undefined)).toMatch(/no accepted checksum/);
        expect(rapidOcrProblem({ ...d, format: 'x' }, 'scan', 'abc')).toMatch(/format x/);
        expect(rapidOcrProblem({ ...d, pages: [] }, 'scan', 'abc')).toBe('no pages');
    });
});
