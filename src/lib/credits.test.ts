import { describe, expect, it } from 'vitest';
import type { ResourceDescriptor } from '@codex-scriptura/core';
import { creditGroups, resourceTypeLabel, sourceIdentity } from './credits';

const r = (id: string, type: ResourceDescriptor['type'], title: string, extra: Partial<ResourceDescriptor> = {}): ResourceDescriptor => ({
    id, type, title, version: 'r1',
    license: { spdx: 'public-domain', name: 'Public domain' },
    provenance: [{ sourceId: `${id}-source`, name: title, url: `https://example.org/${id}`, license: 'public-domain' }],
    ...extra,
});

describe('credits (issue #235)', () => {
    it('groups translations first, then datasets, each by title', () => {
        const groups = creditGroups([
            r('naves', 'topical-index', "Nave's Topical Bible"),
            r('web', 'translation', 'World English Bible'),
            r('cross-references', 'cross-references', 'Cross-references'),
            r('kjv', 'translation', 'King James Version'),
        ], new Set(['kjv', 'naves']));
        expect(groups.map((g) => g.label)).toEqual(['Translations', 'Datasets']);
        expect(groups[0].items.map((i) => i.resource.id)).toEqual(['kjv', 'web']);
        expect(groups[1].items.map((i) => i.resource.id)).toEqual(['cross-references', 'naves']);
        expect(groups[0].items.map((i) => i.installed)).toEqual([true, false]);
        expect(groups[1].items[1].typeLabel).toBe('Topical index');
    });

    it('omits an empty group', () => {
        expect(creditGroups([r('kjv', 'translation', 'KJV')], new Set()).map((g) => g.label)).toEqual(['Translations']);
        expect(creditGroups([], new Set())).toEqual([]);
    });

    it('builds a byline from author and publisher', () => {
        const items = creditGroups([
            r('a', 'dictionary', 'A', { author: 'M. G. Easton' }),
            r('b', 'topical-index', 'B', { author: 'O. J. Nave', publisher: 'CrossWire Bible Society' }),
            r('c', 'genealogy', 'C'),
        ], new Set())[0].items;
        expect(items.map((i) => i.byline)).toEqual(['by M. G. Easton', 'by O. J. Nave · CrossWire Bible Society', '']);
    });

    it('describes how a source was fixed: a pin, an accepted download, or nothing', () => {
        const base = { sourceId: 's', name: 'S', url: 'https://s', license: 'CC-BY-4.0' };
        expect(sourceIdentity({ ...base, version: '3d15126fb1ef74867fc1434be1942e837932691f' })).toBe('Pinned at 3d15126');
        expect(sourceIdentity({ ...base, accepted: '2026-07-22', checksum: 'x' })).toBe('Accepted 2026-07-22');
        expect(sourceIdentity(base)).toBe('');
        expect(resourceTypeLabel('entities')).toBe('People, places and events');
    });
});
