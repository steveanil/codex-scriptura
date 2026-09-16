import { describe, expect, it } from 'vitest';
import { BOOKS } from '@codex-scriptura/core';
import { enterTarget, filterBooks, stepHighlight } from './passagePicker';

describe('filterBooks', () => {
    it('returns every book for an empty query', () => {
        expect(filterBooks('')).toHaveLength(BOOKS.length);
    });
    it('matches name, abbreviation and osis prefixes', () => {
        expect(filterBooks('gen').map((b) => b.osisId)).toEqual(['Gen']);
        expect(filterBooks('1 co').map((b) => b.osisId)).toEqual(['1Cor']);
        expect(filterBooks('rev')[0].osisId).toBe('Rev');
    });
    it('ignores a trailing chapter number while filtering', () => {
        expect(filterBooks('ps 23').map((b) => b.osisId)).toEqual(['Ps']);
    });
    it('falls back to a substring match', () => {
        expect(filterBooks('onomy').map((b) => b.osisId)).toEqual(['Deut']);
    });
});

describe('enterTarget', () => {
    it('a typed reference wins', () => {
        expect(enterTarget('Ps 23', 'Gen', 'Gen')).toEqual({ book: 'Ps', chapter: 23 });
        expect(enterTarget('John 3:16', null, 'Gen')).toEqual({ book: 'John', chapter: 3 });
    });
    it('otherwise the highlighted book at chapter 1', () => {
        expect(enterTarget('ex', 'Exod', 'Gen')).toEqual({ book: 'Exod', chapter: 1 });
    });
    it('nothing when the highlighted book is the current one', () => {
        expect(enterTarget('', 'Gen', 'Gen')).toBeNull();
    });
});

describe('stepHighlight', () => {
    const three = BOOKS.slice(0, 3);
    it('moves and wraps', () => {
        expect(stepHighlight(three, 'Gen', 1)).toBe('Exod');
        expect(stepHighlight(three, 'Lev', 1)).toBe('Gen');
        expect(stepHighlight(three, 'Gen', -1)).toBe('Lev');
    });
    it('starts from the ends when nothing is highlighted', () => {
        expect(stepHighlight(three, null, 1)).toBe('Gen');
        expect(stepHighlight(three, null, -1)).toBe('Lev');
        expect(stepHighlight([], null, 1)).toBeNull();
    });
});
