import { describe, expect, it } from 'vitest';
import type { Annotation } from '@codex-scriptura/core';
import { isVerseInAnnotation, renderVerseHtml, type EntityRef } from './verse-render';

function ann(verseStart: string, verseEnd: string): Annotation {
    return {
        id: 'a1',
        type: 'highlight',
        book: 'Gen',
        verseStart,
        verseEnd,
        data: '#fbbf24',
        tags: [],
        created: 0,
        modified: 0,
        synced: false,
    };
}

describe('renderVerseHtml entity marking', () => {
    const opts = { redLetters: false };
    const on: EntityRef = { id: 'on_1', type: 'person', name: 'On' };
    const god: EntityRef = { id: 'god_1324', type: 'person', name: 'God' };

    it('marks whole words only - person "On" must not mark every "son"', () => {
        const html = renderVerseHtml('and On, the son of Peleth, sons of Reuben', [on], undefined, opts);
        expect(html.match(/<mark/g)).toHaveLength(1);
        expect(html).toContain('>On</mark>');
        expect(html).toContain('the son of Peleth');
    });

    it('is case-sensitive - "God" must not mark "gods" or "ungodly"', () => {
        const html = renderVerseHtml('the ungodly serve their gods', [god], undefined, opts);
        expect(html).not.toContain('<mark');
    });

    it('still marks the exact capitalized name', () => {
        const html = renderVerseHtml('In the beginning God created', [god], undefined, opts);
        expect(html).toContain('>God</mark>');
    });
});

describe('isVerseInAnnotation', () => {
    it('matches verses inside a single-chapter range', () => {
        const a = ann('Gen.1.3', 'Gen.1.5');
        expect(isVerseInAnnotation(1, 2, a)).toBe(false);
        expect(isVerseInAnnotation(1, 3, a)).toBe(true);
        expect(isVerseInAnnotation(1, 5, a)).toBe(true);
        expect(isVerseInAnnotation(1, 6, a)).toBe(false);
        expect(isVerseInAnnotation(2, 4, a)).toBe(false);
    });

    it('matches verses across a chapter boundary', () => {
        const a = ann('Gen.1.30', 'Gen.2.2');
        expect(isVerseInAnnotation(1, 29, a)).toBe(false);
        expect(isVerseInAnnotation(1, 31, a)).toBe(true);
        expect(isVerseInAnnotation(2, 1, a)).toBe(true);
        expect(isVerseInAnnotation(2, 3, a)).toBe(false);
    });

    it('rejects refs with too few parts', () => {
        expect(isVerseInAnnotation(1, 1, ann('Gen.1', 'Gen.1.5'))).toBe(false);
    });

    it('rejects non-numeric parts instead of matching every verse', () => {
        // Sub-verse suffixes can arrive via import/sync paths
        expect(isVerseInAnnotation(1, 1, ann('Gen.1.1a', 'Gen.1.5'))).toBe(false);
        expect(isVerseInAnnotation(1, 1, ann('Gen.1.1', 'Gen.1.5b'))).toBe(false);
        expect(isVerseInAnnotation(1, 1, ann('Gen.x.1', 'Gen.1.5'))).toBe(false);
    });
});
