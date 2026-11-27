import { describe, it, expect } from 'vitest';
import { linkifyRefs, parseDefinition, truncateDefinition, type DictSegment } from './dictionary';

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

    it('keeps the space before a book name in the text, not the ref label', () => {
        const segs = linkifyRefs('(Matt. 27:33; Mark 15:22; John 19:17)');
        expect(refs(segs).map((r) => r.type === 'ref' && r.label)).toEqual(['Matt. 27:33', 'Mark 15:22', 'John 19:17']);
        expect(segs.map((s) => (s.type === 'text' ? s.text : s.label)).join('')).toBe('(Matt. 27:33; Mark 15:22; John 19:17)');
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

describe('parseDefinition paragraphs (issue #455)', () => {
    const text = (s: { segments: DictSegment[] }) => s.segments.map((g) => (g.type === 'text' ? g.text : g.label)).join('');

    it('turns blank-line breaks into separate blocks', () => {
        const blocks = parseDefinition('First paragraph.\n\n Second paragraph (Matt. 27:2).\n\nThird.');
        expect(blocks.map(text)).toEqual(['First paragraph.', 'Second paragraph (Matt. 27:2).', 'Third.']);
        expect(refs(blocks[1].segments)[0]).toMatchObject({ book: 'Matt', chapter: 27, verse: 2 });
    });

    it('keeps a paragraph with single newlines as one block', () => {
        expect(parseDefinition('one line\nthe next line').map(text)).toEqual(['one line the next line']);
    });

    it('splits numbered senses inside a paragraph and keeps the paragraphs around them', () => {
        const blocks = parseDefinition(
            'The third Person of the Trinity.\n\nHis personality is proved (1) from his attributes (John 16:7). (2) He executes the offices of a person.\n\nA closing paragraph.'
        );
        expect(blocks.map((b) => b.marker)).toEqual([null, null, '(1)', '(2)', null]);
        expect(text(blocks[2])).toBe('from his attributes (John 16:7).');
        expect(text(blocks[4])).toBe('A closing paragraph.');
    });

    it('leaves a comma-separated enumeration inside its sentence', () => {
        const blocks = parseDefinition('they accused him (1) of sedition, (2) preventing the tribute, and (3) of assuming the title of king (Luke 23:2).');
        expect(blocks).toHaveLength(1);
        expect(blocks[0].marker).toBeNull();
    });

    it('does not treat chapter numbers in parentheses as senses', () => {
        expect(parseDefinition('the sons of Japheth (6) and of Ham (22) and Shem (10) spread abroad')).toHaveLength(1);
    });
});

describe('truncateDefinition (issue #455)', () => {
    const long =
        'Pilate was the sixth procurator of Judea (A.D. 26-36). His headquarters were at Caesarea. ' +
        'He ascended the judgment-seat as if ready to ratify the decision (Matt. 27:19). His wife sent a message to him. ' +
        'They threw around him a purple robe (Matt. 27:28; John 19:2), and mocked him. In 1 Tim. 6:13 he is named again.\n\n' +
        'Pilate then led forth Jesus from within the Praetorium (Matt. 27:27) before the people.';

    // Every parenthesis plus the one bare reference
    const spans: Array<[number, number]> = [
        ...[...long.matchAll(/\([^)]*\)/g)].map((m): [number, number] => [m.index, m.index + m[0].length]),
        [long.indexOf('1 Tim. 6:13'), long.indexOf('1 Tim. 6:13') + '1 Tim. 6:13'.length],
    ];

    it('returns the whole text when it is within the budget', () => {
        expect(truncateDefinition('Short entry (Gen. 1:1).', 600)).toEqual({ text: 'Short entry (Gen. 1:1).', truncated: false });
    });

    it('reports a cut and returns a prefix that ends on a sentence', () => {
        const r = truncateDefinition(long, 150);
        expect(r.truncated).toBe(true);
        expect(long.startsWith(r.text)).toBe(true);
        expect(r.text).toMatch(/\.$/);
    });

    it('prefers a paragraph break near the budget', () => {
        const brk = long.indexOf('\n\n');
        expect(truncateDefinition(long, brk + 20)).toEqual({ text: long.slice(0, brk), truncated: true });
    });

    it('never cuts inside a reference or its parentheses, at any budget', () => {
        for (let budget = 10; budget < long.length; budget++) {
            const r = truncateDefinition(long, budget);
            if (!r.truncated) continue;
            const end = r.text.replace(/ …$/, '').length;
            for (const [s, e] of spans) expect(end > s && end < e, `budget ${budget} cut at ${end}`).toBe(false);
        }
    });

    it('falls back to a word boundary with an ellipsis when there is no sentence end', () => {
        const r = truncateDefinition('word '.repeat(200).trim(), 100);
        expect(r.truncated).toBe(true);
        expect(r.text.endsWith(' …')).toBe(true);
        expect(r.text.length).toBeLessThanOrEqual(102);
    });
});
