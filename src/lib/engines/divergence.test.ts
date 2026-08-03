import { describe, it, expect, beforeEach } from 'vitest';
import type { VerseRecord } from '@codex-scriptura/core';
import { computeDivergence, computeChapterDivergence, chapterDivergenceKey, hasDivergence, clearDivergenceCache } from './divergence';

function verse(translationId: string, text: string, osisId = 'Gen.1.1'): VerseRecord {
    return { id: `${translationId}.${osisId}`, translationId, book: 'Gen', chapter: 1, verse: 1, osisId, text };
}

describe('computeDivergence', () => {
    it('reports identical renderings as low with no spans', () => {
        const d = computeDivergence({
            A: verse('A', 'In the beginning God created the heavens.'),
            B: verse('B', 'In the beginning God created the heavens.'),
        });
        expect(d.severity).toBe('low');
        expect(d.spans).toEqual({});
        expect(hasDivergence(d)).toBe(false);
    });

    it('ignores case, punctuation, and whitespace differences', () => {
        const d = computeDivergence({
            A: verse('A', 'And God said, Let there be light!'),
            B: verse('B', 'and god said   let there be LIGHT'),
        });
        expect(d.spans).toEqual({});
    });

    it('marks differing tokens with char spans into the original text', () => {
        const a = 'the earth was waste and void';
        const b = 'the earth was formless and void';
        const d = computeDivergence({ A: verse('A', a), B: verse('B', b) });
        expect(d.spans.A).toEqual([[a.indexOf('waste'), a.indexOf('waste') + 'waste'.length]]);
        expect(d.spans.B).toEqual([[b.indexOf('formless'), b.indexOf('formless') + 'formless'.length]]);
        expect(d.verseId).toBe('Gen.1.1');
    });

    it('fuses consecutive divergent tokens into one span', () => {
        const a = 'he spake unto them kindly';
        const b = 'he spoke to them kindly';
        const d = computeDivergence({ A: verse('A', a), B: verse('B', b) });
        expect(d.spans.A).toEqual([[a.indexOf('spake'), a.indexOf('spake') + 'spake unto'.length]]);
    });

    it('uses majority voting across three translations', () => {
        // "waste" appears in 2 of 3 - majority, not divergent; "formless" in 1 of 3 - divergent
        const d = computeDivergence({
            A: verse('A', 'the earth was waste'),
            B: verse('B', 'the earth was waste'),
            C: verse('C', 'the earth was formless'),
        });
        expect(d.spans.A).toBeUndefined();
        expect(d.spans.B).toBeUndefined();
        expect(d.spans.C).toEqual([[Number('the earth was '.length), Number('the earth was formless'.length)]]);
    });

    it('grades severity by the worst per-translation divergent ratio', () => {
        const low = computeDivergence({
            A: verse('A', 'for God so loved the world that he gave his only Son'),
            B: verse('B', 'for God so loved the world that he gave his only begotten Son'),
        });
        expect(low.severity).toBe('low');

        const high = computeDivergence({
            A: verse('A', 'he charged them strictly'),
            B: verse('B', 'he gave firm orders'),
        });
        expect(high.severity).toBe('high');
    });

    it('returns an empty result for fewer than two translations', () => {
        const d = computeDivergence({ A: verse('A', 'anything at all') });
        expect(d.severity).toBe('low');
        expect(d.spans).toEqual({});
    });
});

describe('computeChapterDivergence', () => {
    beforeEach(() => clearDivergenceCache());

    it('computes one entry per verse row, keyed by osisId', async () => {
        const rows = [
            { A: verse('A', 'alpha beta', 'Gen.1.1'), B: verse('B', 'alpha gamma', 'Gen.1.1') },
            { A: verse('A', 'same words', 'Gen.1.2'), B: verse('B', 'same words', 'Gen.1.2') },
        ];
        const map = await computeChapterDivergence(chapterDivergenceKey('Gen', 1, ['A', 'B']), rows);
        expect(map.size).toBe(2);
        expect(hasDivergence(map.get('Gen.1.1')!)).toBe(true);
        expect(hasDivergence(map.get('Gen.1.2')!)).toBe(false);
    });

    it('memoizes by key, translation order irrelevant', async () => {
        const key1 = chapterDivergenceKey('Gen', 1, ['B', 'A']);
        const key2 = chapterDivergenceKey('Gen', 1, ['A', 'B']);
        expect(key1).toBe(key2);
        const rows = [{ A: verse('A', 'x y'), B: verse('B', 'x z') }];
        const first = await computeChapterDivergence(key1, rows);
        const second = await computeChapterDivergence(key2, []);
        expect(second).toBe(first); // cached object, no recompute
    });
});
