import { describe, it, expect } from 'vitest';
import { parseTranscription, running, errorRates, wordBagError, recogniserDiscrepancy, alignLines, lineMatch, readerPageText, judge, regionFor, aggregate } from './catena-benchmark.js';
import { Traced } from './importers/transform-log.js';
import { splitChain, emptyReport } from './importers/catena-aurea.js';

describe('Catena OCR benchmark scoring (issue #85)', () => {
    it('reads a transcription and its sections', () => {
        const t = parseTranscription('# item: scan\n# leaf: 53\n# drafted: A, 2026-09-30\n# checked: B, 2026-10-01\n== text\nAUG. Whilst Judas was plot-\nting, the rest\n== margin\nAug. in\nJoan.\n');
        expect(t).toMatchObject({ item: 'scan', leaf: 53, checked: 'B, 2026-10-01', text: ['AUG. Whilst Judas was plot-', 'ting, the rest'], joins: ['break', null], margin: ['Aug. in', 'Joan.'], footnotes: [] });
        expect(running(t.text, t.joins)).toBe('AUG. Whilst Judas was plotting, the rest');
        // Without the transcription's marks the lines are only set side by side: no hyphen is guessed away
        expect(running(t.text)).toBe('AUG. Whilst Judas was plot- ting, the rest');
        // "-=" marks a hyphenated word, whose hyphen stays
        const compound = parseTranscription('# item: s\n# leaf: 1\n# checked: B\n== text\nJEROME. The life-=\ngiving Spirit.\n');
        expect(compound.text).toEqual(['JEROME. The life-', 'giving Spirit.']);
        expect(running(compound.text, compound.joins)).toBe('JEROME. The life-giving Spirit.');
    });

    it('measures characters and words, and says so when there is nothing to measure against', () => {
        expect(errorRates('the Word was', 'the Word was')).toMatchObject({ cer: 0, wer: 0 });
        expect(errorRates('the Word was', 'the W word was').wer).toBeCloseTo(2 / 3);
        expect(errorRates('abcd', 'abxd').cer).toBeCloseTo(0.25);
        // Margin words the recogniser invented where the page prints none are counted, not scored as perfect
        expect(errorRates('', 'Aug. Serm.')).toMatchObject({ cer: null, wer: null, charEdits: 10, wordEdits: 2 });
        expect(wordBagError(['the', 'Word', 'was'], ['the', 'W', 'word', 'was'])).toEqual({ rate: 1, missing: 1, extra: 2 });
        expect(wordBagError([], ['x']).rate).toBeNull();
    });

    it('pools each stage over its own reference length, so one page pooled is that page\'s score', () => {
        const t = parseTranscription('# item: s\n# leaf: 1\n# checked: B\n== text\nJEROME. The life-=\ngiving Spirit.\n');
        const page = errorRates(running(t.text), 'JEROME. The life- giving Spirit.');
        const complete = errorRates(running(t.text, t.joins), 'JEROME. The life-giving Spirit!');
        expect([page.chars, complete.chars]).toEqual([32, 31]);
        const one = aggregate([{ recogniser: { edits: 0, words: 5 }, page, complete }]);
        expect(one).toEqual({ recogniser: 0, pageCer: page.cer, pageWer: page.wer, completeCer: complete.cer, completeWer: complete.wer });
        expect(one.completeCer).toBeCloseTo(1 / 31);
        // Two pages pool edits over lengths, not an average of rates
        const two = aggregate([{ recogniser: { edits: 1, words: 10 }, page, complete }, { recogniser: { edits: 0, words: 30 }, page: errorRates('ab', 'ab'), complete: errorRates('abcdefghij', 'abcdefghij') }]);
        expect(two.completeCer).toBeCloseTo(1 / 41);
        expect(two.recogniser).toBeCloseTo(1 / 40);
        expect(aggregate([])).toEqual({ recogniser: null, pageCer: null, pageWer: null, completeCer: null, completeWer: null });
    });

    it('matches lines in order, so a line printed twice is two lines, and finds one missing or read twice', () => {
        expect(lineMatch(['Lord have mercy', 'Lord have mercy'], ['Lord have mercy', 'Lord have mercy'])).toEqual({ missing: [], twice: [] });
        const page = ['And rightly an angel is sent to the virgin', 'virgin state is ever akin to that of angels', 'Surely in the virgin'];
        expect(lineMatch(page, ['And rightly an angel is sent to the virgin', 'And rightly an angel is sent to the virgin', 'Surely in the virgin'])).toEqual({ missing: ['virgin state is ever akin to that of angels'], twice: ['And rightly an angel is sent to the virgin'] });
        expect(alignLines(['a b c', 'd e f'], ['d e f', 'a b c'])).toEqual([-1, 0]);
    });

    it("builds the page as the complete reader leaves it: chain text for the lines it covers, the page reader's for the rest", () => {
        const sources: { leaf: number; y: number }[] = [];
        const chain = Traced.read('AUG. The Lord', { leaf: 4, y: 900 }, 0, sources).concat(' ').concat(Traced.read('came down.', { leaf: 5, y: 100 }, 0, sources)).concat(' ').concat(Traced.read('JEROME. And', { leaf: 5, y: 160 }, 0, sources));
        const lines = [{ y: 40, main: '12. And he came down' }, { y: 100, main: 'came d0wn.' }, { y: 160, main: 'JER0ME. And' }];
        expect(readerPageText(lines, [chain], 5)).toBe('12. And he came down came down. JEROME. And');
    });

    it('judges a change in the printed line it was made on, never by the same word elsewhere on the page', () => {
        const printed = ['It will rain.', 'Where wilt thou go', 'at the feet of the Word, that is'];
        const read = [{ y: 100, text: 'It will rain.' }, { y: 160, text: 'Where wilt thou go' }, { y: 220, text: 'at the feet of the W word, that is' }];
        const of = alignLines(printed, read.map((l) => l.text));
        // "wilt" made "will" on the second line: the page's "will" in the line above is no evidence
        expect(judge({ from: 'wilt', to: 'will' }, regionFor(160, read, printed, of, false))).toBe('contradicts');
        expect(judge({ from: 'wilt', to: 'will' }, 'It will rain.')).toBe('agrees');
        // Case is kept: the capital of Word is the point of the change
        expect(judge({ from: 'of the W word, that', to: 'of the Word, that' }, regionFor(220, read, printed, of))).toBe('agrees');
        expect(judge({ from: 'of the W word, that', to: 'of the word, that' }, regionFor(220, read, printed, of))).toBe('unclear');
        // Without an aligned line the change is not judged
        expect(judge({ from: 'wilt', to: 'will' }, regionFor(900, read, printed, of))).toBe('unclear');
        expect(judge({ from: 'whenever I attempt', to: 'whenever attempt' }, 'and whenever I attempt any thing')).toBe('contradicts');
    });
});

describe('properties the benchmark and the reader\'s tracing must keep', () => {
    // Chains in the shapes that have gone wrong: a line the reader takes out whole, a mark opening a page, "W word"
    // broken over a page, a word broken over a line, marks before tokens
    const chains: Array<Array<{ text: string; margin: string; leaf: number; y: number; col: number }>> = [
        [{ text: 'JEROME. The Lord', leaf: 10, y: 1800 }, { text: 't', leaf: 10, y: 1860 }, { text: 'came down.', leaf: 10, y: 1920 }],
        [{ text: 'JEROME. The Lord came down', leaf: 10, y: 1800 }, { text: 't spoke to them.', leaf: 11, y: 220 }],
        [{ text: 'AUG. He said, JEROME. the W', leaf: 10, y: 1800 }, { text: 'word was made flesh.', leaf: 11, y: 220 }],
        [{ text: 'CHRYS. They were com-', leaf: 20, y: 400 }, { text: 'manded to go. s JEROME; Not so. 1 He', leaf: 20, y: 460 }, { text: 'went up.', leaf: 21, y: 100 }],
        // A token closing a page, whose period the reader restores, and a hyphenated word it keeps
        [{ text: 'JEROME. He came. AUG', leaf: 30, y: 2700 }, { text: 'The Lord said.', leaf: 31, y: 120 }],
        [{ text: 'JEROME. The life-', leaf: 40, y: 900 }, { text: 'giving Spirit.', leaf: 40, y: 960 }],
    ].map((c) => c.map((l) => ({ ...l, margin: '', col: 0 })));
    const english = new Set(['life', 'giving', 'the', 'spirit']);
    const run = (chain: (typeof chains)[number]) => {
        let final: Traced | undefined;
        splitChain(chain, emptyReport(), undefined, undefined, () => true, english, undefined, (t) => { final = t; });
        return final!;
    };

    it('scores identical recognition as no error, whatever the page breaks', () => {
        for (const lines of [['The Lord was plot-', 'ting nothing.'], ['AUG. One', '', 'two  three'], ['Lord have mercy', 'Lord have mercy']]) {
            expect(recogniserDiscrepancy(lines, lines).rate).toBe(0);
            const text = running(lines);
            expect(errorRates(text, text)).toMatchObject({ cer: 0, wer: 0 });
            expect(lineMatch(lines.filter(Boolean), lines.filter(Boolean))).toEqual({ missing: [], twice: [] });
        }
    });

    it('scores every character the chain kept or added exactly once across its pages', () => {
        for (const chain of chains) {
            const final = run(chain);
            const leaves = [...new Set(chain.map((l) => l.leaf))];
            const pages = leaves.map((leaf) => readerPageText(chain.filter((l) => l.leaf === leaf).map((l) => ({ y: l.y, main: l.text })), [final], leaf));
            // Characters, whitespace aside: a word the page break divides is scored in its halves
            expect(pages.join('').replace(/\s+/g, '')).toBe(final.text.replace(/\s+/g, ''));
        }
        // The restored period is scored on the page that closes with the token
        const token = run(chains[4]);
        expect(token.text.trim()).toBe('JEROME. He came. AUG. The Lord said.');
        expect(readerPageText([{ y: 2700, main: 'JEROME. He came. AUG' }], [token], 30)).toBe('JEROME. He came. AUG.');
        // A hyphenated word the reader keeps scores as right against a transcription that marks it so
        const page = readerPageText([{ y: 900, main: 'JEROME. The life-' }, { y: 960, main: 'giving Spirit.' }], [run(chains[5])], 40);
        const t = parseTranscription('# item: s\n# leaf: 40\n# checked: B\n== text\nJEROME. The life-=\ngiving Spirit.\n');
        expect(errorRates(running(t.text, t.joins), page)).toMatchObject({ cer: 0, wer: 0 });
    });

    it('never puts back text the reader took out', () => {
        for (const chain of chains) {
            const final = run(chain);
            for (const leaf of new Set(chain.map((l) => l.leaf))) {
                const page = readerPageText(chain.filter((l) => l.leaf === leaf).map((l) => ({ y: l.y, main: l.text })), [final], leaf);
                // The page's scored text is a stretch of what the chain kept: nothing the reader took out comes back
                expect(final.text.replace(/\s+/g, ' ')).toContain(page);
            }
        }
        expect(readerPageText([{ y: 1800, main: 'JEROME. The Lord' }, { y: 1860, main: 't' }, { y: 1920, main: 'came down.' }], [run(chains[0])], 10)).toBe('JEROME. The Lord came down.');
        // A word broken over a page is scored in its halves, each on the page that prints it
        expect([10, 11].map((leaf) => readerPageText(chains[2].filter((l) => l.leaf === leaf).map((l) => ({ y: l.y, main: l.text })), [run(chains[2])], leaf))).toEqual(['AUG. He said, JEROME. the W', 'ord was made flesh.']);
    });

    it('keeps each surviving character at the place it was read', () => {
        for (const chain of chains) {
            const final = run(chain);
            const line = new Map(chain.map((l) => [`${l.leaf}@${l.y}`, l.text]));
            for (let i = 0; i < final.text.length; i++) {
                const s = final.sourceAt(i);
                // "1 He" read as "I He" is a substitution; every other character is the one read there
                if (s && final.text[i] !== 'I') expect(`${final.text[i]} at ${s.leaf}@${s.y}:${s.col}`).toBe(`${line.get(`${s.leaf}@${s.y}`)![s.col]} at ${s.leaf}@${s.y}:${s.col}`);
            }
        }
        const word = run(chains[2]);
        const at = word.text.indexOf('Word');
        expect([...'Word'].map((_, k) => word.sourceAt(at + k)).map((s) => `${s!.leaf}:${s!.col}`)).toEqual(['10:26', '11:1', '11:2', '11:3']);
    });
});
