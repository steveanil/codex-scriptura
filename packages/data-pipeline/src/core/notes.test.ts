import { describe, it, expect } from 'vitest';
import { findCatchAnchor, finishRuns, parseNoteBody, settleOffsets, sortNotes, type NoteTagRule } from './notes.js';
import { countElements, markElements, removeElements, MARKER_RE } from './xml.js';

const rule = (name: string): NoteTagRule =>
    name === 'fr' ? 'drop' : name === 'fq' ? 'catch' : name === 'fqa' ? 'alt' : name === 'nd' ? 'upper' : name === 'ref' ? { ref: 'Gen.1.1' } : 'plain';
const keepAll = (ref: string) => ref;
const noop = () => {};

describe('markElements', () => {
    const cases: Array<[string, string[]]> = [
        ['a <f caller="+">note</f>b', ['f']],
        ['x<f a="1">one</f><f>two</f>y<x>three</x>z', ['f', 'x']],
        ['Jerubbesheth <f>Also known.</f>? Was it', ['f']],
        ['word <f>a</f> <f>b</f>. next', ['f']],
        ['word <x>a</x> <f>b</f>. next', ['f', 'x']],
        ['a <f/> b <f>c</f>', ['f']],
        ['begin <note>outer <note>inner</note> tail</note> end', ['note']],
        ['kept <note>unclosed note text', ['note']],
    ];
    it.each(cases)('matches removeElements once the markers are deleted: %s', (xml, tags) => {
        const { marked } = markElements(xml, tags);
        expect(marked.replace(MARKER_RE, '')).toBe(removeElements(xml, tags));
    });

    it('returns each removed element under the index its marker carries', () => {
        const { marked, removed } = markElements('a<x>X</x> b<f>F</f>', ['f', 'x']);
        expect(removed).toEqual(['<f>F</f>', '<x>X</x>']);
        expect(marked).toBe('a b');
    });

    it('counts what it would remove', () => {
        expect(countElements('a <f>1</f> <f/> <f>2<f>nested</f></f> <x>3</x>', ['f', 'x'])).toBe(3);
    });
});

describe('parseNoteBody', () => {
    it('drops, styles and links by the rule, decoding entities', () => {
        expect(parseNoteBody('<f caller="+"><fr>1:1 </fr><ft>Or,</ft> <fqa>him &amp; her</fqa> see <ref tgt="GEN.1.1">Gen 1:1</ref></f>', rule)).toEqual([
            { t: 'Or, ' },
            { t: 'him & her', s: 'alt' },
            { t: ' see ' },
            { t: 'Gen 1:1', ref: 'Gen.1.1', link: true },
        ]);
    });

    it('upper-cases text under an upper rule and ignores comments', () => {
        expect(parseNoteBody('<note><fq>the <nd>Lord</nd></fq><!-- editor --></note>', rule)).toEqual([
            { t: 'the LORD', s: 'catch' },
        ]);
    });
});

describe('finishRuns', () => {
    it('collapses whitespace inside and across runs and moves edge spaces out of styled runs', () => {
        expect(finishRuns([{ t: '\n Literally,\n' }, { t: ' made light. \n', s: 'alt' }, { t: '\n' }], keepAll, noop))
            .toEqual(['Literally, ', { t: 'made light.', s: 'alt' }]);
    });

    it('turns an unresolved link into plain text merged with its neighbours, and reports it', () => {
        const unresolved: string[] = [];
        const runs = finishRuns(
            [{ t: 'see ' }, { t: '25.', ref: 'Luke.25.1', link: true }, { t: ' or ' }, { t: 'x', ref: undefined, link: true }],
            () => undefined,
            (what) => unresolved.push(what),
        );
        expect(runs).toEqual(['see 25. or x']);
        expect(unresolved).toEqual(['Luke.25.1 "25."', '(no canonical verse) "x"']);
    });

    it('moves trailing punctuation out of a link label into the text after it', () => {
        expect(finishRuns(
            [{ t: 'Compare ' }, { t: '2 Kings 17:3', ref: '2Kgs.17.3', link: true }, { t: ', ' }, { t: '23.\n', ref: '2Kgs.17.23', link: true }, { t: ' ' }, { t: '14,', ref: 'Rom.14.1', link: true }, { t: ' and' }],
            keepAll, noop,
        )).toEqual(['Compare ', { t: '2 Kings 17:3', ref: '2Kgs.17.3' }, ', ', { t: '23', ref: '2Kgs.17.23' }, '. ', { t: '14', ref: 'Rom.14.1' }, ', and']);
    });

    it('returns null for a note that is empty once cleaned', () => {
        expect(finishRuns([{ t: ' \n ' }, { t: ' ', s: 'alt' }], keepAll, noop)).toBeNull();
    });
});

describe('settleOffsets', () => {
    it('maps pre-collapse positions to the final text, after the last non-space character', () => {
        const out = '  Yahweh   God  made ';
        const text = 'Yahweh God made';
        // after "Yahweh", after "Yahweh   " (still belongs to Yahweh), at the end
        expect(settleOffsets(out, text, [8, 11, out.length, 0])).toEqual([6, 6, 15, 0]);
    });
});

describe('sortNotes', () => {
    it('orders by offset and keeps source order on ties', () => {
        expect(sortNotes([{ at: 5, n: 1 }, { at: 2, n: 2 }, { at: 5, n: 3 }]).map((x) => x.n)).toEqual([2, 1, 3]);
    });
});

describe('findCatchAnchor', () => {
    const text = 'And God said, Let the waters bring forth abundantly the moving creature that hath life, and God saw it.';

    it('ends at a single catch word', () => {
        expect(findCatchAnchor(text, 'moving')).toBe(text.indexOf('moving') + 6);
    });

    it('drops a trailing ellipsis and punctuation from an elided phrase', () => {
        const t = 'and God divided the light from the darkness.';
        expect(findCatchAnchor(t, ' the light from… ')).toBe(t.indexOf(' the darkness'));
        expect(findCatchAnchor(t, 'the light from...')).toBe(t.indexOf(' the darkness'));
        expect(findCatchAnchor(t, 'divided,')).toBe(t.indexOf(' the light'));
    });

    it('will not choose between two occurrences, but one after the previous anchor is no longer a tie', () => {
        expect(findCatchAnchor(text, 'God')).toBe('ambiguous');
        expect(findCatchAnchor(text, 'God', 7)).toBe(text.lastIndexOf('God') + 3);
    });

    it('takes the first of two occurrences when two notes quote the same words', () => {
        expect(findCatchAnchor(text, 'God', 0, 2)).toBe(7);
        expect(findCatchAnchor(text, 'moving', 0, 2)).toBe('ambiguous');
    });

    it('places the callout after a whole possessive word, never inside it (KJV 2 Sam 6:6 shape)', () => {
        const t = 'And when they came to Nachon’s threshingfloor, Uzzah put forth his hand';
        expect(findCatchAnchor(t, 'Nachon')).toBe(t.indexOf(' threshingfloor'));
        expect(findCatchAnchor("to Nachon's floor", 'Nachon')).toBe('to Nachon\'s'.length);
        expect(findCatchAnchor('Nachon’ and', 'Nachon')).toBe('Nachon'.length);
    });

    it('falls back to the start of the verse when nothing follows the previous anchor', () => {
        expect(findCatchAnchor(text, 'waters', text.indexOf('life'))).toBe(text.indexOf('waters') + 6);
    });

    it('finds nothing for an absent needle or one that only occurs inside a longer word', () => {
        expect(findCatchAnchor(text, 'firmament')).toBeUndefined();
        expect(findCatchAnchor(text, 'creat')).toBeUndefined();
        expect(findCatchAnchor(text, 'wat')).toBeUndefined();
        expect(findCatchAnchor(text, '…')).toBeUndefined();
    });

    it('tries the exact case first and ignores case only as a fallback', () => {
        const t = 'the Lord said to the LORD';
        expect(findCatchAnchor(t, 'LORD')).toBe(t.length);
        expect(findCatchAnchor(t, 'lord')).toBe('ambiguous');
    });
});
