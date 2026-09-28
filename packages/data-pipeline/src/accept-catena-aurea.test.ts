import { describe, it, expect } from 'vitest';
import { unresolved } from './accept-catena-aurea.js';

describe('Catena acceptance gate (issue #85)', () => {
    it('lets only findings named by id and kind through the allowlist', () => {
        const findings = [{ id: 'catena-matt-3-5-6#3', kind: 'text' }, { id: 'catena-matt-3-5-6#3', kind: 'author' }, { id: 'catena-john-1-1#2', kind: 'text' }];
        const reviewed = [{ id: 'catena-matt-3-5-6#3', kind: 'text', note: 'oracle carries an editorial note the page lacks', reviewed: '2026-09-28' }];
        expect(unresolved(findings, reviewed)).toEqual([{ id: 'catena-matt-3-5-6#3', kind: 'author' }, { id: 'catena-john-1-1#2', kind: 'text' }]);
        expect(unresolved([], [])).toEqual([]);
    });
});

describe('sequential tiers', () => {
    it('blocks on structure, then identity, then lexical text, and never on benign text', async () => {
        const { tiers } = await import('./accept-catena-aurea.js');
        expect(tiers([{ id: 'a', kind: 'missing-excerpt' }, { id: 'b', kind: 'author' }, { id: 'c', kind: 'text', review: 'lexical' }]).blocking).toBe('structural');
        expect(tiers([{ id: 'b', kind: 'author' }, { id: 'c', kind: 'text', review: 'lexical' }]).blocking).toBe('identity');
        expect(tiers([{ id: 'c', kind: 'text', review: 'lexical' }]).blocking).toBe('text');
        expect(tiers([{ id: 'c', kind: 'text', review: 'benign-ocr' }]).blocking).toBeNull();
    });
});
