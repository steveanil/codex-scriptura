import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import type { CrossReference } from '@codex-scriptura/core';
import { db } from './database';
import { getCrossReferencesForChapter, getCrossReferencesForVerse } from './cross-references';

describe('cross-references stored once per pair (issue #183)', () => {
    const xref = (sourceVerse: string, targetVerse: string, votes: number, type: CrossReference['type'] = 'theme'): CrossReference =>
        ({ id: `${sourceVerse}→${targetVerse}`, sourceVerse, targetVerse, type, votes });

    beforeAll(async () => {
        await db.crossReferences.clear();
        await db.crossReferences.bulkPut([
            xref('Jer.10.12', 'Gen.1.1', 77),                        // Gen 1:1 is the earlier end
            xref('Gen.1.2', 'Gen.1.1', 9, 'parallel'),               // intra-chapter
            xref('John.1.3', 'Gen.1.1', 120, 'quotation'),
            xref('Gen.2.4', 'Gen.1.1', 4, 'parallel'),               // same book, next chapter
            xref('Matt.1.23', 'Isa.7.14', 183, 'quotation'),         // unrelated to Gen 1
        ]);
    });

    it('files a pair under whichever endpoint is in the chapter, both for intra-chapter links', async () => {
        const map = await getCrossReferencesForChapter('Gen', 1);
        expect([...map.keys()].sort()).toEqual(['Gen.1.1', 'Gen.1.2']);
        expect(map.get('Gen.1.1')!.map((r) => r.id)).toEqual([
            'John.1.3→Gen.1.1', 'Jer.10.12→Gen.1.1', 'Gen.1.2→Gen.1.1', 'Gen.2.4→Gen.1.1',
        ]); // votes descending
        expect(map.get('Gen.1.2')!.map((r) => r.id)).toEqual(['Gen.1.2→Gen.1.1']);
    });

    it('the later-chapter end sees the link too', async () => {
        const map = await getCrossReferencesForChapter('Gen', 2);
        expect(map.get('Gen.2.4')!.map((r) => r.id)).toEqual(['Gen.2.4→Gen.1.1']);
    });

    it('returns each pair exactly once for a verse regardless of its end', async () => {
        expect((await getCrossReferencesForVerse('Gen.1.1')).map((r) => r.id).sort()).toEqual([
            'Gen.1.2→Gen.1.1', 'Gen.2.4→Gen.1.1', 'Jer.10.12→Gen.1.1', 'John.1.3→Gen.1.1',
        ]);
        expect((await getCrossReferencesForVerse('Isa.7.14')).map((r) => r.id)).toEqual(['Matt.1.23→Isa.7.14']);
    });

});
