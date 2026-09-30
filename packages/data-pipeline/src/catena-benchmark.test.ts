import { describe, it, expect } from 'vitest';
import { parseTranscription, running, errorRates, wordBagError, alignLines, lineMatch, readerPageText, judge, regionFor } from './catena-benchmark.js';
import { Traced } from './importers/transform-log.js';

describe('Catena OCR benchmark scoring (issue #85)', () => {
    it('reads a transcription and its sections', () => {
        const t = parseTranscription('# item: scan\n# leaf: 53\n# drafted: A, 2026-09-30\n# checked: B, 2026-10-01\n== text\nAUG. Whilst Judas was plot-\nting, the rest\n== margin\nAug. in\nJoan.\n');
        expect(t).toMatchObject({ item: 'scan', leaf: 53, checked: 'B, 2026-10-01', text: ['AUG. Whilst Judas was plot-', 'ting, the rest'], margin: ['Aug. in', 'Joan.'], footnotes: [] });
        expect(running(t.text)).toBe('AUG. Whilst Judas was plotting, the rest');
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
