import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { db } from './database';

describe('schema hygiene (issue #173)', () => {
    it('declares only the queried indexes on verses and crossReferences', () => {
        expect(db.verses.schema.indexes.map((i) => i.name).sort()).toEqual(
            ['[translationId+book+chapter]', '[translationId+osisId]', 'translationId'].sort()
        );
        expect(db.crossReferences.schema.indexes.map((i) => i.name).sort()).toEqual(
            ['sourceVerse', 'targetVerse']
        );
    });
});
