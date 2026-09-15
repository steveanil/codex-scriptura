import { describe, expect, it } from 'vitest';
import { escapeHtml, escapeAttr, escapeRegex } from './escape.js';

describe('escapeHtml', () => {
    it('escapes element-content metacharacters', () => {
        expect(escapeHtml('a & b < c > d "q"')).toBe('a &amp; b &lt; c &gt; d &quot;q&quot;');
    });
});

describe('escapeAttr', () => {
    it('escapes both quote styles for attribute interpolation', () => {
        expect(escapeAttr(`Adam's "house"`)).toBe('Adam&#39;s &quot;house&quot;');
    });
});

describe('escapeRegex', () => {
    it('makes any string safe as a literal RegExp source', () => {
        const hostile = 'a.b*c+d?e^f$g(h)i|j[k]l\\m{n}';
        expect(new RegExp(escapeRegex(hostile)).test(hostile)).toBe(true);
        expect(new RegExp(escapeRegex('a.c')).test('abc')).toBe(false);
    });
});
