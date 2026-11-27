import { describe, expect, it } from 'vitest';
import { bookDisplayName } from './books.js';

describe('bookDisplayName', () => {
    it('gives the full name for an OSIS id, name or abbreviation', () => {
        expect(bookDisplayName('1John')).toBe('1 John');
        expect(bookDisplayName('Ps')).toBe('Psalms');
        expect(bookDisplayName('genesis')).toBe('Genesis');
    });

    it('falls back to the query for an unknown book', () => {
        expect(bookDisplayName('Enoch')).toBe('Enoch');
    });
});
