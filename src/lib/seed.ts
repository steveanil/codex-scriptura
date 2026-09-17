import { db, getInstalledTranslationIds, removeTranslationData, getKv, setKv, getSettings, getDatasetState, installDatasetStream, wholeTablePlan, translationInstallPlan, type StreamInstallPlan, type DatasetTable } from '@codex-scriptura/db';
import type { VerseRecord, Translation, Person, Place, BibleEvent, DictionaryEntry, CrossReference, Relationship, LexiconEntry, Topic, RawVerse, DatasetManifestEntry } from '@codex-scriptura/core';
import { seedStatus } from './stores/seedStatus.svelte';
import { datasetStatus } from './stores/datasetStatus.svelte';
import { getDataManifest, findDataset, translationCatalog, type TranslationCatalogEntry } from './data-manifest';
import { manifestSource, mapParts } from './dataset-stream';

/**
 * Boot seeding (issues #168, #244, #310).
 *
 * Two phases. `seedCritical` installs what the reader needs to open: the
 * translation catalog and the active (or default) translation. The layout
 * awaits only that. `seedEnhancements` then continues in the background
 * with the other wanted translations, cross-references, genealogy, the
 * lexicon, the topical index and the Theographic entities; features that
 * need one of those watch `datasetStatus` and light up when it lands.
 *
 * Every dataset streams part by part through `installDatasetStream`, so
 * the whole of a 37 MB file is never in memory twice, and a failure leaves
 * the dataset `missing` for the next boot rather than half-trusted.
 */

// ─── Dataset catalogue ─────────────────────────────────────
// Human labels for the boot screen and the record keys a part's first
// record must carry (a malformed deploy must not seed durable garbage).

type DatasetMeta = { label: string; shape: readonly string[] };

const SHARED_DATASETS: Record<string, DatasetMeta> = {
    'cross-references': { label: 'Cross-references', shape: ['id', 'sourceVerse', 'targetVerse'] },
    genealogy: { label: 'Genealogy', shape: ['id', 'personFrom', 'personTo', 'type'] },
    'lexicon-hebrew': { label: "Strong's Hebrew lexicon", shape: ['id', 'strongsNumber', 'language'] },
    'lexicon-greek': { label: "Strong's Greek lexicon", shape: ['id', 'strongsNumber', 'language'] },
    'naves-topics': { label: 'Topical index', shape: ['id', 'name', 'sections'] },
    persons: { label: 'People', shape: ['id', 'name'] },
    places: { label: 'Places', shape: ['id', 'name'] },
    events: { label: 'Events', shape: ['id', 'name'] },
    dictionary: { label: 'Dictionary', shape: ['id', 'term'] },
};

/** Boot order of the shared datasets: what the reader shows first comes first. */
const SHARED_ORDER = ['cross-references', 'persons', 'places', 'events', 'dictionary', 'genealogy', 'lexicon-hebrew', 'lexicon-greek', 'naves-topics'];

const VERSE_SHAPE = ['osisId', 'book', 'chapter', 'verse', 'text'] as const;

/**
 * The manifest entry `id` needs installed, or null when the installed copy
 * already matches the deploy (or the deploy has no such dataset). Identity
 * is id + version + contentHash (issue #310): a stale copy is replaced, and
 * a legacy row from the v30 backfill is replaced exactly once.
 */
async function pendingDataset(id: string): Promise<DatasetManifestEntry | null> {
    const entry = findDataset(await getDataManifest(), id);
    if (!entry) {
        console.warn(`[seed] Dataset "${id}" is not in the deploy manifest - skipping`);
        return null;
    }
    const state = await getDatasetState(entry);
    if (state === 'current') return null;
    if (state !== 'missing') console.log(`[seed] ${id}: installed copy is ${state}, replacing with ${entry.version}`);
    return entry;
}

/** Stream a manifest entry's parts into the database, reporting progress to the status store. */
async function streamInstall<T>(
    entry: DatasetManifestEntry,
    plan: StreamInstallPlan<T>,
    parts: AsyncIterable<{ records: T[]; index: number; count: number }>,
    onProgress?: (fraction: number) => void,
): Promise<number> {
    datasetStatus.progress(entry.id, 0);
    const row = await installDatasetStream(entry, plan, parts, (fraction) => {
        datasetStatus.progress(entry.id, fraction);
        onProgress?.(fraction);
    });
    return row.recordCount;
}

// ─── Translations ──────────────────────────────────────────

function toVerseRecord(translationId: string) {
    return (v: RawVerse): VerseRecord => ({
        id: `${translationId}.${v.osisId}`,
        translationId,
        book: v.book,
        chapter: v.chapter,
        verse: v.verse,
        ...(v.verseEnd ? { verseEnd: v.verseEnd } : {}),
        osisId: v.osisId,
        text: v.text,
        ...(v.lemmas ? { lemmas: v.lemmas } : {}),
        ...(v.align ? { align: v.align } : {}),
        ...(v.wj ? { wj: v.wj } : {}),
    });
}

function catalogRecord(m: TranslationCatalogEntry, verseCount: number): Translation {
    return {
        id: m.id,
        name: m.name,
        abbreviation: m.abbreviation,
        language: m.language,
        license: m.license,
        description: m.description,
        ...(m.coverage ? { coverage: m.coverage } : {}),
        ...(m.strongs ? { strongs: true } : {}),
        ...(m.aligned ? { aligned: true } : {}),
        verseCount,
    };
}

/**
 * Seed a translation from the deploy's data files, part by part.
 *
 * Throws when the data is missing or invalid - scripture text is core
 * data, and a missing verses file is a broken deployment, not a degraded
 * feature. The boot path catches into seedStatus; the on-demand path
 * (installTranslation) lets the Translation Manager surface it.
 */
async function seedTranslation(manifest: TranslationCatalogEntry, onProgress?: (fraction: number) => void): Promise<void> {
    const entry = await pendingDataset(manifest.datasetId);
    if (!entry) return;

    console.log(`[seed] Loading ${manifest.id}...`);
    seedStatus.step(`Loading ${manifest.name}…`);
    const parts = mapParts(manifestSource<RawVerse>(entry, { shape: VERSE_SHAPE }), toVerseRecord(manifest.id));
    const count = await streamInstall(entry, translationInstallPlan(catalogRecord(manifest, 0)), parts, onProgress);
    console.log(`[seed] ${manifest.id}: ${count} verses loaded.`);
}

// ─── Shared datasets ───────────────────────────────────────

async function seedWholeTable<T extends { id: string }>(id: string, table: DatasetTable<T>): Promise<void> {
    const entry = await pendingDataset(id);
    if (!entry) return;
    const meta = SHARED_DATASETS[id];
    console.log(`[seed] Loading ${meta.label}...`);
    seedStatus.step(`Loading ${meta.label.toLowerCase()}…`);
    const count = await streamInstall(entry, wholeTablePlan(table), manifestSource<T>(entry, { shape: meta.shape }));
    // An empty array is a valid pipeline result (a missing optional source); it still records identity, or every boot would fetch it again
    console.log(`[seed] ${meta.label}: ${count} records loaded.`);
}

export const seedCrossReferences = () => seedWholeTable<CrossReference>('cross-references', db.crossReferences);
export const seedRelationships = () => seedWholeTable<Relationship>('genealogy', db.relationships);
export const seedTopics = () => seedWholeTable<Topic>('naves-topics', db.topics);

/** Theographic entities: four datasets, each with its own identity; only stale or missing ones are fetched. */
export async function seedTheographic(): Promise<void> {
    await seedWholeTable<Person>('persons', db.persons);
    await seedWholeTable<Place>('places', db.places);
    await seedWholeTable<BibleEvent>('events', db.events);
    await seedWholeTable<DictionaryEntry>('dictionary', db.dictionary);
}

/** Two datasets share the lexicon table, told apart by `language`, so a replacement clears only its own rows. */
export async function seedLexicon(): Promise<void> {
    for (const lang of ['hebrew', 'greek'] as const) {
        const id = `lexicon-${lang}`;
        const entry = await pendingDataset(id);
        if (!entry) continue;
        console.log(`[seed] Loading ${SHARED_DATASETS[id].label}...`);
        seedStatus.step('Loading Strong’s lexicon…');
        const plan: StreamInstallPlan<LexiconEntry> = {
            tables: [db.lexicon],
            clear: () => db.lexicon.where('language').equals(lang).delete(),
            insertPart: async (records) => { await db.lexicon.bulkPut(records); return records.length; },
        };
        const count = await streamInstall(entry, plan, manifestSource<LexiconEntry>(entry, { shape: SHARED_DATASETS[id].shape }));
        console.log(`[seed] Lexicon (${id}): ${count} entries loaded.`);
    }
}

// ─── Translation catalog and wanted set (issues #238, #311) ─

async function loadTranslationCatalog(): Promise<TranslationCatalogEntry[]> {
    return translationCatalog(await getDataManifest());
}

/**
 * Upsert catalog metadata for EVERY translation, installed or not: pickers
 * and the Translation Manager list the full catalog, and not-yet-downloaded
 * entries need a record to list. Also refreshes fields added in later app
 * versions on already-seeded profiles. verseCount is preserved for
 * installed translations and 0 marks catalog-only entries.
 */
async function upsertCatalog(catalog: TranslationCatalogEntry[]): Promise<void> {
    for (const m of catalog) {
        try {
            const existing = await db.translations.get(m.id);
            await db.translations.put(catalogRecord(m, existing?.verseCount ?? 0));
        } catch {
            // metadata refresh is best-effort
        }
    }
}

// Which translations this profile wants installed, persisted in the kv
// table. Fresh profiles start with just the default so first boot doesn't
// download ~95MB of translations the user may never read; profiles that
// seeded before this feature keep everything they already have.
const WANTED_KV = 'wantedTranslations';
const DEFAULT_WANTED = ['KJV'];

async function resolveWantedTranslations(catalog: TranslationCatalogEntry[]): Promise<string[]> {
    const known = new Set(catalog.map((m) => m.id));
    const stored = await getKv<string[]>(WANTED_KV);
    if (Array.isArray(stored)) {
        // Drop ids that no longer exist in the catalog; never drop to zero.
        const valid = stored.filter((id) => known.has(id));
        return valid.length > 0 ? valid : [...DEFAULT_WANTED];
    }

    // No stored set: an existing profile keeps what it already seeded
    // (grandfathering - nobody loses data or re-downloads); a fresh
    // profile gets the default starter set.
    const installed = (await getInstalledTranslationIds()).filter((id) => known.has(id));
    const wanted = installed.length > 0 ? installed : [...DEFAULT_WANTED];
    await setKv(WANTED_KV, wanted);
    return wanted;
}

async function addWantedTranslation(id: string, catalog: TranslationCatalogEntry[]): Promise<void> {
    const wanted = await resolveWantedTranslations(catalog);
    if (!wanted.includes(id)) await setKv(WANTED_KV, [...wanted, id]);
}

async function removeWantedTranslation(id: string): Promise<void> {
    const wanted = await resolveWantedTranslations(await loadTranslationCatalog());
    await setKv(WANTED_KV, wanted.filter((w) => w !== id));
}

/**
 * Download and seed one translation on demand (Settings Translation
 * Manager). Adds it to the wanted set so future boots keep it.
 * Throws on missing data files - the caller surfaces the error.
 */
export async function installTranslation(id: string, onProgress?: (fraction: number) => void): Promise<void> {
    const catalog = await loadTranslationCatalog();
    const manifest = catalog.find((m) => m.id === id);
    if (!manifest) throw new Error(`Unknown translation '${id}'`);
    await seedTranslation(manifest, onProgress);
    await addWantedTranslation(id, catalog);
}

/**
 * Remove an installed translation's verses, cached search indexes and
 * identity row, and take it off the wanted set. UX guards (last installed,
 * in use by a pane) belong to the caller.
 */
export async function removeTranslation(id: string): Promise<void> {
    await removeTranslationData(id);
    await removeWantedTranslation(id);
}

// ─── Boot orchestration ────────────────────────────────────

/**
 * The translation the reader opens with: the active one when this profile
 * wants it, else the default, else whatever comes first in the wanted set.
 */
export function pickCriticalTranslation(wanted: string[], active: string | undefined): string {
    if (active && wanted.includes(active)) return active;
    const fallback = DEFAULT_WANTED.find((id) => wanted.includes(id));
    return fallback ?? wanted[0];
}

type BootPlan = {
    catalog: TranslationCatalogEntry[];
    critical: TranslationCatalogEntry | undefined;
    otherTranslations: TranslationCatalogEntry[];
};

let bootPlan: BootPlan | null = null;

async function run(label: string, id: string, task: () => Promise<void>): Promise<void> {
    try {
        await task();
    } catch (err) {
        console.error(`[seed] ${label} failed:`, err);
        seedStatus.fail(label, err);
        datasetStatus.fail(id, err instanceof Error ? err.message : String(err));
    }
}

/**
 * Phase one: what the reader needs to open. Blocks boot; everything else
 * is `seedEnhancements`. Failures are reported, never thrown, so a broken
 * enhancement never hides a working reader.
 */
export async function seedCritical(): Promise<void> {
    datasetStatus.watch();
    datasetStatus.setPhase('critical');

    // A deploy without a manifest cannot seed anything. Report it once here
    // so a fresh profile sees why nothing loads; already-seeded datasets
    // still no-op on their own gates.
    const manifest = await getDataManifest();
    if (!manifest) {
        seedStatus.fail('Data manifest', new Error('/data/manifest.json missing or invalid - run the data pipeline'));
    }
    const catalog = translationCatalog(manifest);
    const wanted = await resolveWantedTranslations(catalog);
    await upsertCatalog(catalog);

    const active = (await getSettings().catch(() => undefined))?.activeTranslation;
    const criticalId = pickCriticalTranslation(wanted, active);
    const critical = catalog.find((m) => m.id === criticalId);
    const otherTranslations = catalog.filter((m) => wanted.includes(m.id) && m.id !== criticalId);
    bootPlan = { catalog, critical, otherTranslations };

    // Tell the boot screen everything this boot will install, in order
    const size = (id: string) => findDataset(manifest, id)?.bytes;
    datasetStatus.plan([
        ...(critical ? [{ id: critical.datasetId, label: critical.name, bytes: size(critical.datasetId) }] : []),
        ...otherTranslations.map((m) => ({ id: m.datasetId, label: m.name, bytes: size(m.datasetId) })),
        ...SHARED_ORDER.map((id) => ({ id, label: SHARED_DATASETS[id].label, bytes: size(id) })),
    ]);

    if (critical) {
        await run(critical.name, critical.datasetId, () => seedTranslation(critical));
    }
    datasetStatus.setPhase('enhancing');
}

/**
 * Phase two, after the reader is live: the remaining wanted translations
 * and every shared dataset, sequentially so the browser is never asked to
 * insert two datasets at once. Each step is isolated: one dataset failing
 * (missing file, quota, DB error) must not prevent the rest from seeding.
 */
export async function seedEnhancements(): Promise<void> {
    const plan = bootPlan ?? { catalog: [], critical: undefined, otherTranslations: [] };
    for (const m of plan.otherTranslations) {
        await run(m.name, m.datasetId, () => seedTranslation(m));
    }
    await run('Cross-references', 'cross-references', seedCrossReferences);
    await run('People, places & events', 'persons', seedTheographic);
    await run('Genealogy', 'genealogy', seedRelationships);
    await run("Strong's lexicon", 'lexicon-hebrew', seedLexicon);
    await run('Topical index', 'naves-topics', seedTopics);
    datasetStatus.setPhase('done');
    seedStatus.step(null);
}
