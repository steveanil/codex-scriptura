import { describe, expect, it } from 'vitest';
import type { Annotation } from '@codex-scriptura/core';
import { coveringAnnotations, planHighlight } from './selection';

function hl(id: string, start: string, end: string, color = 'yellow'): Annotation {
    return {
        id, type: 'highlight', book: 'Gen', verseStart: start, verseEnd: end, data: '', color,
        translation: 'KJV', tags: [], created: 1, modified: 1, synced: false,
    };
}

describe('coveringAnnotations', () => {
    const note: Annotation = { ...hl('n1', 'Gen.1.4', 'Gen.1.6'), type: 'note', data: 'x' };
    const anns = [hl('h1', 'Gen.1.1', 'Gen.1.3'), note, hl('h2', 'Gen.1.20', 'Gen.2.2')];

    it('returns annotations of the type that touch any selected verse', () => {
        expect(coveringAnnotations(1, [3, 4], anns, 'highlight').map((a) => a.id)).toEqual(['h1']);
        expect(coveringAnnotations(1, [3, 4], anns, 'note').map((a) => a.id)).toEqual(['n1']);
        expect(coveringAnnotations(2, [1], anns, 'highlight').map((a) => a.id)).toEqual(['h2']);
        expect(coveringAnnotations(1, [10], anns, 'highlight')).toEqual([]);
    });
});

describe('planHighlight', () => {
    const base = { book: 'Gen', chapter: 1, translation: 'KJV', now: 50 };

    it('creates one highlight per contiguous run when nothing is highlighted', () => {
        const out = planHighlight({ ...base, verses: [1, 2, 5], color: 'blue', visible: [] });
        expect(out.map((a) => [a.verseStart, a.verseEnd, a.color, a.translation])).toEqual([
            ['Gen.1.1', 'Gen.1.2', 'blue', 'KJV'],
            ['Gen.1.5', 'Gen.1.5', 'blue', 'KJV'],
        ]);
        expect(new Set(out.map((a) => a.id)).size).toBe(2);
    });

    it('recolours a highlight the selection sits on, keeping its id and range, with no second record', () => {
        const existing = hl('h1', 'Gen.1.1', 'Gen.1.3');
        const out = planHighlight({ ...base, verses: [2], color: 'blue', visible: [existing] });
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ id: 'h1', color: 'blue', verseStart: 'Gen.1.1', verseEnd: 'Gen.1.3', created: 1 });
        expect(existing.color).toBe('yellow');
    });

    it('recolours the covered part and creates only for the uncovered verses', () => {
        const out = planHighlight({ ...base, verses: [3, 4, 5], color: 'blue', visible: [hl('h1', 'Gen.1.1', 'Gen.1.3')] });
        expect(out.map((a) => [a.id === 'h1' ? 'h1' : 'new', a.verseStart, a.verseEnd])).toEqual([
            ['h1', 'Gen.1.1', 'Gen.1.3'],
            ['new', 'Gen.1.4', 'Gen.1.5'],
        ]);
    });

    it('writes nothing when the colour is already the one chosen', () => {
        expect(planHighlight({ ...base, verses: [1], color: 'yellow', visible: [hl('h1', 'Gen.1.1', 'Gen.1.3')] })).toEqual([]);
    });

    it('recolours a legacy highlight with no translation and leaves it without one', () => {
        const legacy = { ...hl('old', 'Gen.1.1', 'Gen.1.1'), translation: undefined };
        const [out] = planHighlight({ ...base, verses: [1], color: 'blue', visible: [legacy] });
        expect(out).toMatchObject({ id: 'old', color: 'blue' });
        expect(out.translation).toBeUndefined();
    });
});
