import { describe, it, expect, beforeEach } from 'vitest';
import type { VerseRecord } from '@codex-scriptura/core';
import {
    computeDivergence,
    computeChapterDivergence,
    chapterDivergenceKey,
    hasDivergence,
    clearDivergenceCache,
    buildChapterRows,
    buildDivergenceCards,
} from './divergence';

function verse(translationId: string, text: string, osisId = 'Gen.1.1'): VerseRecord {
    const num = Number(osisId.split('.')[2]) || 1;
    return { id: `${translationId}.${osisId}`, translationId, book: 'Gen', chapter: 1, verse: num, osisId, text };
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

describe('buildChapterRows', () => {
    it('aligns the union of verse numbers in canonical order', () => {
        const rows = buildChapterRows([
            { translation: 'A', verses: [verse('A', 'one', 'Gen.1.1'), verse('A', 'three', 'Gen.1.3')] },
            { translation: 'B', verses: [verse('B', 'two', 'Gen.1.2'), verse('B', 'three', 'Gen.1.3')] },
        ]);
        expect(rows.map((r) => r.num)).toEqual([1, 2, 3]);
        expect(rows.map((r) => r.osisId)).toEqual(['Gen.1.1', 'Gen.1.2', 'Gen.1.3']);
    });

    it('leaves cells empty where a translation lacks the verse, preserving source order', () => {
        const rows = buildChapterRows([
            { translation: 'A', verses: [verse('A', 'one', 'Gen.1.1')] },
            { translation: 'B', verses: [verse('B', 'uno', 'Gen.1.1'), verse('B', 'dos', 'Gen.1.2')] },
        ]);
        expect(rows[0].cells.map((c) => c.translation)).toEqual(['A', 'B']);
        expect(rows[1].cells[0].verse).toBeUndefined();
        expect(rows[1].cells[1].verse?.text).toBe('dos');
        // osisId comes from the first PRESENT cell
        expect(rows[1].osisId).toBe('Gen.1.2');
    });
});

describe('buildDivergenceCards', () => {
    it('lists med/high rows only, highest severity first then canonical order', async () => {
        clearDivergenceCache();
        const rows = buildChapterRows([
            { translation: 'A', verses: [
                verse('A', 'totally different everywhere', 'Gen.1.1'),   // high
                verse('A', 'the earth was waste and void here', 'Gen.1.2'), // low-ish
                verse('A', 'he charged them strictly', 'Gen.1.3'),        // high
            ] },
            { translation: 'B', verses: [
                verse('B', 'nothing shared at all', 'Gen.1.1'),
                verse('B', 'the earth was waste and void here', 'Gen.1.2'),
                verse('B', 'he gave firm orders', 'Gen.1.3'),
            ] },
        ]);
        const dv = await computeChapterDivergence(chapterDivergenceKey('Gen', 1, ['A', 'B']), rows);
        const cards = buildDivergenceCards(rows, dv);
        expect(cards.map((c) => c.num)).toEqual([1, 3]); // identical v2 excluded
        expect(cards.every((c) => c.severity !== 'low')).toBe(true);
        expect(cards[0].renders.map((r) => r.translation)).toEqual(['A', 'B']);
        expect(cards[0].renders[1].text).toBe('nothing shared at all');
    });

    it('drops renders whose translation lacks the verse', async () => {
        clearDivergenceCache();
        // C has no Gen.1.1 - the card still lists A and B, never an empty C row
        const rows = buildChapterRows([
            { translation: 'A', verses: [verse('A', 'he charged them strictly', 'Gen.1.1')] },
            { translation: 'B', verses: [verse('B', 'he gave firm orders', 'Gen.1.1')] },
            { translation: 'C', verses: [verse('C', 'elsewhere entirely', 'Gen.1.2')] },
        ]);
        const dv = await computeChapterDivergence(chapterDivergenceKey('Gen', 1, ['A', 'B', 'C']), rows);
        const cards = buildDivergenceCards(rows, dv);
        const card = cards.find((c) => c.num === 1);
        expect(card).toBeDefined();
        expect(card!.renders.map((r) => r.translation)).toEqual(['A', 'B']);
    });
});

describe('computeChapterDivergence', () => {
    beforeEach(() => clearDivergenceCache());

    it('computes one entry per verse row, keyed by osisId', async () => {
        const rows = buildChapterRows([
            { translation: 'A', verses: [verse('A', 'alpha beta', 'Gen.1.1'), verse('A', 'same words', 'Gen.1.2')] },
            { translation: 'B', verses: [verse('B', 'alpha gamma', 'Gen.1.1'), verse('B', 'same words', 'Gen.1.2')] },
        ]);
        const map = await computeChapterDivergence(chapterDivergenceKey('Gen', 1, ['A', 'B']), rows);
        expect(map.size).toBe(2);
        expect(hasDivergence(map.get('Gen.1.1')!)).toBe(true);
        expect(hasDivergence(map.get('Gen.1.2')!)).toBe(false);
    });

    it('memoizes identical content under the same key, translation order irrelevant', async () => {
        const key1 = chapterDivergenceKey('Gen', 1, ['B', 'A']);
        const key2 = chapterDivergenceKey('Gen', 1, ['A', 'B']);
        expect(key1).toBe(key2);
        const rows = buildChapterRows([
            { translation: 'A', verses: [verse('A', 'x y')] },
            { translation: 'B', verses: [verse('B', 'x z')] },
        ]);
        const first = await computeChapterDivergence(key1, rows);
        const second = await computeChapterDivergence(key2, rows);
        expect(second).toBe(first); // cached object, no recompute
    });

    it('never serves stale spans when the text changes under the same key', async () => {
        const key = chapterDivergenceKey('Gen', 1, ['A', 'B']);
        const before = buildChapterRows([
            { translation: 'A', verses: [verse('A', 'the earth was waste')] },
            { translation: 'B', verses: [verse('B', 'the earth was formless')] },
        ]);
        const first = await computeChapterDivergence(key, before);
        expect(hasDivergence(first.get('Gen.1.1')!)).toBe(true);

        // Same location + translations, re-imported text now agrees
        const after = buildChapterRows([
            { translation: 'A', verses: [verse('A', 'the earth was formless')] },
            { translation: 'B', verses: [verse('B', 'the earth was formless')] },
        ]);
        const second = await computeChapterDivergence(key, after);
        expect(second).not.toBe(first);
        expect(hasDivergence(second.get('Gen.1.1')!)).toBe(false);
    });
});
