import { describe, it, expect } from 'vitest';
import { isAutomatic, readerLog, formsProblems, replaceLogged, replaceTraced, transformId, Traced, NO_FORMS, type Transform } from './transform-log.js';
import { splitChain, emptyReport } from './catena-aurea.js';

describe('what the Catena reader may change on its own (issue #85)', () => {
    it('makes a table form or a mechanical rule, and only suggests a guess from counts or from a character alone', () => {
        expect(isAutomatic('italic')).toBe(true);
        expect(isAutomatic('dehyphen')).toBe(true);
        expect(isAutomatic('lemma:etc-sign')).toBe(true);
        for (const rule of ['italic-frequency', 'dictionary-cut-frequency', 'lone-digit', 'lone-consonant', 'I-before-capital', 'glued-digit', 'In-as-ID', 'citation:etc-sign']) expect(isAutomatic(rule)).toBe(false);
    });

    it('binds a record to one span on one page: the same word elsewhere on the page is not approved by it', () => {
        const hare = (span: string): Transform => ({ rule: 'italic-frequency', item: 'scan', leaf: 5, span, from: 'hare', to: 'have' });
        const first = hare('5@ocr400:x210'), second = hare('5@ocr460:x330');
        const reader = readerLog([{ id: transformId(first), rule: first.rule, item: 'scan', leaf: 5, span: first.span!, from: 'hare', to: 'have', verdict: 'apply', reviewed: '2026-09-29', note: 'the page prints have' }]);
        expect(reader.log(first)).toBe(true);
        expect(reader.log(second)).toBe(false);
        expect(reader.problems()).toEqual([]);
        expect(reader.transforms.map((t) => t.applied)).toEqual([true, false]);
    });

    it('refuses a record that meets two occurrences, and one that meets none', () => {
        const t: Transform = { rule: 'lone-digit', item: 'scan', leaf: 62, span: '62@300:40-62@300:40', from: 'generations. 1 Matthew', to: 'generations. Matthew' };
        const record = { id: transformId(t), rule: t.rule, item: 'scan', leaf: 62, span: t.span!, from: t.from, to: t.to, verdict: 'apply' as const, reviewed: '2026-09-29', note: '' };
        const twice = readerLog([record]);
        twice.log(t);
        twice.log(t);
        expect(twice.problems()).toEqual([`verified ${record.id} (lone-digit scan leaf 62) matches 2 occurrences`]);
        const none = readerLog([{ ...record, span: '62@310:40-62@310:40' }]);
        none.log(t);
        expect(none.problems()[0]).toMatch(/matches no occurrence/);
        // A record that the page keeps the text is honoured as well
        const keep = readerLog([{ ...record, verdict: 'keep' }]);
        expect(keep.log(t)).toBe(false);
    });

    it('gives the same change at the same place the same id, and any other place another', () => {
        const t = { rule: 'lone-digit', item: 'scan', span: '62@300:40-62@300:40', from: 'a 1 b', to: 'a b' };
        expect(transformId(t)).toBe(transformId({ ...t }));
        expect(transformId({ ...t, span: '62@300:41-62@300:41' })).not.toBe(transformId(t));
    });

    it('places a change on the leaf its characters were read from, however the text before it was changed', () => {
        const seen: Array<[string, number | undefined, string | undefined]> = [];
        splitChain([
            { text: 'JEROME. The Lord came down', margin: '', leaf: 10, y: 1800, col: 0 },
            { text: 'from heaven, and t spoke to them.', margin: '', leaf: 11, y: 220, col: 0 },
        ], emptyReport(), undefined, undefined, (rule, _from, _to, leaf, place) => { seen.push([rule, leaf, place?.span]); return false; });
        expect(seen).toEqual([['lone-consonant', 11, '11@220:17-11@220:17']]);
        // A mark that opens the next page's first line is on that page, though the match takes in the space before it
        const opening: Array<[number | undefined, string | undefined]> = [];
        splitChain([
            { text: 'JEROME. The Lord came down', margin: '', leaf: 10, y: 1800, col: 0 },
            { text: 't spoke to them.', margin: '', leaf: 11, y: 220, col: 0 },
        ], emptyReport(), undefined, undefined, (_rule, _from, _to, leaf, place) => { opening.push([leaf, place?.span]); return false; });
        expect(opening).toEqual([[11, '11@220:0-11@220:0']]);
        // Traced text keeps each character's origin through a replacement that shifts what follows
        const sources = [] as { leaf: number; y: number }[];
        let t = Traced.read('ab c d', { leaf: 3, y: 100 }, 0, sources).concat(' ').concat(Traced.read('x y', { leaf: 4, y: 50 }, 7, sources));
        t = replaceTraced(t, /ab /g, 'spacing', () => '');
        expect(t.text).toBe('c d x y');
        expect(t.place(4, 5)).toEqual({ leaf: 4, y: 50, span: '4@50:7-4@50:7' });
    });

    it('keeps words out of the checked tables', () => {
        expect(formsProblems({ ...NO_FORMS, italic: { uas: 'was', hare: 'have' }, cuts: { island: 'is land' } }, new Set(['hare', 'island', 'was']))).toEqual(['reader form "hare" is a word the lexicon knows', 'reader form "island" is a word the lexicon knows']);
    });

    it('with no log makes only what is automatic', () => {
        expect(replaceLogged('a 1 b', /1 /g, 'lone-digit', () => '')).toBe('a 1 b');
        expect(replaceLogged('qf God', /qf/g, 'qf-as-of', () => 'of')).toBe('of God');
    });
});
