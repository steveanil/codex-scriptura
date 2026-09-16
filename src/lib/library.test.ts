import { describe, expect, it } from 'vitest';
import type { Translation } from '@codex-scriptura/core';
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
    it('filters by kind and installed', () => {
        expect(filterItems(items, 'installed').map((i) => i.id)).toEqual(['KJV']);
        expect(countFor(items, 'translation')).toBe(3);
        expect(countFor(items, 'manuscript')).toBe(0);
        expect(countFor(items, 'all')).toBe(3);
    });
});
