import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { DatasetManifest, DatasetManifestEntry, ResourceDescriptor } from '@codex-scriptura/core';
import { db, getInstalledDataset, listInstalledDatasets, getInstalledTranslationIds, searchTopics, strongsSearch } from '@codex-scriptura/db';
import { getBookCrossReferenceMatrix } from './engines/graph';
import { resetDataManifest } from './data-manifest';
import { datasetStatus } from './stores/datasetStatus.svelte';
import { seedStatus } from './stores/seedStatus.svelte';
import { seedCritical, seedEnhancements, pickCriticalTranslation, installTranslation, removeTranslation, retryDataset, CriticalSeedError } from './seed';

// A miniature deploy: two translations, cross-references in two parts,
// an empty genealogy, and the rest as single files.
// Identities must be lowercase hex (the manifest guard enforces the sha256 shape)
let serial = 0;
const hash = (seed: string) => seed.padEnd(64, '0');
/** Which resource each dataset belongs to (issue #51); a translation and its postings share one. */
const RESOURCE_OF: Record<string, string> = {
    'translation:kjv': 'kjv', 'translation:asv': 'asv', 'translation:web': 'web', 'translation:dby': 'dby', 'strongs-index:dby': 'dby',
    'cross-references': 'cross-references', 'book-matrix': 'cross-references', 'verse-degrees': 'cross-references',
    persons: 'theographic', places: 'theographic', events: 'theographic', dictionary: 'eastons', genealogy: 'genealogy',
    'lexicon-hebrew': 'strongs-hebrew', 'lexicon-greek': 'strongs-greek', 'naves-topics': 'naves',
};
const entry = (id: string, files: string[], recordCount: number, extra: Partial<DatasetManifestEntry> = {}): DatasetManifestEntry => {
    const seed = (++serial).toString(16).padStart(4, '0') + 'a';
    return { id, version: seed.padEnd(12, '0'), contentHash: hash(seed), recordCount, bytes: 100 * files.length, files, resourceId: RESOURCE_OF[id], ...extra };
};
const resource = (id: string, type: ResourceDescriptor['type'] = 'translation'): ResourceDescriptor => ({
    id, type, title: id, version: `${id}-r1`,
    license: { spdx: 'public-domain', name: 'Public domain' },
    provenance: [{ sourceId: `${id}-source`, name: id, url: `https://example.org/${id}`, license: 'public-domain' }],
});

const verse = (t: string, n: number) => ({ translation: t, book: 'Gen', chapter: 1, verse: n, osisId: `Gen.1.${n}`, text: `${t} verse ${n}` });
const translationMeta = (id: string, name: string) => ({ id, name, abbreviation: id, language: 'en', license: 'PD', description: '' });

const manifest: DatasetManifest = {
    format: 2,
    resources: [
        resource('kjv'), resource('asv'), resource('web'), resource('dby'),
        resource('cross-references', 'cross-references'), resource('theographic', 'entities'), resource('eastons', 'dictionary'),
        resource('genealogy', 'genealogy'), resource('strongs-hebrew', 'lexicon'), resource('strongs-greek', 'lexicon'), resource('naves', 'topical-index'),
    ],
    datasets: [
        entry('translation:kjv', ['kjv-verses.json'], 2, { translation: translationMeta('KJV', 'King James Version') }),
        // Same order the pipeline emits (entries sorted by id), which is the order the background loop follows
        entry('translation:asv', ['asv-verses.json'], 1, { translation: translationMeta('ASV', 'American Standard Version') }),
        entry('translation:web', ['web-verses.json'], 1, { translation: translationMeta('WEB', 'World English Bible') }),
        entry('cross-references', ['cross-references-part1.json', 'cross-references-part2.json'], 3),
        entry('book-matrix', ['book-matrix.json'], 3),
        entry('verse-degrees', ['verse-degrees.json'], 4),
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
    'asv-verses.json': [verse('ASV', 1)],
    'cross-references-part1.json': [
        { id: 'Ps.136.5→Gen.1.1', sourceVerse: 'Ps.136.5', targetVerse: 'Gen.1.1', type: 'theme', votes: 1 },
        { id: 'Jer.10.12→Gen.1.1', sourceVerse: 'Jer.10.12', targetVerse: 'Gen.1.1', type: 'theme', votes: 1 },
    ],
    'cross-references-part2.json': [{ id: 'John.1.3→Gen.1.1', sourceVerse: 'John.1.3', targetVerse: 'Gen.1.1', type: 'quotation', votes: 9 }],
    'book-matrix.json': [{ from: 'Ps', to: 'Gen', count: 1 }, { from: 'Jer', to: 'Gen', count: 1 }, { from: 'John', to: 'Gen', count: 1 }],
    'verse-degrees.json': [{ osisId: 'Gen.1.1', degree: 3 }, { osisId: 'Ps.136.5', degree: 1 }, { osisId: 'Jer.10.12', degree: 1 }, { osisId: 'John.1.3', degree: 1 }],
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
/** Files whose response waits on a promise, to stage races between operations. */
const gates: Record<string, Promise<void> | undefined> = {};
const fakeFetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const name = url.slice(url.lastIndexOf('/') + 1);
    requested.push(name);
    if (gates[name]) await gates[name];
    if (!(name in files)) return new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });
    return new Response(JSON.stringify(files[name]), { status: 200 });
});

/** Swap in a broken deploy for the duration of `fn`. */
async function withFiles(mutate: (f: Record<string, unknown>) => void, fn: () => Promise<void>) {
    const backup = { ...files };
    mutate(files);
    resetDataManifest();
    try {
        await fn();
    } finally {
        for (const k of Object.keys(files)) delete files[k];
        Object.assign(files, backup);
        resetDataManifest();
    }
}

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

describe('critical phase refuses to open an empty reader', () => {
    it('a fresh profile with no manifest and no installed translation cannot boot', async () => {
        await withFiles((f) => { delete f['manifest.json']; }, async () => {
            await expect(seedCritical()).rejects.toBeInstanceOf(CriticalSeedError);
        });
        expect(datasetStatus.criticalDone).toBe(false);
    });

    it('a fresh profile whose boot translation fails part-way cannot boot, and holds no receipt', async () => {
        await withFiles((f) => { delete f['kjv-verses.json']; }, async () => {
            await expect(seedCritical()).rejects.toThrow(/King James Version could not be installed/);
        });
        expect(datasetStatus.phase).toBe('critical');
        expect(datasetStatus.state('translation:kjv')).toBe('failed');
        expect(await getInstalledDataset('translation:kjv')).toBeUndefined();
        expect(seedStatus.failures.map((f) => f.dataset)).toEqual(['King James Version']);
        // seedEnhancements has nothing to do without a plan
        await seedEnhancements();
        expect(await db.crossReferences.count()).toBe(0);
        seedStatus.failures.length = 0;
    });
});

describe('boot phases (issues #168, #244)', () => {
    it('seedCritical installs only the boot translation and declares the whole plan', async () => {
        requested.length = 0;
        await seedCritical();

        expect(datasetStatus.phase).toBe('enhancing');
        expect(datasetStatus.criticalDone).toBe(true);
        expect(datasetStatus.queue.map((q) => q.id)).toEqual([
            'translation:kjv', 'cross-references', 'book-matrix', 'verse-degrees', 'persons', 'places', 'events', 'dictionary', 'genealogy', 'lexicon-hebrew', 'lexicon-greek', 'naves-topics',
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

        // Every catalogued resource has its descriptor, and the receipt names its resource (issue #51)
        expect((await db.resources.toArray()).map((r) => r.id).sort()).toEqual(manifest.resources.map((r) => r.id).sort());
        expect((await getInstalledDataset('translation:kjv'))?.resourceId).toBe('kjv');
        expect((await db.translations.get('KJV'))?.resourceId).toBe('kjv');
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
            ['book-matrix', 'cross-references', 'dictionary', 'events', 'genealogy', 'lexicon-greek', 'lexicon-hebrew', 'naves-topics', 'persons', 'places', 'translation:kjv', 'verse-degrees'],
        );
        // The matrix is read from the aggregate, not scanned from cross-references
        expect([...(await getBookCrossReferenceMatrix()).keys()].sort()).toEqual(['Jer', 'John', 'Ps']);
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
        // Cross-references moved to a new version whose second part the deploy forgot
        const bump = (d: DatasetManifestEntry, seed: string) => ({ ...d, version: seed.padEnd(12, '0'), contentHash: hash(seed) });
        await withFiles((f) => {
            f['manifest.json'] = { ...manifest, datasets: manifest.datasets.map((d) => (d.id === 'cross-references' ? bump(d, 'feed') : d)) };
            delete f['cross-references-part2.json'];
        }, async () => {
            await seedCritical();
            await seedEnhancements();
        });

        expect(seedStatus.failures.map((f) => f.dataset)).toEqual(['Cross-references']);
        expect(datasetStatus.failed['cross-references']).toMatch(/cross-references-part2\.json/);
        expect(datasetStatus.state('cross-references')).toBe('failed');
        expect(await getInstalledDataset('cross-references')).toBeUndefined();
        // Everything else stayed current and untouched
        expect(await db.persons.count()).toBe(1);
        expect(datasetStatus.state('persons')).toBe('installed');
        seedStatus.failures.length = 0;
    });

    it('each shared dataset is its own failure boundary: places failing does not stop events, and is not blamed on persons', async () => {
        const bump = (d: DatasetManifestEntry, seed: string) => ({ ...d, version: seed.padEnd(12, '0'), contentHash: hash(seed) });
        await withFiles((f) => {
            // Cross-references is whole again; places and events both moved to new versions, places' file is gone
            f['manifest.json'] = { ...manifest, datasets: manifest.datasets.map((d) => (d.id === 'places' ? bump(d, 'ace1') : d.id === 'events' ? bump(d, 'ace2') : d)) };
            delete f['places.json'];
        }, async () => {
            await seedCritical();
            await seedEnhancements();
        });

        expect(Object.keys(datasetStatus.failed)).toEqual(['places']);
        expect(seedStatus.failures.map((f) => f.dataset)).toEqual(['Places']);
        expect(datasetStatus.state('persons')).toBe('installed');
        expect(await getInstalledDataset('places')).toBeUndefined();
        // Events, listed after places, still got its new receipt
        expect((await getInstalledDataset('events'))?.version).toBe('ace2'.padEnd(12, '0'));
        expect((await getInstalledDataset('cross-references'))?.recordCount).toBe(3);
    });

    it('retryDataset re-runs only the failed dataset and clears its failure', async () => {
        // Carried over from the test above: places failed, its file is back now
        expect(datasetStatus.state('places')).toBe('failed');
        expect(seedStatus.failures.map((f) => f.dataset)).toEqual(['Places']);
        requested.length = 0;

        await retryDataset('places');

        expect(requested.filter((f) => f !== 'manifest.json')).toEqual(['places.json']);
        expect(datasetStatus.failed).toEqual({});
        expect(seedStatus.failures).toEqual([]);
        expect(await getInstalledDataset('places')).toBeDefined();
        await vi.waitFor(() => expect(datasetStatus.state('places')).toBe('installed'));
    });

    it('a populated cache is cleared before a stale dataset is replaced, so a woken consumer never sees the old version', async () => {
        // Warm both caches on the installed versions
        expect((await searchTopics('faith')).map((t) => t.id)).toEqual(['faith']);
        expect((await getBookCrossReferenceMatrix()).size).toBeGreaterThan(0);

        // The deploy moves both datasets to new content. Topics is last in
        // the boot order and its download is held, so when the loop reaches
        // it the book matrix has already been replaced.
        const bump = (d: DatasetManifestEntry, seed: string) => ({ ...d, version: seed.padEnd(12, '0'), contentHash: hash(seed) });
        let release!: () => void;
        gates['naves-topics.json'] = new Promise<void>((r) => { release = r; });
        try {
            await withFiles((f) => {
                f['manifest.json'] = { ...manifest, datasets: manifest.datasets.map((d) => (d.id === 'naves-topics' ? bump(d, 'ca11') : d.id === 'book-matrix' ? bump(d, 'ca12') : d)) };
                f['naves-topics.json'] = [{ id: 'hope', name: 'Hope', refCount: 2, sections: [], seeAlso: [] }];
                f['book-matrix.json'] = [{ from: 'Rev', to: 'Gen', count: 1 }];
            }, async () => {
                await seedCritical();
                requested.length = 0;
                const enhancing = seedEnhancements();
                await vi.waitFor(() => expect(requested).toContain('naves-topics.json'));
                // The book matrix landed a moment ago: a consumer woken by its receipt gets v2, never the cached v1
                expect([...(await getBookCrossReferenceMatrix()).keys()]).toEqual(['Rev']);
                // Topics is mid-replacement: the old copy and its cache are already gone, so nothing answers with v1
                expect(await searchTopics('faith')).toEqual([]);
                release();
                await enhancing;
            });
        } finally {
            delete gates['naves-topics.json'];
        }
        expect(seedStatus.failures.map((f) => `${f.dataset}: ${f.message}`)).toEqual([]);
        // After landing, readers get v2, not a cache of v1
        expect((await searchTopics('hope')).map((t) => t.id)).toEqual(['hope']);
        expect(await searchTopics('faith')).toEqual([]);
        expect([...(await getBookCrossReferenceMatrix()).keys()]).toEqual(['Rev']);
        // Back on the original deploy for the tests that follow
        resetDataManifest();
        await seedCritical();
        await seedEnhancements();
        expect((await searchTopics('faith')).map((t) => t.id)).toEqual(['faith']);
    });

    it('with the manifest unreachable, a profile holding a complete translation opens on it without a banner', async () => {
        await withFiles((f) => { delete f['manifest.json']; }, async () => {
            await seedCritical();
            requested.length = 0;
            await seedEnhancements();
        });
        expect(datasetStatus.phase).toBe('done');
        expect(seedStatus.failures).toEqual([]);
        expect(requested).toEqual([]);
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

    it('a removal that arrives while the same translation is installing waits for it and wins', async () => {
        const bump = (d: DatasetManifestEntry, seed: string) => ({ ...d, version: seed.padEnd(12, '0'), contentHash: hash(seed) });
        let release!: () => void;
        gates['web-verses.json'] = new Promise<void>((r) => { release = r; });
        try {
            await withFiles((f) => {
                f['manifest.json'] = { ...manifest, datasets: manifest.datasets.map((d) => (d.id === 'translation:web' ? bump(d, 'beef') : d)) };
            }, async () => {
                const order: string[] = [];
                requested.length = 0;
                const install = installTranslation('WEB').then(() => order.push('install'));
                // Let the install reach its (gated) part download, then ask for removal
                await vi.waitFor(() => expect(requested).toContain('web-verses.json'));
                const remove = removeTranslation('WEB').then(() => order.push('remove'));
                await new Promise((r) => setTimeout(r, 20));
                expect(order).toEqual([]);
                release();
                await Promise.all([install, remove]);
                expect(order).toEqual(['install', 'remove']);
            });
        } finally {
            delete gates['web-verses.json'];
        }
        // Removal won: no verses, no receipt, not wanted, and it cannot resurrect
        expect(await db.verses.where('translationId').equals('WEB').count()).toBe(0);
        expect(await getInstalledDataset('translation:web')).toBeUndefined();
        expect((await db.kv.get('wantedTranslations'))?.value).toEqual(['KJV']);
        expect(await getInstalledTranslationIds()).toEqual(['KJV']);
    });

    it('a removal that finishes before the background loop reaches that translation is not undone by the stale boot plan', async () => {
        // A profile that wants three translations, all installed
        resetDataManifest();
        await installTranslation('ASV');
        await installTranslation('WEB');
        expect((await db.kv.get('wantedTranslations'))?.value).toEqual(['KJV', 'ASV', 'WEB']);

        // The deploy moved ASV and WEB to new versions, so this boot refreshes both; ASV's download is held
        const bump = (d: DatasetManifestEntry, seed: string) => ({ ...d, version: seed.padEnd(12, '0'), contentHash: hash(seed) });
        let release!: () => void;
        gates['asv-verses.json'] = new Promise<void>((r) => { release = r; });
        let requestedAfterRemoval: string[] = [];
        try {
            await withFiles((f) => {
                f['manifest.json'] = {
                    ...manifest,
                    datasets: manifest.datasets.map((d) => (d.id === 'translation:asv' ? bump(d, 'a5a5') : d.id === 'translation:web' ? bump(d, 'b0b0') : d)),
                };
            }, async () => {
                await seedCritical();
                expect(datasetStatus.queue.map((q) => q.id).slice(0, 3)).toEqual(['translation:kjv', 'translation:asv', 'translation:web']);

                requested.length = 0;
                const enhancing = seedEnhancements();
                // The loop is stuck on ASV, so it cannot have reached WEB yet
                await vi.waitFor(() => expect(requested).toContain('asv-verses.json'));
                expect(requested).not.toContain('web-verses.json');

                // WEB's lock is free: the removal runs to completion now
                await removeTranslation('WEB');
                expect((await db.kv.get('wantedTranslations'))?.value).toEqual(['KJV', 'ASV']);

                const mark = requested.length;
                release();
                await enhancing;
                requestedAfterRemoval = requested.slice(mark);
            });
        } finally {
            delete gates['asv-verses.json'];
        }

        // The stale plan entry for WEB was skipped, not reinstalled
        expect(requestedAfterRemoval).not.toContain('web-verses.json');
        expect(await db.verses.where('translationId').equals('WEB').count()).toBe(0);
        expect(await getInstalledDataset('translation:web')).toBeUndefined();
        expect((await db.kv.get('wantedTranslations'))?.value).toEqual(['KJV', 'ASV']);
        expect(await getInstalledTranslationIds()).toEqual(['ASV', 'KJV']);
        expect(datasetStatus.queue.map((q) => q.id)).not.toContain('translation:web');
        // ASV, still wanted, did get its refresh
        expect((await getInstalledDataset('translation:asv'))?.version).toBe('a5a5'.padEnd(12, '0'));
        expect(seedStatus.failures).toEqual([]);
        expect(datasetStatus.phase).toBe('done');
    });
});

describe("Strong's postings install beside their translation (issue #166)", () => {
    const tagged = (n: number, text: string, lemmas: string) => ({ ...verse('DBY', n), text, lemmas });
    const dbyV1 = entry('translation:dby', ['dby-verses.json'], 1, { translation: { ...translationMeta('DBY', 'Darby Translation'), strongs: true } });
    const dbyV2 = { ...dbyV1, version: 'd2d2'.padEnd(12, '0'), contentHash: hash('d2d2') };
    const indexFor = (parent: DatasetManifestEntry, seed: string) =>
        entry('strongs-index:dby', ['strongs-index-dby.json'], 1, { version: seed.padEnd(12, '0'), contentHash: hash(seed), derivedFrom: { id: parent.id, contentHash: parent.contentHash } });

    const deploy = (f: Record<string, unknown>, parent: DatasetManifestEntry, index: DatasetManifestEntry, verses: unknown[], postings: unknown[]) => {
        f['manifest.json'] = { ...manifest, datasets: [...manifest.datasets, parent, index] };
        f['dby-verses.json'] = verses;
        f['strongs-index-dby.json'] = postings;
    };
    const v1 = (f: Record<string, unknown>) => deploy(f, dbyV1, indexFor(dbyV1, '1d01'), [tagged(1, 'In the beginning', 'H7225')], [{ strongsId: 'H7225', osisIds: ['Gen.1.1'] }]);
    const v2 = (f: Record<string, unknown>) => deploy(f, dbyV2, indexFor(dbyV2, '1d02'), [tagged(1, 'In the beginning', 'H7225'), tagged(2, 'God created', 'H1254')], [{ strongsId: 'H1254', osisIds: ['Gen.1.2'] }]);

    it('a catalog-only tagged translation gets no postings at boot', async () => {
        await withFiles(v1, async () => {
            requested.length = 0;
            await seedCritical();
            await seedEnhancements();
            expect(requested).not.toContain('strongs-index-dby.json');
            expect(datasetStatus.queue.map((q) => q.id)).not.toContain('strongs-index:dby');
        });
        expect(await getInstalledDataset('strongs-index:dby')).toBeUndefined();
    });

    it('installing the translation installs its postings after the verses', async () => {
        await withFiles(v1, async () => {
            requested.length = 0;
            await installTranslation('DBY');
            expect(requested.filter((f) => f !== 'manifest.json')).toEqual(['dby-verses.json', 'strongs-index-dby.json']);
        });
        expect((await getInstalledDataset('strongs-index:dby'))?.recordCount).toBe(1);
        expect((await strongsSearch('DBY', 'H7225')).map((r) => r.verse.osisId)).toEqual(['Gen.1.1']);
    });

    it('a refreshed translation is never searched through the postings of the copy it replaced', async () => {
        let releaseVerses!: () => void;
        let releaseIndex!: () => void;
        gates['dby-verses.json'] = new Promise<void>((r) => { releaseVerses = r; });
        gates['strongs-index-dby.json'] = new Promise<void>((r) => { releaseIndex = r; });
        try {
            await withFiles(v2, async () => {
                await seedCritical();
                requested.length = 0;
                const enhancing = seedEnhancements();
                // The replacement's first transaction has run: v1 verses and v1 postings left together
                await vi.waitFor(() => expect(requested).toContain('dby-verses.json'));
                expect(requested).not.toContain('strongs-index-dby.json');
                expect(await getInstalledDataset('strongs-index:dby')).toBeUndefined();
                expect(await db.strongsPostings.where('translationId').equals('DBY').count()).toBe(0);
                releaseVerses();
                // v2 verses and receipt are in, the v2 postings are still downloading
                await vi.waitFor(() => expect(requested).toContain('strongs-index-dby.json'));
                expect((await getInstalledDataset('translation:dby'))?.version).toBe(dbyV2.version);
                expect(await db.verses.where('translationId').equals('DBY').count()).toBe(2);
                expect(await strongsSearch('DBY', 'H7225')).toEqual([]);
                releaseIndex();
                await enhancing;
            });
        } finally {
            delete gates['dby-verses.json'];
            delete gates['strongs-index-dby.json'];
        }
        expect(seedStatus.failures).toEqual([]);
        expect((await strongsSearch('DBY', 'H1254')).map((r) => r.verse.osisId)).toEqual(['Gen.1.2']);
        expect(await strongsSearch('DBY', 'H7225')).toEqual([]);
    });

    it('postings built from another copy of the text are refused', async () => {
        await db.transaction('rw', [db.strongsPostings, db.datasets], async () => {
            await db.strongsPostings.where('translationId').equals('DBY').delete();
            await db.datasets.delete('strongs-index:dby');
        });
        // The deploy's postings claim a parent hash the installed DBY does not have
        await withFiles((f) => deploy(f, dbyV2, indexFor(dbyV1, '1d03'), [], [{ strongsId: 'H7225', osisIds: ['Gen.1.1'] }]), async () => {
            await seedCritical();
            requested.length = 0;
            await seedEnhancements();
            expect(requested).not.toContain('strongs-index-dby.json');
        });
        expect(await getInstalledDataset('strongs-index:dby')).toBeUndefined();
        expect(seedStatus.failures).toEqual([]);
    });

    it('a failed postings download is its own failure, leaves the translation installed, and can be retried', async () => {
        await withFiles((f) => { v2(f); delete f['strongs-index-dby.json']; }, async () => {
            await seedCritical();
            await seedEnhancements();
        });
        expect(seedStatus.failures.map((f) => f.dataset)).toEqual(['DBY Strong’s index']);
        expect(datasetStatus.state('strongs-index:dby')).toBe('failed');
        expect(await getInstalledTranslationIds()).toContain('DBY');

        await withFiles(v2, async () => {
            await retryDataset('strongs-index:dby');
        });
        expect(seedStatus.failures).toEqual([]);
        expect((await strongsSearch('DBY', 'H1254')).map((r) => r.verse.osisId)).toEqual(['Gen.1.2']);
    });

    it('removing the translation removes its postings and their receipt', async () => {
        await withFiles(v2, async () => {
            await removeTranslation('DBY');
        });
        expect(await db.strongsPostings.where('translationId').equals('DBY').count()).toBe(0);
        expect(await getInstalledDataset('strongs-index:dby')).toBeUndefined();
        expect(await getInstalledDataset('translation:dby')).toBeUndefined();
    });
});
