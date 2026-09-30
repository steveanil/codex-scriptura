import { describe, it, expect } from 'vitest';
import { isAutomatic, readerLog, formsProblems, replaceLogged, NO_FORMS } from './transform-log.js';

describe('what the Catena reader may change on its own (issue #85)', () => {
    it('makes a table form or a mechanical rule, and only suggests a guess from counts or from a character alone', () => {
        expect(isAutomatic('italic')).toBe(true);
        expect(isAutomatic('dehyphen')).toBe(true);
        expect(isAutomatic('lemma:etc-sign')).toBe(true);
        for (const rule of ['italic-frequency', 'dictionary-cut-frequency', 'lone-digit', 'lone-consonant', 'I-before-capital', 'glued-digit', 'In-as-ID', 'citation:etc-sign']) expect(isAutomatic(rule)).toBe(false);
    });

    it('applies a suggestion only where that occurrence was read on the page, and reports a record no occurrence met', () => {
        const at = { rule: 'lone-digit', item: 'scan', leaf: 62, from: 'generations. 1 Matthew', to: 'generations. Matthew' };
        const reader = readerLog([
            { ...at, verdict: 'apply', reviewed: '2026-09-29', note: 'nothing printed' },
            { ...at, leaf: 63, verdict: 'apply', reviewed: '2026-09-29', note: 'a page since changed' },
        ]);
        expect(reader.log(at)).toBe(true);
        expect(reader.log({ ...at, leaf: 64 })).toBe(false);
        expect(reader.log({ ...at, to: 'generations. I Matthew' })).toBe(false);
        expect(reader.log({ rule: 'ligature', from: 'fesh', to: 'flesh' })).toBe(true);
        expect(reader.transforms.map((t) => [t.rule, t.applied, t.verified ?? null])).toEqual([['lone-digit', true, '2026-09-29'], ['lone-digit', false, null], ['lone-digit', false, null], ['ligature', true, null]]);
        expect(reader.unmatched().map((v) => v.leaf)).toEqual([63]);
        // A record that the page keeps the text is honoured as well
        expect(readerLog([{ ...at, verdict: 'keep', reviewed: '2026-09-29', note: 'the page prints 1' }]).log(at)).toBe(false);
    });

    it('keeps words out of the checked tables', () => {
        expect(formsProblems({ ...NO_FORMS, italic: { uas: 'was', hare: 'have' }, cuts: { island: 'is land' } }, new Set(['hare', 'island', 'was']))).toEqual(['reader form "hare" is a word the lexicon knows', 'reader form "island" is a word the lexicon knows']);
    });

    it('with no log makes only what is automatic', () => {
        expect(replaceLogged('a 1 b', /1 /g, 'lone-digit', () => '')).toBe('a 1 b');
        expect(replaceLogged('qf God', /qf/g, 'qf-as-of', () => 'of')).toBe('of God');
    });
});
