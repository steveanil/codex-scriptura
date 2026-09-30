import { describe, it, expect } from 'vitest';
import { parseTranscription, running, errorRates, lineMatch, judge } from './catena-benchmark.js';

describe('Catena OCR benchmark scoring (issue #85)', () => {
    it('reads a transcription and its sections', () => {
        const t = parseTranscription('# item: scan\n# leaf: 53\n# drafted: A, 2026-09-30\n# checked: B, 2026-10-01\n== text\nAUG. Whilst Judas was plot-\nting, the rest\n== margin\nAug. in\nJoan.\n');
        expect(t).toMatchObject({ item: 'scan', leaf: 53, checked: 'B, 2026-10-01', text: ['AUG. Whilst Judas was plot-', 'ting, the rest'], margin: ['Aug. in', 'Joan.'], footnotes: [] });
        expect(running(t.text)).toBe('AUG. Whilst Judas was plotting, the rest');
    });

    it('measures characters and words against the page', () => {
        expect(errorRates('the Word was', 'the Word was')).toMatchObject({ cer: 0, wer: 0 });
        expect(errorRates('the Word was', 'the W word was').wer).toBeCloseTo(2 / 3);
        expect(errorRates('abcd', 'abxd').cer).toBeCloseTo(0.25);
    });

    it('finds a printed line no OCR line reads, and one read twice', () => {
        const page = ['And rightly an angel is sent to the virgin', 'virgin state is ever akin to that of angels', 'Surely in the virgin'];
        expect(lineMatch(page, ['And rightly an angel is sent to the virgin', 'And rightly an angel is sent to the virgin', 'Surely in the virgin'])).toEqual({ missing: ['virgin state is ever akin to that of angels'], twice: ['And rightly an angel is sent to the virgin'] });
    });

    it('judges a change by the page: made where the page agrees, harmful where it keeps what was read', () => {
        const page = 'Where wilt thou that we go, and whenever I attempt any thing';
        expect(judge({ from: 'Where uilt thou that', to: 'Where wilt thou that' }, page)).toBe('agrees');
        expect(judge({ from: 'Where wilt thou that', to: 'Where will thou that' }, page)).toBe('contradicts');
        expect(judge({ from: 'whenever I attempt', to: 'whenever attempt' }, page)).toBe('contradicts');
        expect(judge({ from: 'no such words', to: 'none such here' }, page)).toBe('unclear');
    });
});
