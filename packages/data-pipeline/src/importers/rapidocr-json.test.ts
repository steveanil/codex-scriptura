import { describe, it, expect } from 'vitest';
import { parseRapidOcrPages, rapidOcrProblem, wordsOfLine, dictionaryCuts, settleVocabulary, withoutRereads, inReadingOrder, repairedWord, italicRepair, LIGATURE_FORMS, RAPIDOCR_FORMAT, type RapidOcrDocument, type RapidOcrChar } from './rapidocr-json.js';
import { pageLines, scanMetrics } from './djvu-xml.js';

const doc = (pages: RapidOcrDocument['pages'], extra: Partial<RapidOcrDocument> = {}): RapidOcrDocument => ({
    format: RAPIDOCR_FORMAT, item: 'scan', source: { file: 'scan_jp2.zip', sha256: 'abc' }, engine: {}, models: {}, config: {}, bundle_leaves: pages.map((p) => p.leaf), pages, ...extra,
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
        expect(wordsOfLine(spans(0, 'AMBROSE\uFF1BOur')).map((w) => w.text)).toEqual(['AMBROSE;Our']);
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

    it('drops the text\'s first letter where a note\'s box reaching into the column read it a second time', () => {
        const body = Array.from({ length: 12 }, (_, i) => line(150, 100 + i * 30, 'line of the running text'));
        // "2 Kings" in the margin, whose box takes the "i" of "ite's" on the column's first spot and reads it as 1
        const note = line(78, 500, '2Kings1');
        const text = line(150, 500, 'ite\'s son, the third');
        const [p] = parseRapidOcrPages(doc([{ leaf: 1, width: 1000, height: 1500, rendered_width: 1000, rendered_height: 1500, lines: [...body, note, text] }]));
        expect(p.lines[12].words.map((w) => w.text)).toEqual(['2Kings', 'ite\'s', 'son,', 'the', 'third']);
    });

    it('reads notes stacked in the margin top to bottom, and a line\'s parts left to right', () => {
        const body = { ...line(40, 1000, 'the words of the text'), x2: 1330, y2: 1040 };
        const upper = { ...line(1340, 990, 'Chryso-'), x2: 1450, y2: 1020 };
        const lower = { ...line(1345, 1022, 'logus'), x2: 1430, y2: 1050 };
        expect(inReadingOrder([lower, body, upper], 1500).map((l) => l.text)).toEqual(['the words of the text', 'Chryso-', 'logus']);
        // a footnote mark inside the text line's span is not stacked on it
        const mark = { ...line(700, 1030, '1'), x2: 712, y2: 1045 };
        expect(inReadingOrder([body, mark], 1500).map((l) => l.text)).toEqual(['the words of the text', '1']);
    });

    it('drops a recovered line that is a page-pass line read again, and keeps a recovered body line beside a note', () => {
        const note = { ...line(1345, 1023, 'De Don.'), x2: 1482, y2: 1062, pass: 'page' };
        const again = { ...line(1346, 1021, 'De Don.'), x2: 1486, y2: 1063, pass: 'gap:native-low' };
        const body = { ...line(39, 1021, 'ask for perseverance of God, when they pray'), x2: 1490, y2: 1105, pass: 'gap:native-low' };
        expect(withoutRereads([note, again, body]).map((l) => l.text)).toEqual(['De Don.', 'ask for perseverance of God, when they pray']);
        // the right half the page pass read, and the whole line the recovery read again: the repeat goes
        const right = { ...line(449, 784, 'Therefore Paul says, Who', 22), pass: 'page' };
        const whole = { ...line(53, 776, 'God is injustice. Therefore Paul says, Who', 22), pass: 'gap:native-low' };
        const [, rest] = withoutRereads([right, whole]);
        expect(rest.text).toBe('God is injustice.');
    });

    it('settles the reading\'s own count: a glued form rare beside its parts goes, a compound that keeps pace with its rarer part or has no small word in it stays', () => {
        const raw = new Map(Object.entries({ that: 1000, he: 900, thathe: 3, 'that he': 200, way: 300, side: 150, wayside: 5, 'way side': 1, preface: 23, to: 5000, prefaceto: 1, 'preface to': 4, over: 400, shadow: 40, overshadow: 6, lay: 40, men: 400, laymen: 2, 'lay men': 3 }));
        const settled = settleVocabulary(raw);
        expect([...raw.keys()].filter((k) => !settled.has(k))).toEqual(['thathe', 'prefaceto']);
        expect(dictionaryCuts('thathe', settled)).toEqual([4]);
        expect(dictionaryCuts('prefaceto', settled)).toEqual([7]);
        expect(dictionaryCuts('wayside', settled)).toBeNull();
        expect(dictionaryCuts('overshadow', settled)).toBeNull();
        expect(dictionaryCuts('laymen', settled)).toBeNull();
    });

    it('restores a dropped space where the edition\'s vocabulary shows two or three of its words run together', () => {
        const vocab = new Map(Object.entries({ receive: 9, it: 40, 'receive it': 6, their: 30, freedom: 4, and: 90, requiring: 15, of: 80, them: 30, 'and requiring': 4, 'requiring of': 3, 'of them': 40, 'requiring them': 3, therefore: 12, who: 40, 'therefore who': 3, there: 20, fore: 3, 'there fore': 0 }));
        expect(dictionaryCuts('receiveit', vocab)).toEqual([7]);
        // A longer run needs every part common, and a two-letter word very common
        expect(dictionaryCuts('andrequiringofthem', vocab)).toEqual([3, 12, 14]);
        expect(dictionaryCuts('requiringofthem', vocab)).toEqual([9, 11]);
        expect(dictionaryCuts('requiringfreedomofthem', vocab)).toBeNull();
        expect(dictionaryCuts('andrequiringthem', vocab)).toEqual([3, 12]);
        expect(dictionaryCuts('therefore', vocab)).toBeNull();
        expect(dictionaryCuts('thereforewho', vocab)).toEqual([9]);
        expect(dictionaryCuts('Receive,', vocab)).toBeNull();
        expect(dictionaryCuts('itis', new Map([['it', 60], ['is', 70], ['it is', 30]]))).toEqual([2]);
        expect(dictionaryCuts('itis', new Map([['it', 60], ['is', 7], ['it is', 2]]))).toBeNull();
        // the cut stands on the vocabulary whether or not the characters show the dropped space: the recogniser closes the boxes over it
        const gapped = { ...line(150, 400, 'will receiveit'), chars: [...spans(150, 'will receive'), ...spans(299, 'it')] };
        const [p] = parseRapidOcrPages(doc([{ leaf: 1, width: 1000, height: 1500, rendered_width: 1000, rendered_height: 1500, lines: [...Array.from({ length: 6 }, (_, i) => line(150, 100 + i * 30, 'their freedom and requiring of them')), gapped, line(150, 430, 'will receiveit')] }]), vocab);
        expect(p.lines[6].words.map((w) => w.text)).toEqual(['will', 'receive', 'it']);
        expect(p.lines[6].words[1]).toMatchObject({ x1: 210, x2: 294 });
        expect(p.lines[7].words.map((w) => w.text)).toEqual(['will', 'receive', 'it']);
        // the pair the parts make must be one the edition prints side by side: "of the" is, "he at" is not
        const small = new Map(Object.entries({ of: 800, the: 900, 'of the': 500, a: 500, 'of a': 60, i: 300, have: 200, 'i have': 20, as: 400, he: 300, 'as he': 30, at: 300, 'he at': 2, heat: 30, in: 900, her: 200, it: 400, 'in her': 40, 'her it': 1 }));
        expect(dictionaryCuts('ofthe', small)).toEqual([2]);
        expect(dictionaryCuts('ofa', small)).toEqual([2]);
        expect(dictionaryCuts('ihave', small)).toEqual([1]);
        expect(dictionaryCuts('ashe', small)).toEqual([2]);
        expect(dictionaryCuts('inherit', small)).toBeNull();
        expect(dictionaryCuts('gregorythus', new Map(Object.entries({ gregory: 300, thus: 1000 })))).toEqual([7]);
        expect(dictionaryCuts('gregorythus', new Map(Object.entries({ gregory: 300, thus: 1000, gregorythus: 3 })))).toBeNull();
        expect(settleVocabulary(small).has('heat')).toBe(true);
    });

    it('repairs a ligature form and an italic misreading from the reading\'s own counts, and leaves a real word alone', () => {
        const vocab = new Map(Object.entries({ was: 8000, uas: 60, have: 4800, hare: 48, more: 900, move: 30, knee: 6, knew: 500, which: 7000, ichich: 1, flesh: 120, fesh: 800 }));
        expect(LIGATURE_FORMS.fesh).toBe('flesh');
        expect(LIGATURE_FORMS.fed).toBeUndefined();
        expect(repairedWord('fesh,', vocab)).toBe('flesh,');
        expect(repairedWord('Fesh', vocab)).toBe('Flesh');
        expect(repairedWord('FESH.', vocab)).toBeNull();
        expect(italicRepair('uas', vocab)).toBe('was');
        expect(italicRepair('hare', vocab)).toBe('have');
        expect(italicRepair('ichich', vocab)).toBe('which');
        expect(italicRepair('more', vocab)).toBeNull();
        expect(italicRepair('knee', vocab)).toBeNull();
        expect(repairedWord('\u201chare', vocab)).toBe('\u201chave');
        expect(repairedWord('was', vocab)).toBeNull();
        // The repaired span keeps one box per character
        const body = Array.from({ length: 12 }, (_, i) => line(150, 100 + i * 30, 'line of the running text'));
        const [p] = parseRapidOcrPages(doc([{ leaf: 1, width: 1000, height: 1500, rendered_width: 1000, rendered_height: 1500, lines: [...body, line(150, 500, 'the fesh uas ichich')] }]), vocab);
        expect(p.lines[12].words.map((w) => w.text)).toEqual(['the', 'flesh', 'was', 'which']);
    });

    it('withholds a repair, cut or join that would change a word the lexicon knows, and logs it', () => {
        // "wilt" and "hare" are words: the reading's counts favour "will" and "have", but frequency is no proof
        const vocab = new Map(Object.entries({ was: 8000, uas: 60, have: 4800, hare: 48, will: 5000, wilt: 40, is: 900, land: 300, the: 900, wine: 50, press: 20, winepress: 30 }));
        const english = new Set(['was', 'have', 'hare', 'will', 'wilt', 'is', 'land', 'island', 'wine', 'press', 'the']);
        const body = Array.from({ length: 12 }, (_, i) => line(150, 100 + i * 30, 'line of the running text'));
        const log: Array<{ rule: string; from: string; to: string; leaf?: number }> = [];
        const page = doc([{ leaf: 7, width: 1000, height: 1500, rendered_width: 1000, rendered_height: 1500, lines: [...body, line(150, 500, 'uas wilt hare'), line(150, 530, 'island wine press')] }]);
        const [p] = parseRapidOcrPages(page, vocab, (t) => log.push(t), english);
        expect(p.lines.slice(12).map((l) => l.words.map((w) => w.text).join(' '))).toEqual(['was wilt hare', 'island wine press']);
        expect(log.map((t) => `${t.rule} ${t.from}>${t.to} @${t.leaf}`)).toEqual(expect.arrayContaining(['italic uas>was @7', 'italic-withheld wilt>will @7', 'italic-withheld hare>have @7', 'fragment-join-withheld wine press>winepress @7']));
        // Without the lexicon the counts alone would have changed them
        const [q] = parseRapidOcrPages(page, vocab);
        expect(q.lines.slice(12).map((l) => l.words.map((w) => w.text).join(' '))).toEqual(['was will have', 'is land winepress']);
    });

    it('fuses two fragments that are no words into the word the edition uses', () => {
        const vocab = new Map(Object.entries({ immediately: 198, im: 79, mediately: 32, 'im mediately': 20, the: 900, beset: 8, be: 800, set: 60, 'be set': 8 }));
        const body = Array.from({ length: 12 }, (_, i) => line(150, 100 + i * 30, 'line of the running text'));
        const [p] = parseRapidOcrPages(doc([{ leaf: 1, width: 1000, height: 1500, rendered_width: 1000, rendered_height: 1500, lines: [...body, line(150, 500, 'the im mediately, be set')] }]), vocab);
        expect(p.lines[12].words.map((w) => w.text)).toEqual(['the', 'immediately,', 'be', 'set']);
    });

    it('joins the halves of a word the recogniser cut at a mark set inside it', () => {
        const vocab = new Map(Object.entries({ summit: 6, sum: 2, mit: 1, the: 900 }));
        const body = Array.from({ length: 12 }, (_, i) => line(150, 100 + i * 30, 'line of the running text'));
        const [p] = parseRapidOcrPages(doc([{ leaf: 1, width: 1000, height: 1500, rendered_width: 1000, rendered_height: 1500, lines: [...body, line(150, 500, 'the sum t mit')] }]), vocab);
        expect(p.lines[12].words.map((w) => w.text)).toEqual(['the', 'summit']);
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

    it('refuses a document that holds some of the bundle\'s leaves only, or one twice', () => {
        const page = (leaf: number) => ({ leaf, width: 10, height: 10, rendered_width: 10, rendered_height: 10, lines: [] });
        const whole = doc([page(0), page(1), page(2)]);
        expect(rapidOcrProblem(whole, 'scan', 'abc')).toBeNull();
        // A --leaves diagnosis written where the scan's document belongs
        expect(rapidOcrProblem({ ...whole, pages: [page(1)] }, 'scan', 'abc')).toMatch(/2 missing, first 0/);
        expect(rapidOcrProblem({ ...whole, pages: [page(0), page(1), page(1), page(2)] }, 'scan', 'abc')).toMatch(/more than once/);
        expect(rapidOcrProblem({ ...whole, pages: [page(0), page(1), page(2), page(9)] }, 'scan', 'abc')).toMatch(/1 not in the bundle/);
        expect(rapidOcrProblem({ ...whole, bundle_leaves: [] }, 'scan', 'abc')).toMatch(/no bundle leaf list/);
    });
});
