// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { calloutIndex, focusCallout, footnoteKeydown, footnoteLetter, noteLeadIn, toggleFootnote } from './footnotes';

describe('footnoteLetter', () => {
    it('runs a..z, then aa, ab, ... az, ba', () => {
        expect([0, 1, 25, 26, 27, 51, 52].map(footnoteLetter)).toEqual(['a', 'b', 'z', 'aa', 'ab', 'az', 'ba']);
    });
});

function verseWithCallouts(): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = '<span class="verse" data-osis="Gen.1.1">In<sup class="fn-call" tabindex="0" data-note="0">a</sup> the <mark>God</mark><sup class="fn-call" tabindex="0" data-note="1">b</sup></span>';
    document.body.append(root);
    return root;
}

describe('calloutIndex', () => {
    it('reads the note index of a callout and ignores anything else', () => {
        const root = verseWithCallouts();
        const [a, b] = root.querySelectorAll('.fn-call');
        expect(calloutIndex(a)).toBe(0);
        expect(calloutIndex(b.firstChild)).toBe(null); // a text node is not an Element
        expect(calloutIndex(b)).toBe(1);
        expect(calloutIndex(root.querySelector('mark'))).toBe(null);
        expect(calloutIndex(null)).toBe(null);
        root.remove();
    });
});

describe('toggleFootnote', () => {
    it('opens, retargets within the verse, moves to another verse, and closes on the same callout', () => {
        const a = toggleFootnote(null, 'Gen.1.1', 0);
        expect(a).toEqual({ osisId: 'Gen.1.1', index: 0 });
        expect(toggleFootnote(a, 'Gen.1.1', 1)).toEqual({ osisId: 'Gen.1.1', index: 1 });
        expect(toggleFootnote(a, 'Gen.1.2', 0)).toEqual({ osisId: 'Gen.1.2', index: 0 });
        expect(toggleFootnote(a, 'Gen.1.1', 0)).toBe(null);
    });
});

describe('footnoteKeydown', () => {
    const key = (k: string, target: EventTarget) => {
        const e = new KeyboardEvent('keydown', { key: k, cancelable: true });
        Object.defineProperty(e, 'target', { value: target });
        return e;
    };

    it('toggles on Enter and Space over a callout and leaves other keys and targets alone', () => {
        const root = verseWithCallouts();
        const b = root.querySelector('[data-note="1"]')!;
        const enter = key('Enter', b);
        expect(footnoteKeydown(enter, null, 'Gen.1.1')).toEqual({ osisId: 'Gen.1.1', index: 1 });
        expect(enter.defaultPrevented).toBe(true);
        expect(footnoteKeydown(key(' ', b), { osisId: 'Gen.1.1', index: 1 }, 'Gen.1.1')).toBe(null);
        expect(footnoteKeydown(key('Enter', root.querySelector('mark')!), null, 'Gen.1.1')).toBeUndefined();
        expect(footnoteKeydown(key('a', b), null, 'Gen.1.1')).toBeUndefined();
        root.remove();
    });

    it('closes the open row of this verse on Escape, and only this verse', () => {
        const root = verseWithCallouts();
        const open = { osisId: 'Gen.1.1', index: 0 };
        expect(footnoteKeydown(key('Escape', root), open, 'Gen.1.1')).toBe(null);
        expect(footnoteKeydown(key('Escape', root), open, 'Gen.1.2')).toBeUndefined();
        expect(footnoteKeydown(key('Escape', root), null, 'Gen.1.1')).toBeUndefined();
        root.remove();
    });
});

describe('focusCallout', () => {
    it('focuses the callout the row was opened from', () => {
        const root = verseWithCallouts();
        focusCallout(root, { osisId: 'Gen.1.1', index: 1 });
        expect(document.activeElement).toBe(root.querySelector('[data-note="1"]'));
        root.remove();
    });
});

describe('noteLeadIn', () => {
    it('reads a cross-reference note as "See ..." unless it already says so', () => {
        expect(noteLeadIn({ at: 0, kind: 'xref', runs: [{ t: 'Isaiah 7:14', ref: 'Isa.7.14' }] })).toBe('See ');
        expect(noteLeadIn({ at: 0, kind: 'xref', runs: ['see ', { t: 'Genesis 1:1', ref: 'Gen.1.1' }] })).toBe('');
        expect(noteLeadIn({ at: 0, kind: 'xref', runs: ['Compare Exodus 3:3'] })).toBe('');
        expect(noteLeadIn({ at: 0, runs: ['Or, seed'] })).toBe('');
    });
});
