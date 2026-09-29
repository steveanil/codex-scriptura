import { describe, it, expect } from 'vitest';
import { parseDjvuPages, classifyColumns, pageLines, scanMetrics } from './djvu-xml.js';

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
            full('a Arculphus who visited Palestine in the seventh century describes the church built there', 38),
            { words: [['H', 900, 930, 40], ['2', 940, 960, 40]] },
        ]);
        const [p] = parseDjvuPages(xml);
        const { lines, footnotes, printedPage } = pageLines(p);
        expect(printedPage).toBe('98');
        expect(lines.map((l) => l.main)).toEqual([...bodyLines.map((l) => l.words.map((w) => w[0]).join(' ')), 'CHAP. IV.']);
        expect(footnotes.map((l) => l.main)).toEqual(['a Arculphus who visited Palestine in the seventh century describes the church built there']);
    });

    it('takes a two-line head and reads the page number from its end', () => {
        const [p] = parseDjvuPages(page(2, [full('GOSPEL ACCORDING TO', 36), full('ST. MATTHEW. 93', 36), full('body line one two three four')]));
        const { lines, printedPage } = pageLines(p);
        expect(printedPage).toBe('93');
        expect(lines).toHaveLength(1);
    });

    it('reports each line indent from the column edge, past a stray mark before the first word', () => {
        const [p] = parseDjvuPages(page(3, [full('body line one two three four five'), full('body line six seven eight nine ten'), full('body line eleven twelve thirteen'), { words: [['7.', 390, 420], ['But', 430, 500], ['when', 510, 600]] }, { words: [['-', 340, 350], ['12.', 390, 430], ['And', 440, 500], ['it', 510, 600]] }]));
        const { lines } = pageLines(p);
        expect(lines[0].indent).toBe(0);
        expect(lines[3].indent).toBe(90);
        expect(lines[4].indent).toBe(90);
    });
});

describe('footnotes behind a line the OCR boxed tall', () => {
    it('trims the whole foot once a full line in small type is found among the last lines', () => {
        const bodyLines = Array.from({ length: 12 }, (_, i) => full(`body text line number ${i + 1} of the page`));
        const [p] = parseDjvuPages(page(42, [...bodyLines, full('h Leah full of labour, Jerom. de 38. who also gives the', 38), full('nomin. Hebr. from JIN^, to weary one\'s interpretation', 39), full('self. and ^|-j (nbnn beginning.)', 60), full('1 Rachel, an ewe, (as Gen. xxxi,', 51)]));
        const { lines, footnotes } = pageLines(p);
        expect(lines).toHaveLength(12);
        expect(footnotes).toHaveLength(4);
    });
});

describe('heads and signatures as the OCR damages them', () => {
    it('strips a head whose first word is misread and a signature the OCR reversed', () => {
        const bodyLines = Array.from({ length: 12 }, (_, i) => full(`body text line number ${i + 1} of the page`));
        const [p] = parseDjvuPages(page(363, [full('35(> GOSPKL ACCORDING TO CHAP. X.', 36), ...bodyLines, { words: [['2', 900, 930, 45], ['A2', 940, 990, 45]] }]));
        const { lines } = pageLines(p);
        expect(lines.map((l) => l.main)).toEqual(bodyLines.map((l) => l.words.map((w) => w[0]).join(' ')));
    });
});

describe('page geometry the 1841 scans need', () => {
    const body = (n: number) => Array.from({ length: n }, (_, i) => full(`body text line number ${i + 1} of the page`));

    it('treats a tiny word starting well left of the column as a margin fragment, whatever box the OCR gave it', () => {
        const [p] = parseDjvuPages(page(17, [...body(4), { words: [['s,', 214, 374], ['2.', 394, 450], ['As', 460, 520], ['it', 530, 1690]] }]));
        expect(classifyColumns(p).left).toBe(300);
        expect(p.lines[4].words.map((w) => w.margin)).toEqual([true, false, false, false]);
    });

    it('marks a note the OCR glued to a line at either edge, where its box abuts the text', () => {
        const [p] = parseDjvuPages(page(167, [...body(6),
            { words: [['Ambr.', 130, 305], ['together', 305, 560], ['with', 570, 1690]] },
            { words: [['all.', 300, 500], ['GREG.', 510, 700], ['otherwise;', 710, 1700], ['Greg.', 1700, 1830]] },
            { words: [['Aug.', 190, 300], ['de', 300, 430], ['AUG.', 430, 1690]] },
            { words: [['in', 120, 180], ['Joan.', 190, 300], ['by', 305, 400], ['a', 410, 1690]] },
        ]));
        classifyColumns(p);
        expect(p.lines[6].words.map((w) => w.margin)).toEqual([true, false, false]);
        expect(p.lines[7].words.map((w) => w.margin)).toEqual([false, false, false, true]);
        expect(p.lines[8].words.map((w) => w.margin)).toEqual([true, false, false]);
        expect(p.lines[9].words.map((w) => w.margin)).toEqual([true, true, false, false]);
    });

    it('does not take glued note starts for the edge on a page where they are a quarter of the lines', () => {
        const glued = ['Chrys.', 'Hom.', 'Matt.', 'Aug.'].map((n) => ({ words: [[n, 150, 300], ['text', 300, 700], ['on', 710, 1690]] as Array<[string, number, number]> }));
        const [p] = parseDjvuPages(page(45, [...body(9), ...glued]));
        expect(classifyColumns(p).left).toBe(300);
        expect(p.lines[9].words.map((w) => w.margin)).toEqual([true, false, false]);
    });

    it('takes the column edge from the scan\'s column width on a page where half the lines carry a glued note', () => {
        const glued = ['Greg.', 'Diem', 'Nat.', 'non', 'in', 'Athan.', 'tum.', 'Basil.', 'c.', 'super'].map((n) => ({ words: [[n, 150, 300], ['text', 300, 700], ['on', 710, 1690]] as Array<[string, number, number]> }));
        const [p] = parseDjvuPages(page(53, [...body(10), ...glued]));
        expect(classifyColumns(p, 1390).left).toBe(300);
        expect(p.lines[10].words.map((w) => w.margin)).toEqual([true, false, false]);
    });

    it('finds the column edge on a skewed page whose starts drift across buckets', () => {
        const drift = [300, 310, 322, 335, 348].map((x) => ({ words: [['body', x, x + 400], ['text', x + 410, 1690]] as Array<[string, number, number]> }));
        const [p] = parseDjvuPages(page(107, [...drift, { words: [['22.', 390, 450], ['And,', 460, 600], ['behold,', 610, 1690]] }]));
        expect(classifyColumns(p).left).toBe(300);
        expect(pageLines(p).lines[5].indent).toBe(90);
    });

    it('trims a footnote set in narrower type even where its word boxes are nearly body height, measured against the scan', () => {
        const note = (t: string) => ({ words: t.split(' ').map((w, i): [string, number, number, number] => [w, 300 + i * 70, 300 + i * 70 + 60, 46]) });
        const xml = page(39, [...body(12), note('exceeding-long footnote-words fill-this-line entirely with-narrow type-for the-editor note-text here-and beyond-it still-more'), note('rianism, the-opposite error-to Eutychianism or-Monophysitism is-imputed to-Origen see-Leontius de-Sectis and-others too-here')]);
        const [p] = parseDjvuPages(xml);
        const metrics = scanMetrics([p]);
        expect(metrics.height).toBe(50);
        const { lines, footnotes } = pageLines(p, metrics);
        expect(lines).toHaveLength(12);
        expect(footnotes).toHaveLength(2);
    });
});
