import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { DatasetManifest, DatasetManifestEntry } from '@codex-scriptura/core';
import { db, getInstalledDataset, listInstalledDatasets, getInstalledTranslationIds } from '@codex-scriptura/db';
import { resetDataManifest } from './data-manifest';
import { datasetStatus } from './stores/datasetStatus.svelte';
import { seedStatus } from './stores/seedStatus.svelte';
import { seedCritical, seedEnhancements, pickCriticalTranslation, installTranslation, removeTranslation, CriticalSeedError } from './seed';

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
        // Same order the pipeline emits (entries sorted by id), which is the order the background loop follows
        entry('translation:asv', ['asv-verses.json'], 1, { translation: translationMeta('ASV', 'American Standard Version') }),
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
    'asv-verses.json': [verse('ASV', 1)],
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
        seedStatus.failures.length = 0;
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
