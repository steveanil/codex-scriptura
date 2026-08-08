import { describe, it, expect } from 'vitest';
import type { ScratchPadVerseBlock } from '@codex-scriptura/core';
import { formatVerseBlock, insertBlocksIntoContent, extractAnchors, groupAnchors } from './scratchPad';

function block(osisId: string, reference: string, text = 'In the beginning', translationId = 'KJV'): ScratchPadVerseBlock {
    return { osisId, translationId, text, reference };
}

describe('formatVerseBlock', () => {
    it('quotes the verse text and labels it with the reference and translation', () => {
        expect(formatVerseBlock(block('Gen.1.1', 'Gen 1:1', 'In the beginning God created the heaven and the earth.'))).toBe(
            '> In the beginning God created the heaven and the earth.\n> - Gen 1:1 (KJV)'
        );
    });

    it('quotes every line of multi-line verse text', () => {
        expect(formatVerseBlock(block('Ps.1.1', 'Ps 1:1', 'Blessed is the man\nthat walketh not'))).toBe(
            '> Blessed is the man\n> that walketh not\n> - Ps 1:1 (KJV)'
        );
    });
});

describe('insertBlocksIntoContent', () => {
    const b = block('Gen.1.1', 'Gen 1:1', 'In the beginning');
    const rendered = '> In the beginning\n> - Gen 1:1 (KJV)';

    it('appends to empty content without leading padding', () => {
        const res = insertBlocksIntoContent('', [b], null);
        expect(res.content).toBe(`${rendered}\n`);
        expect(res.cursor).toBe(res.content.length);
    });

    it('appends after existing text with a separating newline', () => {
        const res = insertBlocksIntoContent('my thought', [b], null);
        expect(res.content).toBe(`my thought\n${rendered}\n`);
    });

    it('inserts at the caret and reports the caret after the block', () => {
        const content = 'before\nafter';
        const res = insertBlocksIntoContent(content, [b], 7);
        expect(res.content).toBe(`before\n${rendered}\nafter`);
        expect(res.content.slice(res.cursor)).toBe('after');
    });

    it('does not double up newlines already present at the caret', () => {
        const res = insertBlocksIntoContent('before\n\nafter', [b], 7);
        expect(res.content).toBe(`before\n${rendered}\nafter`);
    });

    it('separates multiple blocks with a blank line', () => {
        const b2 = block('Gen.1.2', 'Gen 1:2', 'And the earth');
        const res = insertBlocksIntoContent('', [b, b2], null);
        expect(res.content).toBe(`${rendered}\n\n> And the earth\n> - Gen 1:2 (KJV)\n`);
    });

    it('clamps an out-of-range caret', () => {
        const res = insertBlocksIntoContent('hi', [b], 999);
        expect(res.content).toBe(`hi\n${rendered}\n`);
    });
});

describe('extractAnchors', () => {
    const dropped = [
        block('Gen.1.1', 'Gen 1:1'),
        block('Gen.1.11', 'Gen 1:11'),
        block('John.3.16', 'John 3:16'),
    ];

    it('finds references present in the text, in order of appearance', () => {
        const text = 'compare John 3:16 with Gen 1:1';
        expect(extractAnchors(text, dropped)).toEqual(['John.3.16', 'Gen.1.1']);
    });

    it('does not match a reference inside a longer verse number', () => {
        expect(extractAnchors('only Gen 1:11 here', dropped)).toEqual(['Gen.1.11']);
    });

    it('dedupes repeated references and repeated dropped entries', () => {
        const twice = [...dropped, block('Gen.1.1', 'Gen 1:1')];
        expect(extractAnchors('Gen 1:1 and again Gen 1:1', twice)).toEqual(['Gen.1.1']);
    });

    it('returns empty when nothing matches', () => {
        expect(extractAnchors('no references here', dropped)).toEqual([]);
    });
});

describe('groupAnchors', () => {
    it('groups contiguous verses in one chapter into a single anchor', () => {
        expect(groupAnchors(['Gen.1.2', 'Gen.1.1', 'Gen.1.3'])).toEqual([
            { book: 'Gen', chapter: 1, startVerse: 1, endVerse: 3 },
        ]);
    });

    it('splits non-contiguous verses into separate anchors', () => {
        expect(groupAnchors(['Gen.1.1', 'Gen.1.3'])).toEqual([
            { book: 'Gen', chapter: 1, startVerse: 1, endVerse: 1 },
            { book: 'Gen', chapter: 1, startVerse: 3, endVerse: 3 },
        ]);
    });

    it('never groups across chapters or books', () => {
        const anchors = groupAnchors(['Gen.1.31', 'Gen.2.1', 'John.3.16']);
        expect(anchors).toEqual([
            { book: 'Gen', chapter: 1, startVerse: 31, endVerse: 31 },
            { book: 'Gen', chapter: 2, startVerse: 1, endVerse: 1 },
            { book: 'John', chapter: 3, startVerse: 16, endVerse: 16 },
        ]);
    });

    it('drops malformed ids and dedupes verses', () => {
        expect(groupAnchors(['Gen.1.1', 'Gen.1.1', 'bogus', 'Gen.1'])).toEqual([
            { book: 'Gen', chapter: 1, startVerse: 1, endVerse: 1 },
        ]);
    });
});
