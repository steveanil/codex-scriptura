import { describe, it, expect } from 'vitest';
import { parseDjvuPages, classifyColumns, pageLines } from './djvu-xml.js';

/** A page 2000 wide: running text from x=300 to x=1700, a margin note beyond 1750. */
function page(leaf: number, lines: Array<{ words: Array<[string, number, number, number?]>; }>): string {
    const n = String(leaf + 1).padStart(4, '0');
    const body = lines.map((l) => `<LINE>${l.words.map(([t, x1, x2, h]) => `<WORD coords="${x1},${1000 + (h ?? 50)},${x2},1000" x-confidence="90">${t} </WORD>`).join('')}</LINE>`).join('');
    return `<OBJECT data="file://x.djvu" type="image/x.djvu" usemap="item_${n}.djvu" width="2000" height="3000"><PARAM name="PAGE" value="item_${n}.djvu"/><HIDDENTEXT><PAGECOLUMN><REGION><PARAGRAPH>${body}</PARAGRAPH></REGION></PAGECOLUMN></HIDDENTEXT></OBJECT>`;
}
/** A justified line from x=300 to x=1700. */
const full = (t: string, h?: number) => ({ words: t.split(' ').map((w, i, a): [string, number, number, number?] => [w, Math.round(300 + i * (1400 / a.length)), Math.round(300 + (i + 1) * (1400 / a.length)) - 10, h]) });

describe('djvu page XML (issue #85)', () => {
    it('reads pages with their leaf index and word coordinates', () => {
        const pages = parseDjvuPages(page(114, [full('In those days came John')]) + page(115, [full('the Baptist')]));
        expect(pages.map((p) => p.leaf)).toEqual([114, 115]);
        expect(pages[0].lines[0].words.map((w) => w.text)).toEqual(['In', 'those', 'days', 'came', 'John']);
        expect(pages[0].lines[0].words[0]).toMatchObject({ x1: 300, y1: 1000, y2: 1050 });
    });

    it('marks words beyond the justified column as margin and leaves a short last line alone', () => {
        const xml = page(1, [
            full('one two three four five six'),
            full('seven eight nine ten eleven twelve'),
            { words: [['thirteen', 300, 500], ['fourteen', 510, 700]] },
            { words: [['fifteen', 300, 500], ['sixteen', 510, 1690], ['Aug.', 1760, 1850]] },
            { words: [['Ver.', 120, 200], ['seventeen', 300, 1690]] },
        ]);
        const [p] = parseDjvuPages(xml);
        const col = classifyColumns(p);
        expect(col.left).toBe(300);
        expect(p.lines[2].words.every((w) => !w.margin)).toBe(true);
        expect(p.lines[3].words.map((w) => w.margin)).toEqual([false, false, true]);
        expect(p.lines[4].words.map((w) => w.margin)).toEqual([true, false]);
    });

    it('strips the running head, the signature mark and small-type footnotes, keeping the printed page number', () => {
        const bodyLines = Array.from({ length: 9 }, (_, i) => full(`body text line number ${i + 1} of the page`));
        const xml = page(7, [
            full('98 GOSPEL ACCORDING TO CHAP. III.', 36),
            ...bodyLines,
            { words: [['CHAP.', 800, 900], ['IV.', 910, 980]] },
            full('a Arculphus who visited Palestine', 38),
            { words: [['H', 900, 930, 40], ['2', 940, 960, 40]] },
        ]);
        const [p] = parseDjvuPages(xml);
        const { lines, footnotes, printedPage } = pageLines(p);
        expect(printedPage).toBe('98');
        expect(lines.map((l) => l.main)).toEqual([...bodyLines.map((l) => l.words.map((w) => w[0]).join(' ')), 'CHAP. IV.']);
        expect(footnotes.map((l) => l.main)).toEqual(['a Arculphus who visited Palestine']);
    });

    it('takes a two-line head and reads the page number from its end', () => {
        const [p] = parseDjvuPages(page(2, [full('GOSPEL ACCORDING TO', 36), full('ST. MATTHEW. 93', 36), full('body line one two three four')]));
        const { lines, printedPage } = pageLines(p);
        expect(printedPage).toBe('93');
        expect(lines).toHaveLength(1);
    });

    it('reports each line indent from the column edge', () => {
        const [p] = parseDjvuPages(page(3, [full('body line one two three four five'), full('body line six seven eight nine ten'), full('body line eleven twelve thirteen'), { words: [['7.', 390, 420], ['But', 430, 500], ['when', 510, 600]] }]));
        const { lines } = pageLines(p);
        expect(lines[0].indent).toBe(0);
        expect(lines[3].indent).toBe(90);
    });
});
