import { describe, expect, it } from 'vitest';
import { highlightQuery, highlightSurfaces, markMatches } from './highlight';

describe('markMatches', () => {
    it('escapes the text around and inside the marks', () => {
        expect(markMatches('a <b> & c', /b/g)).toBe('a &lt;<mark>b</mark>&gt; &amp; c');
    });

    it('matches against the original text, not the escaped one', () => {
        // "amp" occurs only inside the entity that escaping would produce
        expect(markMatches('fish & chips', /amp/g)).toBe('fish &amp; chips');
    });
});

describe('highlightQuery', () => {
    it('marks the whole phrase when the verse holds it', () => {
        expect(highlightQuery('the bread of life', 'bread of life')).toBe('the <mark>bread of life</mark>');
    });

    it('falls back to the non-stop words', () => {
        expect(highlightQuery('living bread came down', 'bread of heaven')).toBe('living <mark>bread</mark> came down');
    });

    it('treats query characters literally', () => {
        expect(highlightQuery('what (then)?', '(then)?')).toBe('what <mark>(then)?</mark>');
    });
});

describe('highlightSurfaces', () => {
    it('marks whole words only', () => {
        expect(highlightSurfaces('loved, lovely love', ['love'])).toBe('loved, lovely <mark>love</mark>');
    });

    it('escapes when there is nothing to mark', () => {
        expect(highlightSurfaces('a < b', [])).toBe('a &lt; b');
    });
});
