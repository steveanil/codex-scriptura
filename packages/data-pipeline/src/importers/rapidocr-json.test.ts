import { describe, it, expect } from 'vitest';
import { parseRapidOcrPages, rapidOcrProblem, RAPIDOCR_FORMAT, type RapidOcrDocument } from './rapidocr-json.js';
import { pageLines, scanMetrics } from './djvu-xml.js';

const doc = (pages: RapidOcrDocument['pages'], extra: Partial<RapidOcrDocument> = {}): RapidOcrDocument => ({
    format: RAPIDOCR_FORMAT, item: 'scan', source: { file: 'scan_jp2.zip', sha256: 'abc' }, engine: {}, models: {}, config: {}, pages, ...extra,
});
const line = (x1: number, y1: number, text: string, width = 12): RapidOcrDocument['pages'][number]['lines'][number] => {
    const words = text.split(' ').map((t, i, all) => { const x = x1 + all.slice(0, i).reduce((n, w) => n + (w.length + 1) * width, 0); return { t, x1: x, y1, x2: x + t.length * width, y2: y1 + 20 }; });
    return { x1, y1, x2: words[words.length - 1].x2, y2: y1 + 20, score: 0.9, text, words };
};

describe('RapidOCR page documents (issue #85)', () => {
    it('yields the djvu reader\'s page shape, scaled to the scan\'s pixels, with a margin note joined to its line', () => {
        const pages = parseRapidOcrPages(doc([{ leaf: 12, width: 2000, height: 3000, rendered_width: 1000, rendered_height: 1500, lines: [
            line(150, 100, 'Now a certain man was sick'),
            line(150, 130, 'named Lazarus of Bethany'),
            line(20, 132, 'Aug.'),
        ] }]));
        expect(pages).toHaveLength(1);
        expect(pages[0]).toMatchObject({ leaf: 12, width: 2000, height: 3000 });
        expect(pages[0].lines).toHaveLength(2);
        expect(pages[0].lines[0].words[0]).toEqual({ text: 'Now', x1: 300, x2: 372, y1: 200, y2: 240, margin: false });
        expect(pages[0].lines[1].words.map((w) => w.text)).toEqual(['Aug.', 'named', 'Lazarus', 'of', 'Bethany']);
    });

    it('feeds the page reader like djvu: the margin note ends up in the margin and the indent is measured from the column', () => {
        const body = Array.from({ length: 12 }, (_, i) => line(150, 100 + i * 30, `line ${i} of the running text here`));
        const [p] = parseRapidOcrPages(doc([{ leaf: 1, width: 1000, height: 1500, rendered_width: 1000, rendered_height: 1500, lines: [...body, line(20, 132, 'Aug.'), line(195, 500, '3. And he said')] }]));
        const { lines } = pageLines(p, scanMetrics([p]));
        expect(lines[1].margin).toBe('Aug.');
        expect(lines[1].main).toBe('line 1 of the running text here');
        expect(lines[12].indent).toBe(45);
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
