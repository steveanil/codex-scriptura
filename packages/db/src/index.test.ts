import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { db, getBookList, getChapterList, getVerse, getKv, setKv, deleteKv, parseStrongsQuery, strongsSearch, getStrongsForVerse, parseAlignment, lemmaGroupSearch, searchLexicon, themeSlug, getThemes, getThemeAnnotations, observeAnnotationsForBook, observeAllAnnotations, saveAnnotation, deleteAnnotation, searchTopics, getTopicById, clearTopicIndexCache, wordSearch, getInstalledTranslationIds, removeTranslationData, getCrossReferencesForChapter, getCrossReferencesForVerse, getBookCrossReferenceMatrix } from './index';
import type { Annotation, CrossReference, Topic } from '@codex-scriptura/core';

beforeAll(async () => {
    await db.verses.bulkPut([
        { id: 'KJV.Gen.1.1', translationId: 'KJV', book: 'Gen', chapter: 1, verse: 1, osisId: 'Gen.1.1', text: 'a' },
        { id: 'KJV.Gen.1.2', translationId: 'KJV', book: 'Gen', chapter: 1, verse: 2, osisId: 'Gen.1.2', text: 'b' },
        { id: 'KJV.Gen.2.1', translationId: 'KJV', book: 'Gen', chapter: 2, verse: 1, osisId: 'Gen.2.1', text: 'c' },
        { id: 'KJV.Matt.1.1', translationId: 'KJV', book: 'Matt', chapter: 1, verse: 1, osisId: 'Matt.1.1', text: 'd' },
        // Different translation - must never bleed into KJV results
        { id: 'WEB.Exod.1.1', translationId: 'WEB', book: 'Exod', chapter: 1, verse: 1, osisId: 'Exod.1.1', text: 'e' },
        // Bridged record: verses 15–16 stored once under verse 15
        { id: 'WEB.Neh.7.15', translationId: 'WEB', book: 'Neh', chapter: 7, verse: 15, verseEnd: 16, osisId: 'Neh.7.15', text: 'bridged' },
    ]);
});

describe('getVerse (bridge-aware)', () => {
    it('returns a direct match', async () => {
        expect((await getVerse('KJV', 'Gen.1.2'))?.text).toBe('b');
    });

    it('resolves the second verse of a bridge to the bridge record', async () => {
        const v = await getVerse('WEB', 'Neh.7.16');
        expect(v?.osisId).toBe('Neh.7.15');
        expect(v?.verseEnd).toBe(16);
    });

    it('does not resolve verses outside the bridge range', async () => {
        expect(await getVerse('WEB', 'Neh.7.17')).toBeUndefined();
        expect(await getVerse('KJV', 'Neh.7.16')).toBeUndefined();
    });
});

describe('getBookList (index-only scan)', () => {
    it('returns canonical-ordered books for the given translation only', async () => {
        expect(await getBookList('KJV')).toEqual(['Gen', 'Matt']);
        expect(await getBookList('WEB')).toEqual(['Exod', 'Neh']);
    });

    it('returns empty for an unseeded translation', async () => {
        expect(await getBookList('OEB')).toEqual([]);
    });
});

describe('getChapterList (index-only scan)', () => {
    it('returns sorted chapters for a book, scoped to the translation', async () => {
        expect(await getChapterList('KJV', 'Gen')).toEqual([1, 2]);
        expect(await getChapterList('KJV', 'Matt')).toEqual([1]);
        expect(await getChapterList('WEB', 'Gen')).toEqual([]);
    });
});

describe('parseStrongsQuery', () => {
    it('normalizes case and strips leading zeros', () => {
        expect(parseStrongsQuery('h7225')).toBe('H7225');
        expect(parseStrongsQuery('G0026')).toBe('G26');
        expect(parseStrongsQuery(' H430 ')).toBe('H430');
    });

    it('rejects non-Strong\'s queries', () => {
        expect(parseStrongsQuery('love')).toBeNull();
        expect(parseStrongsQuery('H')).toBeNull();
        expect(parseStrongsQuery('H72a5')).toBeNull();
        expect(parseStrongsQuery('X430')).toBeNull();
        expect(parseStrongsQuery('H430 G26')).toBeNull();
        expect(parseStrongsQuery('H123456')).toBeNull();
    });
});

describe('strongsSearch', () => {
    beforeAll(async () => {
        await db.verses.bulkPut([
            { id: 'ASV.Gen.1.1', translationId: 'ASV', book: 'Gen', chapter: 1, verse: 1, osisId: 'Gen.1.1', text: 'In the beginning God created', lemmas: 'H8064 H1254 H7225' },
            { id: 'ASV.Gen.1.2', translationId: 'ASV', book: 'Gen', chapter: 1, verse: 2, osisId: 'Gen.1.2', text: 'And the earth was waste', lemmas: 'H776 H1961' },
            // H1254 appears twice in one verse - hitCount must reflect it
            { id: 'ASV.Gen.2.4', translationId: 'ASV', book: 'Gen', chapter: 2, verse: 4, osisId: 'Gen.2.4', text: 'These are the generations', lemmas: 'H1254 H8064 H1254' },
        ]);
        await db.lexicon.bulkPut([
            { id: 'H7225', strongsNumber: 'H7225', language: 'hebrew', lemma: 'רֵאשִׁית', transliteration: "re'shith", gloss: 'beginning' },
            { id: 'H1254', strongsNumber: 'H1254', language: 'hebrew', lemma: 'בָּרָא', transliteration: 'bara', gloss: 'to create' },
        ]);
    });

    it('finds every verse whose lemma tokens include the ID, with per-verse counts', async () => {
        const results = await strongsSearch('ASV', 'H1254');
        expect(results.map(r => r.verse.osisId)).toEqual(['Gen.1.1', 'Gen.2.4']);
        expect(results.map(r => r.hitCount)).toEqual([1, 2]);
    });

    it('matches whole tokens only (H725/H7225 must not cross-match) and normalizes the query', async () => {
        expect(await strongsSearch('ASV', 'H725')).toEqual([]);
        expect((await strongsSearch('ASV', 'h7225')).map(r => r.verse.osisId)).toEqual(['Gen.1.1']);
    });

    it('returns nothing for untagged translations and non-Strong\'s queries', async () => {
        expect(await strongsSearch('KJV', 'H1254')).toEqual([]);
        expect(await strongsSearch('ASV', 'beginning')).toEqual([]);
    });
});

describe('parseAlignment', () => {
    it('parses [start, end, ids] triples into typed spans', () => {
        expect(parseAlignment('[[0,16,"H7225"],[17,20,"H853 H430"]]')).toEqual([
            { start: 0, end: 16, strongs: ['H7225'] },
            { start: 17, end: 20, strongs: ['H853', 'H430'] },
        ]);
    });

    it('returns empty for absent or malformed alignment', () => {
        expect(parseAlignment(undefined)).toEqual([]);
        expect(parseAlignment('not json')).toEqual([]);
    });
});

describe('word-aligned search (issue #27)', () => {
    // A miniature tagged translation. "loved" is agapao (G25) in John 3:16
    // and phileo (G5368) in John 11:3; Rom 12:9's "love" is deliberately
    // untagged; Ps 11:7 is OT with a two-ID span (particle riding along).
    beforeAll(async () => {
        await db.verses.bulkPut([
            {
                id: 'DBY.John.3.16', translationId: 'DBY', book: 'John', chapter: 3, verse: 16, osisId: 'John.3.16',
                text: 'For God so loved the world',
                lemmas: 'G2316 G25 G2889',
                align: '[[4,7,"G2316"],[11,16,"G25"],[21,26,"G2889"]]',
            },
            {
                id: 'DBY.John.11.3', translationId: 'DBY', book: 'John', chapter: 11, verse: 3, osisId: 'John.11.3',
                text: 'he whom thou lovest is sick',
                lemmas: 'G5368',
                align: '[[13,19,"G5368"]]',
            },
            {
                id: 'DBY.Rom.12.9', translationId: 'DBY', book: 'Rom', chapter: 12, verse: 9, osisId: 'Rom.12.9',
                text: 'Let love be unfeigned',
                lemmas: 'G505',
                align: '[[12,21,"G505"]]',
            },
            {
                id: 'DBY.Ps.11.7', translationId: 'DBY', book: 'Ps', chapter: 11, verse: 7, osisId: 'Ps.11.7',
                text: 'the LORD loveth righteousness',
                lemmas: 'H3068 H157 H6664',
                align: '[[4,8,"H3068"],[9,15,"H157 H853"],[16,29,"H6664"]]',
            },
        ]);
        await db.lexicon.bulkPut([
            { id: 'G25', strongsNumber: 'G25', language: 'greek', lemma: 'ἀγαπάω', transliteration: 'agapao', gloss: 'to love' },
            { id: 'G5368', strongsNumber: 'G5368', language: 'greek', lemma: 'φιλέω', transliteration: 'phileo', gloss: 'to love, kiss' },
            { id: 'H157', strongsNumber: 'H157', language: 'hebrew', lemma: 'אָהַב', transliteration: 'ahab', gloss: 'to love' },
        ]);
    });

    describe('lemmaGroupSearch', () => {
        it('groups occurrences of an English word by aligned lemma, untagged last', async () => {
            const { groups, totalHits, totalVerses } = await lemmaGroupSearch('DBY', 'love', true);
            expect(totalHits).toBe(4);
            expect(totalVerses).toBe(4);
            // One hit each: G25, G5368, H157 (+H853), untagged bucket for Rom 12:9
            const ids = groups.map(g => g.strongsId);
            expect(ids).toContain('G25');
            expect(ids).toContain('G5368');
            expect(ids).toContain('H157');
            expect(ids).toContain('H853');
            expect(ids[ids.length - 1]).toBeNull();
            const agapao = groups.find(g => g.strongsId === 'G25')!;
            expect(agapao.entry?.transliteration).toBe('agapao');
            expect(agapao.hitCount).toBe(1);
            expect(agapao.surfaces).toEqual([{ surface: 'loved', count: 1 }]);
            expect(agapao.results.map(r => r.verse.osisId)).toEqual(['John.3.16']);
        });

        it('counts a multi-ID span once in totalHits but in each ID group', async () => {
            const { groups, totalHits } = await lemmaGroupSearch('DBY', 'loveth', false);
            expect(totalHits).toBe(1);
            expect(groups.find(g => g.strongsId === 'H157')?.hitCount).toBe(1);
            expect(groups.find(g => g.strongsId === 'H853')?.hitCount).toBe(1);
        });

        it('collects unaligned occurrences in the null group', async () => {
            const { groups } = await lemmaGroupSearch('DBY', 'love', false);
            const untagged = groups.find(g => g.strongsId === null)!;
            expect(untagged.results.map(r => r.verse.osisId)).toEqual(['Rom.12.9']);
            expect(untagged.entry).toBeNull();
        });

        it('applies the testament filter before grouping', async () => {
            const nt = await lemmaGroupSearch('DBY', 'love', true, 'NT');
            expect(nt.totalHits).toBe(3);
            expect(nt.groups.some(g => g.strongsId === 'H157')).toBe(false);
        });

        it('missing lexicon entries yield a group with entry null', async () => {
            const { groups } = await lemmaGroupSearch('DBY', 'love', true);
            const world = groups.find(g => g.strongsId === 'H853');
            expect(world?.entry).toBeNull();
        });
    });

    describe('searchLexicon diacritic folding', () => {
        it('matches accented transliterations from plain-ASCII queries', async () => {
            await db.lexicon.put({ id: 'G26', strongsNumber: 'G26', language: 'greek', lemma: 'ἀγάπη', transliteration: 'agápē', gloss: 'love, benevolence' });
            const hits = await searchLexicon('agape');
            expect(hits.map(e => e.id)).toContain('G26');
        });
    });

    describe('strongsSearch with alignment', () => {
        it('reports the real English surface and true occurrence count', async () => {
            const results = await strongsSearch('DBY', 'G25');
            expect(results).toHaveLength(1);
            expect(results[0].matches).toEqual([{ surface: 'loved', count: 1 }]);
            expect(results[0].hitCount).toBe(1);
        });

        it('finds IDs that only appear inside multi-ID spans', async () => {
            // H853 is in the align span but NOT in the deduped lemma bag?
            // No - lemmas is a superset by construction. Here it's absent
            // from lemmas, so the verse must NOT match (lemmas gates the scan).
            expect(await strongsSearch('DBY', 'H853')).toEqual([]);
            // H157 is in both: alignment supplies the surface.
            const results = await strongsSearch('DBY', 'H157');
            expect(results[0].matches).toEqual([{ surface: 'loveth', count: 1 }]);
        });
    });
});

describe('getStrongsForVerse', () => {
    it('returns the lexicon entries for a tagged verse, deduplicated', async () => {
        const entries = await getStrongsForVerse('ASV', 'Gen.2.4');
        expect(entries.map(e => e.id)).toEqual(['H1254']);
    });

    it('returns empty for untagged verses and unknown references', async () => {
        expect(await getStrongsForVerse('KJV', 'Gen.1.1')).toEqual([]);
        expect(await getStrongsForVerse('ASV', 'Gen.99.1')).toEqual([]);
    });
});

describe('kv store', () => {
    it('round-trips structured values', async () => {
        await setKv('t', { count: 2, locations: [{ book: 'Gen', chapter: 1 }] });
        expect(await getKv<{ count: number }>('t')).toEqual({
            count: 2,
            locations: [{ book: 'Gen', chapter: 1 }],
        });
    });

    it('overwrites on repeat set and returns undefined after delete / for missing keys', async () => {
        await setKv('t2', 1);
        await setKv('t2', 2);
        expect(await getKv<number>('t2')).toBe(2);
        await deleteKv('t2');
        expect(await getKv('t2')).toBeUndefined();
        expect(await getKv('never-set')).toBeUndefined();
    });
});

describe('theme threading', () => {
    function theme(over: Partial<Annotation>): Annotation {
        return {
            id: crypto.randomUUID(),
            type: 'theme',
            book: 'Gen',
            verseStart: 'Gen.1.1',
            verseEnd: 'Gen.1.1',
            data: 'Covenant',
            tags: ['covenant'],
            created: 1,
            modified: 1,
            synced: false,
            ...over,
        };
    }

    it('themeSlug normalizes labels to a shared thread identity', () => {
        expect(themeSlug('Covenant')).toBe('covenant');
        expect(themeSlug("God's Covenant")).toBe('gods-covenant');
        expect(themeSlug('  Kingdom of God! ')).toBe('kingdom-of-god');
        expect(themeSlug('!!!')).toBe('');
    });

    it('getThemes groups by slug, counts ranges, and prefers the latest label', async () => {
        await db.annotations.bulkPut([
            theme({ modified: 1 }),
            theme({ verseStart: 'Exod.19.5', verseEnd: 'Exod.19.6', book: 'Exod', data: 'covenant', modified: 5 }),
            theme({ data: 'Faith', tags: ['faith'] }),
            // Non-theme annotations with matching tags must not leak in
            { id: 'n1', type: 'note', book: 'Gen', verseStart: 'Gen.2.1', verseEnd: 'Gen.2.1', data: 'note', tags: ['covenant'], created: 1, modified: 1, synced: false },
        ]);
        const themes = await getThemes();
        const covenant = themes.find(t => t.slug === 'covenant');
        expect(covenant).toEqual({ slug: 'covenant', label: 'covenant', count: 2 });
        expect(themes.find(t => t.slug === 'faith')?.count).toBe(1);
    });

    it('getThemeAnnotations resolves via the tags index and excludes other types', async () => {
        const anns = await getThemeAnnotations('covenant');
        expect(anns).toHaveLength(2);
        expect(anns.every(a => a.type === 'theme')).toBe(true);
    });
});

describe('topical index (issue #28)', () => {
    beforeAll(async () => {
        const topic = (id: string, name: string, refCount: number): Topic => ({
            id, name, refCount,
            sections: [{ heading: 'GENERAL', entries: [{ label: '', refs: [{ osis: 'Gen.1.1', label: 'Ge 1:1' }] }], seeAlso: [] }],
            seeAlso: [],
        });
        await db.topics.bulkPut([
            topic('faith', 'Faith', 300),
            topic('faithfulness', 'Faithfulness', 60),
            topic('unfaithfulness', 'Unfaithfulness', 20),
            topic('shield-of-faith', 'Shield Of Faith', 5),
            topic('forgiveness', 'Forgiveness', 46),
        ]);
        clearTopicIndexCache();
    });

    it('ranks exact > prefix > word-boundary > substring', async () => {
        const results = await searchTopics('faith');
        expect(results.map((t) => t.id)).toEqual([
            'faith',            // exact
            'faithfulness',     // prefix
            'shield-of-faith',  // word boundary
            'unfaithfulness',   // substring
        ]);
    });

    it('breaks ties by reference count', async () => {
        const results = await searchTopics('f');
        const prefixed = results.filter((t) => t.name.toLowerCase().startsWith('f'));
        expect(prefixed[0].id).toBe('faith'); // 300 refs beats the others
    });

    it('returns the full record via getTopicById', async () => {
        const topic = await getTopicById('forgiveness');
        expect(topic?.name).toBe('Forgiveness');
        expect(topic?.sections[0].entries[0].refs[0].osis).toBe('Gen.1.1');
    });

    it('returns nothing for a blank query', async () => {
        expect(await searchTopics('   ')).toEqual([]);
    });
});

describe('observeAnnotationsForBook (issue #31)', () => {
    // Uses a book no other test touches so emissions are deterministic.
    const ann: Annotation = {
        id: 'live1',
        type: 'highlight',
        book: 'Rom',
        verseStart: 'Rom.8.1',
        verseEnd: 'Rom.8.1',
        data: '#ffff00',
        tags: [],
        created: 1,
        modified: 1,
        synced: false,
    };

    it('emits the current set, then re-emits on save and delete without a manual reload', async () => {
        const emissions: Annotation[][] = [];
        const sub = observeAnnotationsForBook('Rom').subscribe({
            next: (anns) => emissions.push(anns),
        });

        await vi.waitFor(() => expect(emissions.length).toBeGreaterThanOrEqual(1));
        expect(emissions[emissions.length - 1]).toEqual([]);

        await saveAnnotation({ ...ann });
        await vi.waitFor(() =>
            expect(emissions[emissions.length - 1].map((a) => a.id)).toEqual(['live1'])
        );

        await deleteAnnotation('live1');
        await vi.waitFor(() => expect(emissions[emissions.length - 1]).toEqual([]));

        sub.unsubscribe();
    });

    it('does not re-emit for writes to other books', async () => {
        const emissions: Annotation[][] = [];
        const sub = observeAnnotationsForBook('Rom').subscribe({
            next: (anns) => emissions.push(anns),
        });
        await vi.waitFor(() => expect(emissions.length).toBeGreaterThanOrEqual(1));
        const before = emissions.length;

        await saveAnnotation({ ...ann, id: 'live2', book: 'Phil', verseStart: 'Phil.1.1', verseEnd: 'Phil.1.1' });
        // Give the observability engine a beat to (not) fire.
        await new Promise((r) => setTimeout(r, 50));
        expect(emissions.length).toBe(before);

        sub.unsubscribe();
        await deleteAnnotation('live2');
    });
});

describe('observeAllAnnotations (issue #185)', () => {
    // The All tab regression: a delete in a book other than the one the
    // per-book query watches must still reach subscribers.
    const ann: Annotation = {
        id: 'all1',
        type: 'note',
        book: 'Jude',
        verseStart: 'Jude.1.3',
        verseEnd: 'Jude.1.3',
        data: 'contend for the faith',
        tags: [],
        created: 1,
        modified: 1,
        synced: false,
    };

    it('re-emits on save and delete regardless of book', async () => {
        const emissions: Annotation[][] = [];
        const sub = observeAllAnnotations().subscribe({
            next: (anns) => emissions.push(anns),
        });
        await vi.waitFor(() => expect(emissions.length).toBeGreaterThanOrEqual(1));

        await saveAnnotation({ ...ann });
        await vi.waitFor(() =>
            expect(emissions[emissions.length - 1].map((a) => a.id)).toContain('all1')
        );

        await deleteAnnotation('all1');
        await vi.waitFor(() =>
            expect(emissions[emissions.length - 1].map((a) => a.id)).not.toContain('all1')
        );

        sub.unsubscribe();
    });
});

describe('wordSearch apostrophes (issue #178)', () => {
    beforeAll(async () => {
        // The processed corpus stores possessives with U+2019, never U+0027
        await db.verses.bulkPut([
            { id: 'KJV.Ps.24.1', translationId: 'KJV', book: 'Ps', chapter: 24, verse: 1, osisId: 'Ps.24.1', text: 'The earth is the Lord’s, and the fulness thereof' },
        ]);
    });

    it('matches curly-apostrophe corpus text from a straight-apostrophe query', async () => {
        const results = await wordSearch('KJV', "Lord's");
        expect(results.map((r) => r.verse.osisId)).toContain('Ps.24.1');
    });

    it('matches from curly and modifier-letter apostrophe queries too', async () => {
        expect((await wordSearch('KJV', 'Lord’s')).map((r) => r.verse.osisId)).toContain('Ps.24.1');
        expect((await wordSearch('KJV', 'Lordʼs')).map((r) => r.verse.osisId)).toContain('Ps.24.1');
    });

    it('keeps the apostrophe as a word boundary for bare-word queries', async () => {
        // "Lord" as a whole word still matches inside "Lord’s" - unchanged behavior
        expect((await wordSearch('KJV', 'Lord')).map((r) => r.verse.osisId)).toContain('Ps.24.1');
    });
});

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

    it('counts each pair once in the book matrix, in its stored orientation', async () => {
        const matrix = await getBookCrossReferenceMatrix();
        expect(matrix.get('John')?.get('Gen')).toBe(1);
        expect(matrix.get('Gen')?.get('John')).toBeUndefined();
        expect(matrix.get('Gen')?.get('Gen')).toBe(2);
    });
});

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

describe('translation library (issue #238)', () => {
    it('lists installed translation ids from the verses index', async () => {
        // ASV and DBY were seeded by the Strong's / alignment suites above
        expect(await getInstalledTranslationIds()).toEqual(['ASV', 'DBY', 'KJV', 'WEB']);
    });

    it('removeTranslationData deletes verses and per-translation index caches only', async () => {
        await db.translations.bulkPut([
            { id: 'ZZZ', name: 'Test', abbreviation: 'ZZZ', language: 'en', license: 'PD', description: '', verseCount: 1 },
            { id: 'KJV', name: 'KJV', abbreviation: 'KJV', language: 'en', license: 'PD', description: '', verseCount: 4 },
        ]);
        await db.verses.put({ id: 'ZZZ.Gen.1.1', translationId: 'ZZZ', book: 'Gen', chapter: 1, verse: 1, osisId: 'Gen.1.1', text: 'z' });
        await db.searchIndexes.bulkPut([
            { id: 'minisearch:ZZZ', translationId: 'ZZZ', serializedIndex: '{}', verseCount: 1, createdAt: 0 },
            { id: 'palette:ZZZ', translationId: 'ZZZ', serializedIndex: '{}', verseCount: 1, createdAt: 0 },
            { id: 'minisearch:KJV', translationId: 'KJV', serializedIndex: '{}', verseCount: 4, createdAt: 0 },
        ]);

        const kjvBefore = await db.verses.where('translationId').equals('KJV').count();
        await removeTranslationData('ZZZ');

        expect(await getInstalledTranslationIds()).toEqual(['ASV', 'DBY', 'KJV', 'WEB']);
        expect(await db.searchIndexes.where('translationId').equals('ZZZ').count()).toBe(0);
        // Other translations' verses and caches are untouched
        expect(await db.searchIndexes.get('minisearch:KJV')).toBeDefined();
        expect(await db.verses.where('translationId').equals('KJV').count()).toBe(kjvBefore);
        // The catalog record survives with verseCount zeroed (re-downloadable)
        expect((await db.translations.get('ZZZ'))?.verseCount).toBe(0);
    });
});
