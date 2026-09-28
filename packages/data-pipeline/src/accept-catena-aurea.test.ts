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
