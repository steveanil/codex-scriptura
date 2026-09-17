import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { DatasetManifest, DatasetManifestEntry } from '@codex-scriptura/core';
import { db, getInstalledDataset, listInstalledDatasets } from '@codex-scriptura/db';
import { resetDataManifest } from './data-manifest';
import { datasetStatus } from './stores/datasetStatus.svelte';
import { seedStatus } from './stores/seedStatus.svelte';
import { seedCritical, seedEnhancements, pickCriticalTranslation, installTranslation } from './seed';

// A miniature deploy: two translations, cross-references in two parts,
// an empty genealogy, and the rest as single files.
// Identities must be lowercase hex (the manifest guard enforces the sha256 shape)
let serial = 0;
const hash = (seed: string) => seed.padEnd(64, '0');
const entry = (id: string, files: string[], recordCount: number, extra: Partial<DatasetManifestEntry> = {}): DatasetManifestEntry => {
    const seed = (++serial).toString(16).padStart(4, '0') + 'a';
    return { id, version: seed.padEnd(12, '0'), contentHash: hash(seed), recordCount, bytes: 100 * files.length, files, ...extra };
};

const verse = (t: string, n: number) => ({ translation: t, book: 'Gen', chapter: 1, verse: n, osisId: `Gen.1.${n}`, text: `${t} verse ${n}` });
const translationMeta = (id: string, name: string) => ({ id, name, abbreviation: id, language: 'en', license: 'PD', description: '' });

const manifest: DatasetManifest = {
    format: 1,
    datasets: [
        entry('translation:kjv', ['kjv-verses.json'], 2, { translation: translationMeta('KJV', 'King James Version') }),
        entry('translation:web', ['web-verses.json'], 1, { translation: translationMeta('WEB', 'World English Bible') }),
        entry('cross-references', ['cross-references-part1.json', 'cross-references-part2.json'], 3),
        entry('persons', ['persons.json'], 1),
        entry('places', ['places.json'], 1),
        entry('events', ['events.json'], 1),
        entry('dictionary', ['dictionary.json'], 1),
        entry('genealogy', ['genealogy.json'], 0),
        entry('lexicon-hebrew', ['lexicon-hebrew.json'], 1),
        entry('lexicon-greek', ['lexicon-greek.json'], 1),
        entry('naves-topics', ['naves-topics.json'], 1),
    ],
};

const files: Record<string, unknown> = {
    'manifest.json': manifest,
    'kjv-verses.json': [verse('KJV', 1), verse('KJV', 2)],
    'web-verses.json': [verse('WEB', 1)],
    'cross-references-part1.json': [
        { id: 'Ps.136.5→Gen.1.1', sourceVerse: 'Ps.136.5', targetVerse: 'Gen.1.1', type: 'theme', votes: 1 },
        { id: 'Jer.10.12→Gen.1.1', sourceVerse: 'Jer.10.12', targetVerse: 'Gen.1.1', type: 'theme', votes: 1 },
    ],
    'cross-references-part2.json': [{ id: 'John.1.3→Gen.1.1', sourceVerse: 'John.1.3', targetVerse: 'Gen.1.1', type: 'quotation', votes: 9 }],
    'persons.json': [{ id: 'adam_1', name: 'Adam', verseRefs: ['Gen.1.26'] }],
    'places.json': [{ id: 'eden_1', name: 'Eden', verseRefs: ['Gen.2.8'] }],
    'events.json': [{ id: '1', name: 'Creation', verseRefs: ['Gen.1.1'] }],
    'dictionary.json': [{ id: 'a', term: 'A', definition: 'Alpha' }],
    'genealogy.json': [],
    'lexicon-hebrew.json': [{ id: 'H1', strongsNumber: 'H1', language: 'hebrew', lemma: 'אב', transliteration: 'ab', gloss: 'father', description: '' }],
    'lexicon-greek.json': [{ id: 'G1', strongsNumber: 'G1', language: 'greek', lemma: 'Α', transliteration: 'A', gloss: 'Alpha', description: '' }],
    'naves-topics.json': [{ id: 'faith', name: 'Faith', refCount: 1, sections: [], seeAlso: [] }],
};

const requested: string[] = [];
const fakeFetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const name = url.slice(url.lastIndexOf('/') + 1);
    requested.push(name);
    if (!(name in files)) return new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });
    return new Response(JSON.stringify(files[name]), { status: 200 });
});

beforeAll(() => {
    vi.stubGlobal('fetch', fakeFetch);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
    vi.unstubAllGlobals();
});

describe('pickCriticalTranslation', () => {
    it('prefers the active translation, then the default, then the first wanted', () => {
        expect(pickCriticalTranslation(['KJV', 'WEB'], 'WEB')).toBe('WEB');
        expect(pickCriticalTranslation(['KJV', 'WEB'], 'ASV')).toBe('KJV');
        expect(pickCriticalTranslation(['WEB', 'ASV'], undefined)).toBe('WEB');
    });
});

describe('boot phases (issues #168, #244)', () => {
    it('seedCritical installs only the boot translation and declares the whole plan', async () => {
        await seedCritical();

        expect(datasetStatus.phase).toBe('enhancing');
        expect(datasetStatus.criticalDone).toBe(true);
        expect(datasetStatus.queue.map((q) => q.id)).toEqual([
            'translation:kjv', 'cross-references', 'persons', 'places', 'events', 'dictionary', 'genealogy', 'lexicon-hebrew', 'lexicon-greek', 'naves-topics',
        ]);
        expect(datasetStatus.queue[0].bytes).toBe(100);

        // The reader's data is in; nothing else has been fetched yet
        expect(await db.verses.where('translationId').equals('KJV').count()).toBe(2);
        expect((await getInstalledDataset('translation:kjv'))?.recordCount).toBe(2);
        expect(await db.crossReferences.count()).toBe(0);
        expect(requested.filter((f) => f !== 'manifest.json')).toEqual(['kjv-verses.json']);

        // The catalog lists both translations; WEB is catalog-only
        expect((await db.translations.get('KJV'))?.verseCount).toBe(2);
        expect((await db.translations.get('WEB'))?.verseCount).toBe(0);
        expect(seedStatus.failures).toEqual([]);
    });

    it('the live query flips the boot translation to installed', async () => {
        await vi.waitFor(() => expect(datasetStatus.isInstalled('translation:kjv')).toBe(true));
        expect(datasetStatus.state('translation:kjv')).toBe('installed');
        expect(datasetStatus.state('cross-references')).toBe('loading');
        expect(datasetStatus.state('translation:web')).toBe('absent');
    });

    it('seedEnhancements streams every shared dataset part by part and records identity for the empty one', async () => {
        requested.length = 0;
        await seedEnhancements();

        expect(datasetStatus.phase).toBe('done');
        expect(seedStatus.failures).toEqual([]);
        expect(await db.crossReferences.count()).toBe(3);
        expect(await db.persons.count()).toBe(1);
        expect(await db.lexicon.count()).toBe(2);
        expect(await db.topics.count()).toBe(1);
        expect((await getInstalledDataset('genealogy'))?.recordCount).toBe(0);
        expect((await listInstalledDatasets()).map((d) => d.id).sort()).toEqual(
            ['cross-references', 'dictionary', 'events', 'genealogy', 'lexicon-greek', 'lexicon-hebrew', 'naves-topics', 'persons', 'places', 'translation:kjv'],
        );
        // Both cross-reference parts were fetched, and the second before the first finished inserting
        expect(requested.slice(0, 2)).toEqual(['cross-references-part1.json', 'cross-references-part2.json']);
        await vi.waitFor(() => expect(datasetStatus.remaining).toEqual([]));
    });

    it('a second boot with the same manifest fetches nothing but the manifest', async () => {
        resetDataManifest();
        requested.length = 0;
        await seedCritical();
        await seedEnhancements();
        expect(requested).toEqual(['manifest.json']);
        expect(seedStatus.failures).toEqual([]);
    });

    it('a dataset whose later part is missing is reported, left missing, and does not stop the others', async () => {
        resetDataManifest();
        // Cross-references moved to a new version whose second part the deploy forgot
        const broken: DatasetManifest = {
            ...manifest,
            datasets: manifest.datasets.map((d) => (d.id === 'cross-references' ? { ...d, version: 'feed00000000', contentHash: hash('feed') } : d)),
        };
        const backup = { ...files };
        files['manifest.json'] = broken;
        delete files['cross-references-part2.json'];
        try {
            await seedCritical();
            await seedEnhancements();
        } finally {
            Object.assign(files, backup);
        }

        expect(seedStatus.failures.map((f) => f.dataset)).toEqual(['Cross-references']);
        expect(datasetStatus.failed['cross-references']).toMatch(/cross-references-part2\.json/);
        expect(datasetStatus.state('cross-references')).toBe('failed');
        expect(await getInstalledDataset('cross-references')).toBeUndefined();
        // Everything else stayed current and untouched
        expect(await db.persons.count()).toBe(1);
        expect(datasetStatus.state('persons')).toBe('installed');
    });

    it('installTranslation on demand streams the translation and adds it to the wanted set', async () => {
        resetDataManifest();
        const progress: number[] = [];
        await installTranslation('WEB', (f) => progress.push(f));
        expect(await db.verses.where('translationId').equals('WEB').count()).toBe(1);
        expect((await db.translations.get('WEB'))?.verseCount).toBe(1);
        expect(progress[progress.length - 1]).toBe(1);
        expect((await db.kv.get('wantedTranslations'))?.value).toEqual(['KJV', 'WEB']);
    });
});
