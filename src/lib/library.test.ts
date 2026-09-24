import { describe, expect, it } from 'vitest';
import type { ResourceDescriptor, Translation } from '@codex-scriptura/core';
import { LIBRARY_CATEGORIES, countFor, filterItems, libraryItems } from './library';

const t = (id: string, extra: Partial<Translation> = {}): Translation =>
    ({ id, name: `${id} name`, abbreviation: id, language: 'en', license: 'Public Domain', description: '', verseCount: 100, ...extra }) as Translation;

describe('library', () => {
    const items = libraryItems([t('KJV', { strongs: true, aligned: true }), t('WEB', { strongs: true }), t('OEB', { coverage: 'NT only' })], new Set(['KJV']));

    it('has the four categories, translations without a planned milestone', () => {
        expect(LIBRARY_CATEGORIES.map((c) => c.kind)).toEqual(['translation', 'manuscript', 'lexicon', 'fathers']);
        expect(LIBRARY_CATEGORIES[0].plannedIn).toBeUndefined();
        expect(LIBRARY_CATEGORIES.slice(1).every((c) => c.plannedIn)).toBe(true);
    });
    it('builds a metadata line from the catalog record', () => {
        expect(items[0].meta).toBe("Translation · Strong's, word-aligned · Public Domain");
        expect(items[1].meta).toBe("Translation · Strong's · red letter · Public Domain");
        expect(items[2].meta).toBe('Translation · NT only · Public Domain');
    });
    it('prefers the resource descriptor\'s license over the catalog copy (issue #51)', () => {
        const oeb: ResourceDescriptor = {
            id: 'oeb', type: 'translation', title: 'Open English Bible', version: 'r1',
            license: { spdx: 'CC0-1.0', name: 'Public domain (CC0)' },
            provenance: [{ sourceId: 'oeb-text', name: 'OEB', url: 'https://example.org', license: 'CC0-1.0' }],
        };
        const withDescriptor = libraryItems([t('OEB', { resourceId: 'oeb' }), t('YLT', { resourceId: 'ylt' })], new Set(), new Map([[oeb.id, oeb]]));
        expect(withDescriptor[0].meta).toBe('Translation · Public domain (CC0)');
        expect(withDescriptor[1].meta).toBe('Translation · Public Domain');
    });
    it('filters by kind and installed', () => {
        expect(filterItems(items, 'installed').map((i) => i.id)).toEqual(['KJV']);
        expect(countFor(items, 'translation')).toBe(3);
        expect(countFor(items, 'manuscript')).toBe(0);
        expect(countFor(items, 'all')).toBe(3);
    });
});
