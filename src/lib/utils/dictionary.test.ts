import { describe, it, expect } from 'vitest';
import { linkifyRefs, parseDefinition, type DictSegment } from './dictionary';

function refs(segments: DictSegment[]) {
    return segments.filter((s) => s.type === 'ref');
}

describe('linkifyRefs', () => {
    it('links a simple abbreviated ref', () => {
        const segs = linkifyRefs('God rested (Gen. 2:2) from his work.');
        const r = refs(segs);
        expect(r).toEqual([{ type: 'ref', label: 'Gen. 2:2', book: 'Gen', chapter: 2, verse: 2 }]);
        expect(segs[0]).toEqual({ type: 'text', text: 'God rested (' });
        expect(segs.at(-1)).toEqual({ type: 'text', text: ') from his work.' });
    });

    it('links numbered books like 1 Cor.', () => {
        const r = refs(linkifyRefs('the last Adam (1 Cor. 15:45)'));
        expect(r).toEqual([{ type: 'ref', label: '1 Cor. 15:45', book: '1Cor', chapter: 15, verse: 45 }]);
    });

    it('keeps verse ranges in the label and links the first verse', () => {
        const r = refs(linkifyRefs('the Beatitudes (Matt. 5:3-12) open the sermon'));
        expect(r).toEqual([{ type: 'ref', label: 'Matt. 5:3-12', book: 'Matt', chapter: 5, verse: 3 }]);
    });

    it('links comma continuations to the same chapter', () => {
        const r = refs(linkifyRefs('as written (John 3:16, 17)'));
        expect(r).toEqual([
            { type: 'ref', label: 'John 3:16', book: 'John', chapter: 3, verse: 16 },
            { type: 'ref', label: '17', book: 'John', chapter: 3, verse: 17 },
        ]);
    });

    it('ignores capitalized words followed by numbers that are not books', () => {
        expect(refs(linkifyRefs('destroyed in A.D. 70, see Josephus 5:2'))).toEqual([]);
    });

    it('returns plain text untouched when there are no refs', () => {
        expect(linkifyRefs('a dry measure of grain')).toEqual([
            { type: 'text', text: 'a dry measure of grain' },
        ]);
    });
});

describe('parseDefinition', () => {
    it('splits numbered senses with intro text', () => {
        const senses = parseDefinition(
            'A name applied (1) to Adam (Gen. 2:19). (2) to the Messiah (1 Cor. 15:45). (3) to mankind generally.'
        );
        expect(senses.map((s) => s.marker)).toEqual([null, '(1)', '(2)', '(3)']);
        expect(senses[0].segments).toEqual([{ type: 'text', text: 'A name applied' }]);
        expect(refs(senses[1].segments)).toHaveLength(1);
        expect(refs(senses[2].segments)[0].book).toBe('1Cor');
    });

    it('does not split on a lone parenthesized number', () => {
        const senses = parseDefinition('He sent (1) messenger to the city.');
        expect(senses).toHaveLength(1);
        expect(senses[0].marker).toBeNull();
    });

    it('does not treat numbered book refs like (1 Cor. 3:2) as sense markers', () => {
        const senses = parseDefinition('milk (1 Cor. 3:2; Heb. 5:12) and meat');
        expect(senses).toHaveLength(1);
        expect(refs(senses[0].segments).map((r) => r.book)).toEqual(['1Cor', 'Heb']);
    });

    it('returns empty for blank input', () => {
        expect(parseDefinition('   ')).toEqual([]);
    });
});
