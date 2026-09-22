import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { db } from './database';
import { searchLexicon } from './lexicon';

describe('searchLexicon diacritic folding', () => {
    it('matches accented transliterations from plain-ASCII queries', async () => {
        await db.lexicon.put({ id: 'G26', strongsNumber: 'G26', language: 'greek', lemma: 'ἀγάπη', transliteration: 'agápē', gloss: 'love, benevolence' });
        const hits = await searchLexicon('agape');
        expect(hits.map(e => e.id)).toContain('G26');
    });
});
