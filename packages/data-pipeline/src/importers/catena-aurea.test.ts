import { describe, it, expect } from 'vitest';
import type { OcrPage, OcrLine } from './djvu-xml.js';
import { parseCatenaPages, splitChain, resolveAuthor, blockToEntry, escapeCommentaryText, cleanOcr, emptyReport, roman } from './catena-aurea.js';
import { applyCorrections } from './catena-corrections.js';
import { commentaryEntryProblem } from '@codex-scriptura/core';

/** Justified lines on a 2000-wide page with the column at 300..1700; `indent` shifts the first word, `margin` adds a note beyond the column, `h` sets word height. */
function line(text: string, opts: { indent?: number; margin?: string; h?: number } = {}): OcrLine {
    const words = text.split(' ');
    const start = 300 + (opts.indent ?? 0);
    const step = (1700 - start) / words.length;
    const ws = words.map((t, i) => ({ text: t, x1: Math.round(start + i * step), x2: Math.round(start + (i + 1) * step) - 8, y1: 1000, y2: 1000 + (opts.h ?? 50), margin: false }));
    if (opts.margin) ws.push({ text: opts.margin, x1: 1760, x2: 1900, y1: 1000, y2: 1050, margin: false });
    return { words: ws };
}
const page = (leaf: number, ...lines: OcrLine[]): OcrPage => ({ leaf, width: 2000, height: 3000, lines });

const counts = { 3: 17 };

describe('Catena Aurea parser (issue #85)', () => {
    const pages = [
        page(114,
            line('91 GOSPEL ACCORDING TO CHAP. III.', { h: 36 }),
            line('CHAP. III.'),
            line('1. In those days came John the Baptist, preaching', { indent: 90, h: 59 }),
            line('in the wilderness of Judaea,', { h: 59 }),
            line('2. And saying, Repent ye: for the kingdom of', { indent: 90, h: 59 }),
            line('heaven is at hand.', { h: 59 }),
            line('PSEUDO-CHRYS. The Sun as he approaches the horizon, sends'),
            line('out his rays. In those days, 8$c. REMIG. In these words', { margin: 'Ver. i.' }),
            line('we have time, place, and person. AUG. Luke describes the', { margin: 'Aug. De' }),
            line('time by the reigning sovereigns. But Matthew must be', { margin: 'Con. Evan. ii. 6.' }),
            line('understood more widely.'),
        ),
        page(115,
            line('92 GOSPEL ACCORDING TO CHAP. III.', { h: 36 }),
            line('Ver. 4. And the same John had his raiment of', { indent: 90, h: 59 }),
            line('camel\'s hair.', { h: 59 }),
            line('PsEUDO-CiiRYs. Having said that he is the voice, the'),
            line('Evangelist well adds. JEROME; His raiment of camel\'s hair.'),
            line('Au£. It is easy to understand. RABAN. He ate locusts.'),
        ),
    ];

    it('opens a block per indented numbered lemma, joins its lines, and cuts the chain at author tokens', () => {
        const report = emptyReport();
        const blocks = parseCatenaPages(pages, 'item', counts, report);
        expect(blocks.map((b) => `${b.chapter}:${b.verseStart}-${b.verseEnd}`)).toEqual(['3:1-2', '3:4-4']);
        expect(blocks[0].lemma).toBe('In those days came John the Baptist, preaching in the wilderness of Judaea, And saying, Repent ye: for the kingdom of heaven is at hand.');
        expect(blocks[0].excerpts.map((e) => e.author)).toEqual(['Pseudo-Chrysostom', 'Remigius', 'Augustine']);
        expect(blocks[0].excerpts[0].text).toBe('The Sun as he approaches the horizon, sends out his rays. In those days, &c.');
        expect(blocks[1].excerpts.map((e) => e.author)).toEqual(['Pseudo-Chrysostom', 'Jerome', 'Augustine', 'Rabanus']);
        expect(report.unknownTokens).toEqual({});
    });

    it('attaches margin notes to the excerpt on their line: "Ver. N" marks the verse, the rest is the citation', () => {
        const [first] = parseCatenaPages(pages, 'item', counts);
        expect(first.excerpts[1]).toMatchObject({ author: 'Remigius', verse: 1 });
        expect(first.excerpts[1].citation).toBeUndefined();
        expect(first.excerpts[2]).toMatchObject({ author: 'Augustine', verse: 1, citation: 'Aug. De Con. Evan. ii. 6.' });
    });

    it('records the leaves and printed pages each block was read from', () => {
        const blocks = parseCatenaPages(pages, 'item', counts);
        expect(blocks[0].source).toEqual({ item: 'item', leafStart: 114, leafEnd: 114, pageStart: '91', pageEnd: '91' });
        expect(blocks[1].source).toEqual({ item: 'item', leafStart: 115, leafEnd: 115, pageStart: '92', pageEnd: '92' });
    });

    it('carries a printed page number forward over a page whose head the OCR lost', () => {
        const headless = [pages[0], page(115, line('Ver. 4. And the same John had his raiment', { indent: 90, h: 59 }), line('RABAN. He ate locusts.'))];
        expect(parseCatenaPages(headless, 'item', counts)[1].source).toMatchObject({ pageStart: '92', pageEnd: '92' });
    });

    it('opens a further block on the same verse for an unnumbered indented lemma in larger type', () => {
        const split = [page(20,
            line('13 ST. JOHN. CHAP. I.', { h: 36 }),
            line('CHAP. I.'),
            line('1. In the beginning was the Word,', { indent: 90, h: 60 }),
            line('CHRYS. While all the other Evangelists begin with the flesh.'),
            line('and the Word was with God,', { indent: 90, h: 60 }),
            line('HILARY. Years, centuries, ages, are passed over.'),
        )];
        const blocks = parseCatenaPages(split, 'john', { 1: 51 });
        expect(blocks.map((b) => `${b.verseStart}-${b.verseEnd}`)).toEqual(['1-1']);
        expect(blocks[0].excerpts.map((e) => e.author)).toEqual(['Chrysostom']);
        expect(blocks[0].continuations).toEqual([{ lemma: 'and the Word was with God,', excerpts: [expect.objectContaining({ author: 'Hilary' })] }]);
        const entry = blockToEntry(blocks[0], 'John');
        expect(entry.content).toContain('\n\n> and the Word was with God,\n\n**Hilary.** Years');
    });

    it('keeps words before a mid-line first token with the lemma', () => {
        const [b] = parseCatenaPages([page(1, line('CHAP. III.'), line('5. Then went out to him', { indent: 90, h: 59 }), line('Jerusalem. PSEUDO-CHRYS. Having described the preaching.'))], 'item', counts);
        expect(b.lemma).toBe('Then went out to him Jerusalem.');
        expect(b.excerpts[0].text).toBe('Having described the preaching.');
    });
});

describe('author tokens', () => {
    it('resolves the abbreviations the edition prints, repairing small OCR damage but never inventing an author', () => {
        expect(resolveAuthor('PSEUDO-CHRYS')?.name).toBe('Pseudo-Chrysostom');
        expect(resolveAuthor('RKMIG')?.name).toBe('Remigius');
        expect(resolveAuthor('Au£')?.name).toBe('Augustine');
        expect(resolveAuthor('PsEUDO-CiiRYs')?.name).toBe('Pseudo-Chrysostom');
        expect(resolveAuthor('GREG. NYSS')?.name).toBe('Gregory of Nyssa');
        expect(resolveAuthor('HERE')).toBeNull();
        expect(resolveAuthor('CHRIST')).toBeNull();
        expect(resolveAuthor('VOL')).toBeNull();
        expect(resolveAuthor('MSS')).toBeNull();
    });

    it('"ID." continues the previous author', () => {
        const ex = splitChain([{ text: 'JEROME. First thought. ID. Second thought.', margin: '' }], emptyReport());
        expect(ex.map((e) => e.author)).toEqual(['Jerome', 'Jerome']);
    });

    it('counts an unknown upper-case token as text and reports it', () => {
        const report = emptyReport();
        const ex = splitChain([{ text: 'CHRYS. See the LXX. reading here.', margin: '' }], report);
        expect(ex).toHaveLength(1);
        expect(ex[0].text).toBe('See the LXX. reading here.');
        expect(report.unknownTokens).toEqual({ LXX: 1 });
    });

    it('reads roman chapter numbers', () => {
        expect(roman('III')).toBe(3);
        expect(roman('XIV')).toBe(14);
        expect(roman('XXVIII')).toBe(28);
    });
});

describe('rendering', () => {
    it('emits one entry per block in the Markdown subset with a source locator', () => {
        const [b] = parseCatenaPages([page(5, line('CHAP. III.'), line('1. In those days came John,', { indent: 90, h: 59 }), line('2. And saying, Repent ye:', { indent: 90, h: 59 }), line('AUG. Text with *stars* and [brackets].', { margin: 'Ver. 2.' }))], 'item', counts);
        const entry = blockToEntry(b, 'Matt');
        expect(entry).toMatchObject({ id: 'catena-matt-3-1-2', startRef: 'Matt.3.1', endRef: 'Matt.3.2', heading: 'Matthew 3:1-2', source: { item: 'item', leafStart: 5, leafEnd: 5 } });
        expect(entry.content).toBe('> In those days came John, And saying, Repent ye:\n\n## Verse 2\n\n**Augustine.** Text with \\*stars\\* and \\[brackets\\].');
        expect(commentaryEntryProblem(entry)).toBeNull();
    });

    it('escapes everything that could open markup, and cleans the OCR quirks it can', () => {
        expect(escapeCommentaryText('a * b [c] \\d\n# not a heading\n> not a quote')).toBe('a \\* b \\[c\\] \\\\d\n\\# not a heading\n\\> not a quote');
        expect(cleanOcr('In those days, 8$c. and Christ6 said , so ;')).toBe('In those days, &c. and Christ said, so;');
    });
});

describe('corrections', () => {
    const blocks = () => parseCatenaPages([page(9, line('CHAP. III.'), line('4. And the same John', { indent: 90, h: 59 }), line('RABAN. arid honey has sweetness.'))], 'item', counts);

    it('replaces exactly one occurrence in the named excerpt, read from a leaf inside the block', () => {
        const out = applyCorrections(blocks(), [{ item: 'item', chapter: 3, verseStart: 4, verseEnd: 4, occurrence: 1, excerpt: 1, find: 'arid honey', replace: 'and honey', leaf: 9 }], 'item');
        expect(out[0].excerpts[0].text).toBe('and honey has sweetness.');
    });

    it('targets the nth block of a verse the edition prints as several lemma blocks', () => {
        const split = parseCatenaPages([page(20,
            line('CHAP. I.'),
            line('1. In the beginning was the Word,', { indent: 90, h: 60 }),
            line('CHRYS. While all the other Evangelists begin.'),
            line('and the Word was with God,', { indent: 90, h: 60 }),
            line('HILARY. Years, centuries, ages, are pased over.'),
        )], 'john', { 1: 51 });
        const fix = { item: 'john', chapter: 1, verseStart: 1, verseEnd: 1, occurrence: 1, excerpt: 2, find: 'pased', replace: 'passed', leaf: 20 };
        expect(applyCorrections(split, [fix], 'john')[0].continuations[0].excerpts[0].text).toBe('Years, centuries, ages, are passed over.');
        expect(() => applyCorrections(split, [{ ...fix, excerpt: 1 }], 'john')).toThrow(/not found/);
        expect(() => applyCorrections(split, [{ ...fix, occurrence: 2 }], 'john')).toThrow(/not parsed/);
        expect(() => applyCorrections(split, [{ ...fix, occurrence: 0 }], 'john')).toThrow(/1-based occurrence/);
    });

    it('corrects a verse range the OCR misread, on the block only', () => {
        const fixed = applyCorrections(blocks(), [{ item: 'item', chapter: 3, verseStart: 4, verseEnd: 4, occurrence: 1, excerpt: 0, setRange: [4, 6], leaf: 9, note: 'page prints 4-6' }], 'item');
        expect([fixed[0].verseStart, fixed[0].verseEnd]).toEqual([4, 6]);
        expect(() => applyCorrections(blocks(), [{ item: 'item', chapter: 3, verseStart: 4, verseEnd: 4, occurrence: 1, excerpt: 1, setRange: [4, 6], leaf: 9 }], 'item')).toThrow(/excerpt 0/);
        expect(() => applyCorrections(blocks(), [{ item: 'item', chapter: 3, verseStart: 4, verseEnd: 4, occurrence: 1, excerpt: 0, setRange: [6, 4], leaf: 9 }], 'item')).toThrow(/ordered verse range/);
        expect(() => applyCorrections(blocks(), [{ item: 'item', chapter: 3, verseStart: 4, verseEnd: 4, occurrence: 1, excerpt: 0, leaf: 9 }], 'item')).toThrow(/does nothing/);
    });

    it('reads a verse range on a lemma line', () => {
        const [b] = parseCatenaPages([page(2, line('CHAP. I.'), line('3\u20146. And Judas begat Phares and Zara', { indent: 90, h: 59 }), line('JEROME. Note the four women.'))], 'item', { 1: 25 });
        expect([b.verseStart, b.verseEnd]).toEqual([3, 6]);
        expect(b.lemma).toBe('And Judas begat Phares and Zara');
    });

    it('refuses a correction whose text, block, excerpt or leaf does not match', () => {
        const c = { item: 'item', chapter: 3, verseStart: 4, verseEnd: 4, occurrence: 1, excerpt: 1, find: 'arid honey', replace: 'and honey', leaf: 9 };
        expect(() => applyCorrections(blocks(), [{ ...c, find: 'no such text' }], 'item')).toThrow(/not found/);
        expect(() => applyCorrections(blocks(), [{ ...c, verseEnd: 5 }], 'item')).toThrow(/not parsed/);
        expect(() => applyCorrections(blocks(), [{ ...c, excerpt: 2 }], 'item')).toThrow(/excerpt 2 of a block with 1/);
        expect(() => applyCorrections(blocks(), [{ ...c, leaf: 10 }], 'item')).toThrow(/read from leaf 10/);
        expect(() => applyCorrections(blocks(), [{ ...c, find: 'a' }], 'item')).toThrow(/ambiguous/);
        expect(applyCorrections(blocks(), [{ ...c, item: 'other' }], 'item')[0].excerpts[0].text).toContain('arid');
    });
});

describe('the OCR forms of the edition the whole corpus meets', () => {
    const body = (n: number) => Array.from({ length: n }, (_, i) => line(`and the text of the chain runs on in the body type here ${i}`));

    it('reads verse numbers the OCR split, dashed or set in roman', () => {
        const pages = [page(16,
            line('CHAP. I.'),
            line('Ver. I. The beginning of the Gospel of Jesus', { indent: 90, h: 59 }),
            line('Christ, the Son of God.', { h: 59 }),
            line('JEROME; Mark the Evangelist served the priesthood.'),
            line('1 6. Now as he walked by the sea of Galilee', { indent: 90, h: 59 }),
            line('1 7. And Jesus said unto them, Come ye after me', { indent: 90, h: 59 }),
            line('CHRYS. He calls them from their trade.'),
            line('4- John did baptize in the wilderness, and preach', { indent: 90, h: 59 }),
            line('AUG. So it begins.'),
            line('8 \u2014 1 1 . And Josaphat begat Joram', { indent: 90, h: 59 }),
            line('REMIG. Kings follow.'),
            line('3---6. And Judas begat Phares and Zara of Thamar;', { indent: 95, h: 59 }),
            line('GLOSS. Passing over the other sons of Jacob.'),
            line('11. Blessed are ye, when men shall revile you', { indent: 90, h: 59 }),
            line('12: Rejoice, and be exceeding glad', { indent: 98, h: 59 }),
            line(': 13. Ye are the salt of the earth', { indent: 87, h: 59 }),
            line('AUG. Rejoice.'),
            ...body(8),
        )];
        const blocks = parseCatenaPages(pages, 'item', { 1: 45 });
        expect(blocks.map((b) => `${b.verseStart}-${b.verseEnd}`)).toEqual(['1-1', '16-17', '4-4', '8-11', '3-6', '11-13']);
        expect(blocks[0].lemma).toBe('The beginning of the Gospel of Jesus Christ, the Son of God.');
    });

    it('reads the chapter-start roman verse RapidOCR gives as a lowercase l, under a head it gives as a digit', () => {
        const pages = [page(16, line('CHAP. 1.'), line('Ver. l. The beginning of the Gospel of Jesus', { indent: 90, h: 59 }), line('Christ, the Son of God.', { h: 59 }), line('JEROME; Mark the Evangelist served the priesthood.'), ...body(8))];
        const blocks = parseCatenaPages(pages, 'item', { 1: 45 });
        expect(blocks.map((b) => `${b.verseStart}-${b.verseEnd}`)).toEqual(['1-1']);
        expect(blocks[0].lemma).toBe('The beginning of the Gospel of Jesus Christ, the Son of God.');
    });

    it('keeps a stray mark at the top of a page from opening a lemma', () => {
        const pages = [page(173, line('CHAP. XV.'), line('1 . , \u2022 -i-', { indent: 600, h: 28 }), line('29. And Jesus departed from thence', { indent: 90, h: 59 }), line('CHRYS. He departed.'), ...body(6))];
        expect(parseCatenaPages(pages, 'item', { 15: 39 }).map((b) => `${b.verseStart}-${b.verseEnd}`)).toEqual(['29-29']);
    });

    it('reads a damaged verse number inside a lemma, and infers the next verse for one it cannot read at a block\'s opening', () => {
        const report = emptyReport();
        const pages = [page(173,
            line('CHAP. XV.'),
            line('29. And Jesus departed from thence, and came', { indent: 90, h: 59 }),
            line('30. And great multitudes came unto him', { indent: 90, h: 59 }),
            line('3L Insomuch that the multitude wondered', { indent: 90, h: 59 }),
            line('CHRYS. He healed them all.'),
            ...body(6),
            line('Qib. And fear came on all that dwelt round about', { indent: 90, h: 59 }),
            line('BEDE; Fear came on them.'),
            ...body(4),
        )];
        const blocks = parseCatenaPages(pages, 'item', { 15: 39 }, report);
        expect(blocks.map((b) => `${b.verseStart}-${b.verseEnd}`)).toEqual(['29-31', '32-32']);
        expect(report.inferredNumbers).toEqual(['item 15:31 from "3L" (leaf 173)', 'item 15:32 from "Qib." (leaf 173)']);
    });

    it('keeps a name mentioned inside the lemma from cutting it', () => {
        const pages = [page(257, line('CHAP. XXI.'), line('1. After these things Jesus shewed himself again', { indent: 90, h: 59 }), line('2. There were together Simon Peter, and Thomas', { indent: 90, h: 59 }), line('called Didymus, and Nathanael of Cana in Galilee,', { h: 59 }), line('3. Simon Peter saith unto them, I go a fishing.', { indent: 90, h: 59 }), line('CHRYS. Why does he fish again?'), ...body(6))];
        const blocks = parseCatenaPages(pages, 'item', { 21: 25 });
        expect(blocks.map((b) => `${b.verseStart}-${b.verseEnd}`)).toEqual(['1-3']);
        expect(blocks[0].excerpts.map((e) => e.author)).toEqual(['Chrysostom']);
    });

    it('takes the second OCR batch\'s token forms: a mixed-case second word and no space after the mark', () => {
        const ex = splitChain([{ text: 'BEDE; First thought. TIT.BosT. Second thought. AMBROSE;But a third. GREG. NYSS. Fourth.', margin: '' }], emptyReport());
        expect(ex.map((e) => e.author)).toEqual(['Bede', 'Titus of Bostra', 'Ambrose', 'Gregory of Nyssa']);
        expect(ex[2].text).toBe('But a third.');
    });

    it('ignores a stray mark before a verse number', () => {
        const pages = [page(317, line('CHAP. XXI.'), line('37. And in the day time he was teaching', { indent: 90, h: 59 }), line('-38. And all the people came early', { indent: 90, h: 59 }), line('BEDE; What our Lord commanded.'), ...body(6))];
        expect(parseCatenaPages(pages, 'item', { 21: 38 }, emptyReport(), { firstChapter: 21 }).map((b) => `${b.verseStart}-${b.verseEnd}`)).toEqual(['37-38']);
    });

    it('opens a block on a cleanly numbered indented line whatever the recogniser made of its height', () => {
        const pages = [page(222, line('CHAP. VI.'), line('11. And they were filled with madness', { indent: 90, h: 59 }), line('BEDE; A start.'), ...body(6), line('12 And it came to pass in those days', { indent: 90, h: 50 }), line('AUG. He prayed.'), ...body(3), line('1 Rachel, an ewe, as Gen. xxxi', { indent: 90, h: 50 }), line('AUG. More.'), ...body(2))];
        expect(parseCatenaPages(pages, 'item', { 6: 49 }, emptyReport(), { firstChapter: 6 }).map((b) => `${b.verseStart}-${b.verseEnd}`)).toEqual(['11-11', '12-12']);
    });

    it('does not open a block on a printer\'s mark that reached it', () => {
        const pages = [page(360, line('CHAP. X.'), line('1. Verily, verily, I say unto you', { indent: 90, h: 59 }), line('BEDE; A start.'), ...body(6), line('2 A', { indent: 600, h: 50 }), line('3. To him the porter openeth', { indent: 90, h: 59 }), line('AUG. The porter.'), ...body(3))];
        expect(parseCatenaPages(pages, 'item', { 10: 42 }, emptyReport(), { firstChapter: 10 }).map((b) => `${b.verseStart}-${b.verseEnd}`)).toEqual(['1-1', '3-3']);
    });

    it('repairs the first batch\'s token damage: broken, specked and three-letter small capitals, and TD for ID', () => {
        const ex = splitChain([{ text: 'REMIGIUS ; One. But Jacob begot Joseph. JE ROME. Two. BAB ANUS; Three. CHRYS.* Four. ADG. Five. TD. Six. GLOS?. Seven. PETRUS ALFONSUS. Eight.', margin: '' }], emptyReport());
        expect(ex.map((e) => e.author)).toEqual(['Remigius', 'Jerome', 'Rabanus', 'Chrysostom', 'Augustine', 'Augustine', 'Gloss', 'Petrus Alfonsus']);
        expect(ex[1].text).toBe('Two.');
        const dashed = splitChain([{ text: 'as the shepherds-', margin: '' }, { text: 'GLOSS. Nine.', margin: '' }], emptyReport());
        expect(dashed.map((e) => e.author)).toEqual(['Gloss']);
        expect(resolveAuthor('CHRYSOST')?.name).toBe('Chrysostom');
        expect(resolveAuthor('CIIRYS')?.name).toBe('Chrysostom');
        expect(resolveAuthor('BfiDE')?.name).toBe('Bede');
        expect(resolveAuthor('CflRYS')?.name).toBe('Chrysostom');
        expect(resolveAuthor('BKDK')?.name).toBe('Bede');
        expect(resolveAuthor('REDE')?.name).toBe('Bede');
        expect(resolveAuthor('BEAD')).toBeNull();
        expect(resolveAuthor('Seven')).toBeNull();
        expect(resolveAuthor('Bed')).toBeNull();
        expect(resolveAuthor('SEVER')?.name).toBe('Severianus');
        expect(resolveAuthor('BepE')?.name).toBe('Bede');
        expect(resolveAuthor('QREG')?.name).toBe('Gregory');
        expect(resolveAuthor('CHIIYS')?.name).toBe('Chrysostom');
        expect(resolveAuthor('AtG')?.name).toBe('Augustine');
        expect(resolveAuthor("T'HEoPHyL")?.name).toBe('Theophylact');
        const second = splitChain([{ text: "AUG. Without sin. t BEDE; One. [BeDE; Two. \u2191AMBRosE; Three. T'HEoPHyL. Four. CHRys.i. Five. Aug", margin: '' }, { text: 'He went out. BenE; Six.', margin: '' }], emptyReport());
        expect(second.map((e) => e.author + ': ' + e.text)).toEqual(['Augustine: Without sin.', 'Bede: One.', 'Bede: Two.', 'Ambrose: Three.', 'Theophylact: Four.', 'Chrysostom: Five.', 'Augustine: He went out.', 'Bede: Six.']);
        // A word before a whole token is not a broken piece of it
        expect(splitChain([{ text: 'AUG. One of you, He saith, i. e. one in CHRys. As He did not mention Him.', margin: '' }], emptyReport()).map((e) => e.author)).toEqual(['Augustine', 'Chrysostom']);
        expect(splitChain([{ text: 'GLOSS. Joseph was not disobedient. JOSEPH us ; Herod had nine wives. ORKJEN; Some one may think.', margin: '' }], emptyReport()).map((e) => e.author)).toEqual(['Gloss', 'Josephus', 'Origen']);
        expect(splitChain([{ text: 'AUG. towards the north. CHRvs', margin: '.Chrys.' }, { text: 'It should be observed, that when He delivered the Jews', margin: '' }], emptyReport()).map((e) => e.author)).toEqual(['Augustine', 'Chrysostom']);
        expect(splitChain([{ text: 'AUG. He is the CHRIST', margin: '' }, { text: 'of God.', margin: '' }], emptyReport()).map((e) => e.author)).toEqual(['Augustine']);
        expect(splitChain([{ text: 'AUG. ill words to you. In. For often we wrongly shun to teach. In the beginning was the Word.', margin: '' }], emptyReport()).map((e) => e.author + ': ' + e.text.slice(0, 12))).toEqual(['Augustine: ill words to', 'Augustine: For often we']);
        expect(splitChain([{ text: "AUG. unadulterated. RABAN.12'3* From the Greek. CEIRYS. He suffered. JEROME ? It sate on the head. ORIG-EN; Morally; He who shall see. ORiGEN;^0^1 For the Saints. GLOSS-", margin: '' }, { text: 'Snd as the opening of this Gospel.', margin: '' }], emptyReport()).map((e) => e.author)).toEqual(['Augustine', 'Rabanus', 'Chrysostom', 'Jerome', 'Origen', 'Origen', 'Gloss']);
        expect(splitChain([{ text: 'AUG. seek not praise of men in reward of our works. PSETJDO-', margin: '' }, { text: 'CHRYS. What shall you receive from God? he did so. CHRYS. Yes.', margin: '' }], emptyReport()).map((e) => e.author + ': ' + e.text.slice(0, 22))).toEqual(['Augustine: seek not praise of men', 'Pseudo-Chrysostom: What shall you receive', 'Chrysostom: Yes.']);
        expect(splitChain([{ text: 'AUG. we read in Josephus. Pseudo-', margin: '' }, { text: 'PsEUDO-DiONYSius; See how Jesus Himself.', margin: '' }], emptyReport()).map((e) => e.author + ': ' + e.text)).toEqual(['Augustine: we read in Josephus.', 'Pseudo-Dionysius: See how Jesus Himself.']);
        expect(splitChain([{ text: 'AUG. seek not praise of men. he did so. CHRYS. Yes.', margin: '' }], emptyReport())[0].text).toBe('seek not praise of men. he did so.');
        expect(resolveAuthor('D1oNysius AR')?.name).toBe('Dionysius');
        expect(splitChain([{ text: 'went out, as it is said. PSEU DO- JEROME; The Lord, leaving darkness behind', margin: '' }], emptyReport()).map((e) => e.author)).toEqual(['Pseudo-Jerome']);
        expect(splitChain([{ text: 'AUG. by the bounty of Christ. CHRY-', margin: '' }, { text: 'SOLOGUS. Because the sabbath is illuminated.', margin: '' }], emptyReport()).map((e) => e.author)).toEqual(['Augustine', 'Peter Chrysologus']);
        expect(splitChain([{ text: "AUG. which were his lord's. JEROM E ; He says, Thou wast faithful.", margin: '' }], emptyReport()).map((e) => e.author)).toEqual(['Augustine', 'Jerome']);
        const prefix = splitChain([{ text: 'word of preaching. PSEU DO- JEROME ; Or else, Prepare ye the way. PSEU DO-', margin: '' }, { text: 'JEROME; Jesus is called the son of a workman.', margin: '' }], emptyReport());
        expect(prefix.map((e) => e.author)).toEqual(['Pseudo-Jerome', 'Pseudo-Jerome']);
        const tail = splitChain([{ text: 'than this. de AUG. Matthew shortly says, They parted his garments.', margin: '' }], emptyReport());
        expect(tail.find((e) => e.author === 'Augustine')?.text).toBe('Matthew shortly says, They parted his garments.');
        expect(tail.some((e) => /\bde\b/.test(e.text))).toBe(false);
        const glued = splitChain([
            { text: 'a man. THEOPHYL. Not an Angel, as many have held.', margin: '' },
            { text: 'Aug. The Evangelist here refutes such a notion. AUG. And how', margin: '' },
            { text: 'could he declare the truth concerning God. CHRYS.', margin: '' },
            { text: 'Chrys. That our Lord then had this knowledge, had penetrated', margin: '' },
            { text: 'into his mind, as Aug. says too. ORIGEN; Or thus.', margin: '' },
        ], emptyReport());
        expect(glued.map((e) => e.author + ': ' + e.text.slice(0, 30))).toEqual([
            'Theophylact: Not an Angel, as many have hel', 'Augustine: And how could he declare the t', 'Chrysostom: That our Lord then had this kn', 'Origen: Or thus.',
        ]);
        expect(glued[2].text).toContain('as Aug. says too.');
        expect(splitChain([{ text: 'to his son Joseph.', margin: '' }, { text: "Aug Now Jacob's well was there. AUG. It was a well.", margin: '' }], emptyReport()).map((e) => e.author + ': ' + e.text)).toEqual(["?: to his son Joseph. Now Jacob's well was there.", 'Augustine: It was a well.'].slice(1));
        const luke = splitChain([{ text: 'AUG. One. Tir. Bos. Two. Tirus Bosr. Three. sCHRys. Four. EPIpH. Five. secret watchings.AMBRosE; Six. Am-', margin: '' }, { text: 'BRosE; Seven.', margin: '' }], emptyReport());
        expect(luke.map((e) => e.author)).toEqual(['Augustine', 'Titus of Bostra', 'Titus of Bostra', 'Chrysostom', 'Epiphanius', 'Ambrose', 'Ambrose']);
        const mark = splitChain([{ text: 'AUG. One. G REG. Two. vPsEUDO-CHRYs. Three. BED*; Four. Consolation. BEDE Christ is still here.', margin: '' }], emptyReport());
        expect(mark.map((e) => e.author)).toEqual(['Augustine', 'Gregory', 'Pseudo-Chrysostom', 'Bede', 'Bede']);
        const marks = splitChain([{ text: 'AUG. One. AMBROSE*1; Two. JEROME ^ Three. \u2022JEROME Four is here.', margin: '' }], emptyReport());
        expect(marks.map((e) => e.author)).toEqual(['Augustine', 'Ambrose', 'Jerome', 'Jerome']);
        const damaged = splitChain([{ text: 'AUG. One. PSECJDO-CHRYS. Two. PsEuno-CHRYS. Three. PSEUDO_CHRYS. Four. PsEUDO-CHRYS.cjtt Five. PSKUDO-JEROME; Six.', margin: '' }], emptyReport());
        expect(damaged.map((e) => e.author)).toEqual(['Augustine', 'Pseudo-Chrysostom', 'Pseudo-Chrysostom', 'Pseudo-Chrysostom', 'Pseudo-Chrysostom', 'Pseudo-Jerome']);
        expect(damaged[4].text).toBe('Five.');
        expect(resolveAuthor('CHRVSOLOG')?.name).toBe('Peter Chrysologus');
        expect(resolveAuthor('LET')).toBeNull();
    });

    it('takes RapidOCR\'s small capitals: random case, broken, a stray stroke before, a colon or nothing for the mark', () => {
        const ex = splitChain([{ text: 'AUG. One. JeRo ME; Two. H1LA Ry; Three. .JeRoMe; Four. ICHRYS. Five. lORIGEN; Six. CHRys: Seven. BeDE\'; Eight. PseuDo-CHrys\u00b0. Nine. Ip. Ten. AuG Eleven is here. GREGoRY Twelve.', margin: '' }], emptyReport());
        expect(ex.map((e) => e.author)).toEqual(['Augustine', 'Jerome', 'Hilary', 'Jerome', 'Chrysostom', 'Origen', 'Chrysostom', 'Bede', 'Pseudo-Chrysostom', 'Pseudo-Chrysostom', 'Augustine']);
        expect(ex[10].text).toBe('Eleven is here. GREGoRY Twelve.');
    });

    it('reads a chapter head whose numeral the recogniser wrote with digit ones', () => {
        const pages = [page(82, line('CHAP. 11.'), line('1. And it came to pass in those days', { indent: 90, h: 59 }), line('BEDE; A decree.'), ...body(6), line('CHAP. 1II.'), line('1. Now in the fifteenth year', { indent: 90, h: 59 }), line('BEDE; Tiberius.'), ...body(4))];
        expect(parseCatenaPages(pages, 'item', { 1: 80, 2: 52, 3: 38 }, emptyReport(), { firstChapter: 1 }).map((b) => b.chapter)).toEqual([2, 3]);
    });

    it('stops at the volume\'s errata', () => {
        const pages = [page(420, line('CHAP. I.'), line('1. In the beginning was the Word', { indent: 90, h: 59 }), line('BEDE; A start.'), ...body(6), line('ERRATA, PART I.', { indent: 400, h: 44 }), line('1. Page 34, for by read through', { indent: 90, h: 59 }), line('BEDE; more'))];
        expect(parseCatenaPages(pages, 'item', { 1: 51 })).toHaveLength(1);
    });

    it('applies a line correction before parsing, exactly once', () => {
        const pages = [page(181, line('CHAP. XVI.'), line('1. The Pharisees also came', { indent: 90, h: 59 }), line('CHRYS. As the Lord sent them away. Auo. Mark suys Dalmanutha.'), ...body(6))];
        const fixed = parseCatenaPages(pages, 'item', { 16: 28 }, emptyReport(), { lineCorrections: [{ item: 'item', leaf: 181, find: 'Auo. Mark suys', replace: 'AUG. Mark says' }] });
        expect(fixed[0].excerpts.map((e) => `${e.author}: ${e.text.slice(0, 22).trim()}`)).toEqual(["Chrysostom: As the Lord sent them", "Augustine: Mark says Dalmanutha."]);
        expect(() => parseCatenaPages(pages, 'item', { 16: 28 }, emptyReport(), { lineCorrections: [{ item: 'item', leaf: 182, find: 'Auo. Mark suys', replace: 'AUG. Mark says' }] })).toThrow(/applied 0 times/);
    });

    it('reads a part\'s first head against the chapter the scan map says it opens with', () => {
        const part = (head: string) => [page(12, line(head), line('1. Now a certain man was sick, named Lazarus', { indent: 90, h: 59 }), line('AUG. The Lord raised him.'), ...body(6))];
        const report = emptyReport();
        expect(parseCatenaPages(part('CHAP. XL'), 'john2', { 11: 57, 12: 50 }, report, { firstChapter: 11 })[0].chapter).toBe(11);
        expect(report.repairedTokens).toEqual({ 'CHAP. XL': 'CHAP. XI' });
        expect(parseCatenaPages(part('CHAP. XII.'), 'john2', { 11: 57, 12: 50 }, emptyReport(), { firstChapter: 11 })[0].chapter).toBe(12);
        expect(parseCatenaPages(part('CHAP. XL'), 'john2', { 11: 57, 40: 1 }, emptyReport())[0].chapter).toBe(40);
    });

    it('knows the three-word names, repairs a wrong first glyph on small capitals, and reads a mixed-case name before a plain word as a mention', () => {
        const ex = splitChain([{ text: 'AUG. Ears could not endure it. CYRIL OF ALEXANDRIA; Saith the Apostle. He cites the Gloss, for when he wrote it was done. Chrys, Observe how He teaches.', margin: '' }], emptyReport());
        expect(ex.map((e) => e.author)).toEqual(['Augustine', 'Cyril of Alexandria', 'Chrysostom']);
        expect(ex[1].text).toBe('Saith the Apostle. He cites the Gloss, for when he wrote it was done.');
        expect(resolveAuthor('JlABANUS')?.name).toBe('Rabanus');
        expect(resolveAuthor('HABAN')?.name).toBe('Rabanus');
        expect(resolveAuthor('Tit. Bost')?.name).toBe('Titus of Bostra');
    });
});
