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
        expect(blocks.map((b) => `${b.verseStart}-${b.verseEnd}`)).toEqual(['1-1', '1-1']);
        expect(blocks[1].lemma).toBe('and the Word was with God,');
        expect(blocks[1].excerpts[0].author).toBe('Hilary');
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
        const out = applyCorrections(blocks(), [{ item: 'item', chapter: 3, verseStart: 4, verseEnd: 4, excerpt: 1, find: 'arid honey', replace: 'and honey', leaf: 9 }], 'item');
        expect(out[0].excerpts[0].text).toBe('and honey has sweetness.');
    });

    it('refuses a correction whose text, block, excerpt or leaf does not match', () => {
        const c = { item: 'item', chapter: 3, verseStart: 4, verseEnd: 4, excerpt: 1, find: 'arid honey', replace: 'and honey', leaf: 9 };
        expect(() => applyCorrections(blocks(), [{ ...c, find: 'no such text' }], 'item')).toThrow(/not found/);
        expect(() => applyCorrections(blocks(), [{ ...c, verseEnd: 5 }], 'item')).toThrow(/not parsed/);
        expect(() => applyCorrections(blocks(), [{ ...c, excerpt: 2 }], 'item')).toThrow(/excerpt 2 of a block with 1/);
        expect(() => applyCorrections(blocks(), [{ ...c, leaf: 10 }], 'item')).toThrow(/read from leaf 10/);
        expect(() => applyCorrections(blocks(), [{ ...c, find: 'a' }], 'item')).toThrow(/ambiguous/);
        expect(applyCorrections(blocks(), [{ ...c, item: 'other' }], 'item')[0].excerpts[0].text).toContain('arid');
    });
});
