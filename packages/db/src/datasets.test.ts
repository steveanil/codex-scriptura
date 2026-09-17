import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import Dexie from 'dexie';
import type { DatasetManifestEntry, InstalledDataset } from '@codex-scriptura/core';

// Exactly the stores a v29 profile has, so opening CodexDB on top of it
// exercises the real v29 -> v30 upgrade rather than a fresh create.
const V29_STORES = {
    verses: 'id, translationId, [translationId+book+chapter], [translationId+osisId]',
    translations: 'id',
    annotations: 'id, type, book, verseStart, verseEnd, *tags, created, modified',
    tags: 'id, name',
    settings: 'id',
    savedSearches: 'id, created',
    persons: 'id, name, *verseRefs',
    places: 'id, name, lat, lng, *verseRefs',
    events: 'id, name, *verseRefs',
    dictionary: 'id, term',
    searchIndexes: 'id, translationId',
    crossReferences: 'id, sourceVerse, targetVerse',
    relationships: 'id, personFrom, personTo, type, [personFrom+type], [personTo+type]',
    lexicon: 'id, strongsNumber, language, lemma',
    topics: 'id, name',
    kv: 'id',
};

const hash = (seed: string) => seed.padEnd(64, '0');
const entry = (id: string, seed: string, recordCount = 1): DatasetManifestEntry => ({
    id,
    version: seed.slice(0, 12).padEnd(12, '0'),
    contentHash: hash(seed),
    recordCount,
    files: [`${id}.json`],
});

type Db = typeof import('./index');
let m: Db;

beforeAll(async () => {
    const legacy = new Dexie('codex-scriptura');
    legacy.version(29).stores(V29_STORES);
    await legacy.open();
    await legacy.table('verses').bulkPut([
        { id: 'KJV.Gen.1.1', translationId: 'KJV', book: 'Gen', chapter: 1, verse: 1, osisId: 'Gen.1.1', text: 'a' },
        { id: 'KJV.Gen.1.2', translationId: 'KJV', book: 'Gen', chapter: 1, verse: 2, osisId: 'Gen.1.2', text: 'b' },
        { id: 'WEB.Gen.1.1', translationId: 'WEB', book: 'Gen', chapter: 1, verse: 1, osisId: 'Gen.1.1', text: 'c' },
    ]);
    await legacy.table('translations').bulkPut([
        { id: 'KJV', name: 'KJV', abbreviation: 'KJV', language: 'en', license: 'PD', description: '', verseCount: 2 },
        { id: 'WEB', name: 'WEB', abbreviation: 'WEB', language: 'en', license: 'PD', description: '', verseCount: 1 },
    ]);
    await legacy.table('persons').put({ id: 'aaron_1', name: 'Aaron', verseRefs: ['Exod.4.14'] });
    await legacy.table('crossReferences').put({ id: 'Gen.1.1→Ps.136.5', sourceVerse: 'Ps.136.5', targetVerse: 'Gen.1.1', type: 'theme', votes: 1 });
    await legacy.table('lexicon').bulkPut([
        { id: 'H1', strongsNumber: 'H1', language: 'hebrew', lemma: 'אָב', transliteration: 'ab', gloss: 'father', description: '' },
        { id: 'G1', strongsNumber: 'G1', language: 'greek', lemma: 'Α', transliteration: 'A', gloss: 'Alpha', description: '' },
    ]);
    // User-writable tables that reconciliation must never touch
    await legacy.table('annotations').put({ id: 'a1', type: 'note', book: 'Gen', verseStart: 'Gen.1.1', verseEnd: 'Gen.1.1', tags: [], created: 1, modified: 1, data: 'keep me' });
    await legacy.table('kv').put({ id: 'wantedTranslations', value: ['KJV', 'WEB'] });
    await legacy.table('settings').put({ id: 'default', activeTranslation: 'KJV' });
    legacy.close();

    m = await import('./index');
    await m.db.open();
});

describe('compareDataset', () => {
    const e = entry('persons', 'abc');
    it('classifies missing, legacy, stale and current', () => {
        expect(m.compareDataset(undefined, e)).toBe('missing');
        const legacyRow: InstalledDataset = { id: 'persons', version: 'legacy', contentHash: null, installedAt: 0, recordCount: 1 };
        expect(m.compareDataset(legacyRow, e)).toBe('legacy');
        expect(m.compareDataset({ ...legacyRow, version: e.version }, e)).toBe('legacy');
        const current: InstalledDataset = { id: 'persons', version: e.version, contentHash: e.contentHash, installedAt: 0, recordCount: 1 };
        expect(m.compareDataset(current, e)).toBe('current');
        expect(m.compareDataset({ ...current, version: 'other' }, e)).toBe('stale');
        expect(m.compareDataset({ ...current, contentHash: hash('zzz') }, e)).toBe('stale');
        // Record count is a sanity check, never identity
        expect(m.compareDataset({ ...current, recordCount: 999 }, e)).toBe('current');
    });
});

describe('v30 upgrade', () => {
    it('reaches schema 30 with the datasets table', () => {
        expect(m.db.verno).toBe(30);
        expect(m.db.tables.map((t) => t.name)).toContain('datasets');
    });

    it('backfills one legacy row per dataset the profile held, and nothing for empty ones', async () => {
        const rows = await m.listInstalledDatasets();
        const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
        expect(Object.keys(byId).sort()).toEqual(['cross-references', 'lexicon-greek', 'lexicon-hebrew', 'persons', 'translation:kjv', 'translation:web']);
        for (const row of rows) {
            expect(row.version).toBe('legacy');
            expect(row.contentHash).toBeNull();
            expect(row.installedAt).toBeGreaterThan(0);
        }
        expect(byId['translation:kjv'].recordCount).toBe(2);
        expect(byId['translation:web'].recordCount).toBe(1);
        expect(byId['lexicon-hebrew'].recordCount).toBe(1);
    });

    it('leaves user-writable tables and existing data untouched', async () => {
        expect((await m.db.annotations.get('a1'))?.data).toBe('keep me');
        expect(await m.getKv('wantedTranslations')).toEqual(['KJV', 'WEB']);
        expect((await m.db.settings.get('default'))?.activeTranslation).toBe('KJV');
        expect(await m.db.verses.count()).toBe(3);
        expect(await m.db.persons.count()).toBe(1);
    });
});

describe('reconciliation', () => {
    it('reports a legacy row as needing replacement, then current after one install', async () => {
        const e = entry('persons', 'p1', 2);
        expect(await m.getDatasetState(e)).toBe('legacy');

        await m.installWholeTable(e, m.db.persons, [
            { id: 'abel_1', name: 'Abel', verseRefs: [] },
            { id: 'adam_1', name: 'Adam', verseRefs: [] },
        ]);

        expect(await m.getDatasetState(e)).toBe('current');
        expect(await m.getDatasetState(entry('persons', 'p2', 2))).toBe('stale');
        // The previous copy is gone, the new one is in
        expect((await m.db.persons.toCollection().primaryKeys()).sort()).toEqual(['abel_1', 'adam_1']);
        expect((await m.getInstalledDataset('persons'))?.recordCount).toBe(2);
    });

    it('installs part by part, each part its own transaction, identity last', async () => {
        const e = entry('persons', 'p3', 3);
        const seen: Array<{ afterPart: number; rows: number; identity: boolean }> = [];
        async function* parts() {
            const batches = [[{ id: 'cain_1', name: 'Cain', verseRefs: [] }], [{ id: 'seth_1', name: 'Seth', verseRefs: [] }, { id: 'enos_1', name: 'Enos', verseRefs: [] }]];
            for (const [i, records] of batches.entries()) {
                yield { records, index: i, count: batches.length };
                seen.push({ afterPart: i, rows: await m.db.persons.count(), identity: !!(await m.getInstalledDataset('persons')) });
            }
        }
        const progress: number[] = [];
        await m.installDatasetStream(e, m.wholeTablePlan(m.db.persons), parts(), (f) => progress.push(f));

        // The previous copy was cleared before part one; no identity until the end
        expect(seen).toEqual([
            { afterPart: 0, rows: 1, identity: false },
            { afterPart: 1, rows: 3, identity: false },
        ]);
        expect(await m.getDatasetState(e)).toBe('current');
        expect((await m.getInstalledDataset('persons'))?.recordCount).toBe(3);
        expect(progress[progress.length - 1]).toBe(1);
        expect(progress).toEqual([...progress].sort((a, b) => a - b));
    });

    it('leaves no identity when a later part fails, so the dataset reads as missing and reinstalls', async () => {
        const e = entry('persons', 'p4', 2);
        async function* parts() {
            yield { records: [{ id: 'noah_1', name: 'Noah', verseRefs: [] }], index: 0, count: 2 };
            throw new Error('network dropped mid-part');
        }
        await expect(m.installDatasetStream(e, m.wholeTablePlan(m.db.persons), parts())).rejects.toThrow('network dropped');

        expect(await m.getInstalledDataset('persons')).toBeUndefined();
        expect(await m.getDatasetState(e)).toBe('missing');
        // A half-written table is never mistaken for a current one: the next install clears it
        await m.installWholeTable(e, m.db.persons, [{ id: 'abel_1', name: 'Abel', verseRefs: [] }, { id: 'adam_1', name: 'Adam', verseRefs: [] }]);
        expect((await m.db.persons.toCollection().primaryKeys()).sort()).toEqual(['abel_1', 'adam_1']);
        expect(await m.getDatasetState(e)).toBe('current');
    });

    it('replaces only the mismatched dataset', async () => {
        const kjvBefore = await m.getInstalledDataset('translation:kjv');
        const xref = entry('cross-references', 'x1', 1);
        await m.installWholeTable(xref, m.db.crossReferences, [
            { id: 'Gen.1.1→Heb.1.10', sourceVerse: 'Heb.1.10', targetVerse: 'Gen.1.1', type: 'allusion', votes: 5 },
        ]);
        expect(await m.getDatasetState(xref)).toBe('current');
        expect(await m.getInstalledDataset('translation:kjv')).toEqual(kjvBefore);
        expect(await m.db.verses.count()).toBe(3);
    });

    it('installs a partial-table dataset (one lexicon language) without touching the other', async () => {
        const greek = entry('lexicon-greek', 'g1', 1);
        await m.installDatasetStream(greek, {
            tables: [m.db.lexicon],
            clear: () => m.db.lexicon.where('language').equals('greek').delete(),
            insertPart: async (records) => { await m.db.lexicon.bulkPut(records); return records.length; },
        }, m.singlePart([{ id: 'G2', strongsNumber: 'G2', language: 'greek', lemma: 'Ἀαρών', transliteration: 'Aaron', gloss: 'Aaron', description: '' }]));
        expect((await m.db.lexicon.toCollection().primaryKeys()).sort()).toEqual(['G2', 'H1']);
        expect(await m.getDatasetState(greek)).toBe('current');
        expect((await m.getInstalledDataset('lexicon-hebrew'))?.version).toBe('legacy');
    });

    it('records identity for a valid empty dataset so it is not fetched again', async () => {
        const e = entry('genealogy', 'gen0', 0);
        expect(await m.getDatasetState(e)).toBe('missing');
        await m.installWholeTable(e, m.db.relationships, []);
        expect(await m.getDatasetState(e)).toBe('current');
        expect((await m.getInstalledDataset('genealogy'))?.recordCount).toBe(0);
        expect(await m.db.relationships.count()).toBe(0);
        // A second boot with the same manifest leaves it alone
        expect(await m.getDatasetState(e)).toBe('current');
    });

    it('replacing a translation drops only that translation\'s search caches, in the same transaction', async () => {
        await m.db.searchIndexes.bulkPut([
            { id: 'minisearch:KJV', translationId: 'KJV', serializedIndex: '{}', verseCount: 2, createdAt: 0 },
            { id: 'palette:KJV', translationId: 'KJV', serializedIndex: '{}', verseCount: 2, createdAt: 0 },
            { id: 'minisearch:WEB', translationId: 'WEB', serializedIndex: '{}', verseCount: 1, createdAt: 0 },
        ]);
        const kjv = { id: 'KJV', name: 'KJV', abbreviation: 'KJV', language: 'en', license: 'PD', description: '', verseCount: 1 };
        const e = entry('translation:kjv', 'kjv2', 1);
        await m.installTranslationDataset(e, kjv, [
            { id: 'KJV.Gen.1.1', translationId: 'KJV', book: 'Gen', chapter: 1, verse: 1, osisId: 'Gen.1.1', text: 'replaced' },
        ]);
        expect(await m.getDatasetState(e)).toBe('current');
        expect(await m.db.searchIndexes.where('translationId').equals('KJV').count()).toBe(0);
        expect(await m.db.searchIndexes.get('minisearch:WEB')).toBeDefined();
        expect((await m.db.verses.where('translationId').equals('KJV').toArray()).map((v) => v.text)).toEqual(['replaced']);
        expect((await m.db.translations.get('KJV'))?.verseCount).toBe(1);
    });

    it('a failed translation replacement leaves no identity and no stale cache; the catalog record waits for the last part', async () => {
        await m.db.searchIndexes.put({ id: 'minisearch:KJV', translationId: 'KJV', serializedIndex: '{}', verseCount: 1, createdAt: 1 });
        const kjv = { id: 'KJV', name: 'KJV', abbreviation: 'KJV', language: 'en', license: 'PD', description: '', verseCount: 0 };
        const e = entry('translation:kjv', 'kjv3', 2);
        async function* parts() {
            yield { records: [{ id: 'KJV.Gen.1.1', translationId: 'KJV', book: 'Gen', chapter: 1, verse: 1, osisId: 'Gen.1.1', text: 'half' }], index: 0, count: 2 };
            throw new Error('tab died');
        }
        await expect(m.installDatasetStream(e, m.translationInstallPlan(kjv), parts())).rejects.toThrow('tab died');

        expect(await m.getInstalledDataset('translation:kjv')).toBeUndefined();
        expect(await m.getDatasetState(e)).toBe('missing');
        // The old cache went with the old verses in the first transaction, so nothing answers from the previous text
        expect(await m.db.searchIndexes.get('minisearch:KJV')).toBeUndefined();
        // The partial verse rows do not make KJV "installed": the receipt is the source of truth
        expect(await m.db.verses.where('translationId').equals('KJV').count()).toBe(1);
        expect(await m.getInstalledTranslationIds()).not.toContain('KJV');
        // The catalog count was zeroed with the clear, so nothing advertises verses that are not there
        expect((await m.db.translations.get('KJV'))?.verseCount).toBe(0);

        // Reinstalling writes the record with the final count
        await m.installTranslationDataset(e, kjv, [
            { id: 'KJV.Gen.1.1', translationId: 'KJV', book: 'Gen', chapter: 1, verse: 1, osisId: 'Gen.1.1', text: 'again' },
            { id: 'KJV.Gen.1.2', translationId: 'KJV', book: 'Gen', chapter: 1, verse: 2, osisId: 'Gen.1.2', text: 'again' },
        ]);
        expect(await m.getDatasetState(e)).toBe('current');
        expect((await m.db.translations.get('KJV'))?.verseCount).toBe(2);
    });

    it('removing a translation drops its identity row and nothing else', async () => {
        await m.removeTranslationData('WEB');
        expect(await m.getInstalledDataset('translation:web')).toBeUndefined();
        expect(await m.getInstalledDataset('translation:kjv')).toBeDefined();
        // KJV holds the two verses the reinstall above wrote
        expect(await m.db.verses.where('translationId').equals('KJV').count()).toBe(2);
        expect(await m.getKv('wantedTranslations')).toEqual(['KJV', 'WEB']);
    });

    it('forgetDataset drops only the identity row', async () => {
        await m.forgetDataset('cross-references');
        expect(await m.getInstalledDataset('cross-references')).toBeUndefined();
        expect(await m.db.crossReferences.count()).toBe(1);
    });
});
