import { db, isTranslationSeeded, isTheographicSeeded, isCrossReferencesSeeded, isRelationshipsSeeded, isLexiconSeeded, clearCachedSearchIndexes } from '@codex-scriptura/db';
import type { VerseRecord, Translation, Person, Place, BibleEvent, DictionaryEntry, CrossReference, Relationship, LexiconEntry } from '@codex-scriptura/core';
import { seedStatus } from './stores/seedStatus.svelte';

const DATA_BASE_URL = '/data';

// Approximate record counts per dataset, in thousands. They weight the boot
// progress bar so it advances in proportion to real work - cross-references
// alone are ~340k records and would stall an equal-weight bar. Rough numbers
// are fine; the bar only has to move honestly, not precisely.
const SEED_WEIGHTS = {
    translation: 31,
    crossReferences: 340,
    relationships: 2,
    lexicon: 14,
    theographic: 6,
} as const;

/**
 * Determinate progress for the boot screen. seedAll() starts a run with the
 * full phase list (including theographic, which the layout runs right after);
 * each phase reports partial completion from its insert loop and is marked
 * finished even when skipped or failed, so the bar never sticks. Outside a
 * run (total 0, e.g. a banner-triggered retry after boot) all calls no-op.
 */
const seedProgress = (() => {
    let done = 0;
    let total = 0;
    return {
        start(phaseWeights: number[]) {
            done = 0;
            total = phaseWeights.reduce((sum, w) => sum + w, 0);
            seedStatus.setProgress(0);
        },
        /** Report partial completion (0-1) of an in-flight phase. */
        during(weight: number, fraction: number) {
            if (total > 0) seedStatus.setProgress(Math.min(1, (done + weight * fraction) / total));
        },
        /** Mark a phase finished - also for skipped and failed phases. */
        finish(weight: number) {
            if (total === 0) return;
            done += weight;
            seedStatus.setProgress(Math.min(1, done / total));
        },
    };
})();

type RawVerse = {
    translation: string;
    book: string;
    chapter: number;
    verse: number;
    /** Last verse of a bridged entry (e.g. WEB "15-16"); `verse` is the first. */
    verseEnd?: number;
    osisId: string;
    text: string;
    /** Present only in verses imported from morphologically tagged sources. */
    lemmas?: string;
    /** JSON-encoded [start, end, "H7225"] word-alignment spans (tagged sources only). */
    align?: string;
    /** JSON-encoded [start, end] offset pairs for words of Jesus (WEB only). */
    wj?: string;
};

type TranslationManifest = {
    id: string;
    name: string;
    abbreviation: string;
    language: string;
    license: string;
    description: string;
    /** Coverage note for partial translations (see Translation.coverage). */
    coverage?: string;
    /** True when the source data carries Strong's lemma tokens (see Translation.strongs). */
    strongs?: boolean;
    file: string;
};

/**
 * Fetch a JSON data asset, tolerating broken deployments.
 *
 * Returns null (with a console warning) when the file is missing, the fetch
 * fails, or the body isn't valid JSON. The parse check matters because SPA
 * hosts serve index.html with HTTP 200 for unknown paths - `res.ok` alone
 * cannot detect a missing data file there.
 */
async function fetchJsonAsset<T>(file: string): Promise<T | null> {
    try {
        const res = await fetch(`${DATA_BASE_URL}/${file}`);
        if (!res.ok) {
            console.warn(`[seed] Data file not found: ${file} (HTTP ${res.status}) - skipping`);
            return null;
        }
        const text = await res.text();
        try {
            return JSON.parse(text) as T;
        } catch {
            console.warn(`[seed] Data file ${file} is not valid JSON (SPA fallback page?) - skipping`);
            return null;
        }
    } catch (err) {
        console.warn(`[seed] Failed to fetch ${file}:`, err);
        return null;
    }
}

/**
 * Fetch a JSON array that copy-to-static may have split into numbered parts
 * (Cloudflare Pages rejects files over 25 MB). A `<base>.parts.json`
 * manifest means parts exist; otherwise fall back to `<base>.json`.
 * A missing part is a broken deployment: return null rather than seeding
 * a silently truncated dataset.
 */
async function fetchSplitJsonAsset<T>(base: string): Promise<T[] | null> {
    const manifest = await fetchJsonAsset<{ parts: number }>(`${base}.parts.json`);
    if (!manifest?.parts) {
        return fetchJsonAsset<T[]>(`${base}.json`);
    }

    let records: T[] = [];
    for (let i = 1; i <= manifest.parts; i++) {
        const part = await fetchJsonAsset<T[]>(`${base}-part${i}.json`);
        if (!part) {
            console.warn(`[seed] ${base}-part${i}.json missing (${manifest.parts} expected) - skipping dataset`);
            return null;
        }
        records = records.concat(part);
    }
    return records;
}

/**
 * Seed a translation into IndexedDB from a static JSON file.
 * The JSON files live in /static/data/ and are fetched at runtime.
 */
async function seedTranslation(manifest: TranslationManifest): Promise<void> {
    const alreadySeeded = await isTranslationSeeded(manifest.id);
    if (alreadySeeded) return;

    console.log(`[seed] Loading ${manifest.id}...`);
    seedStatus.step(`Loading ${manifest.name}…`);
    // Split-aware: word-aligned Strong's spans push ASV/DBY past the 25 MB
    // Cloudflare Pages file limit, so copy-to-static may have split them
    // into numbered parts (falls back to the plain file when it didn't).
    const rawVerses = await fetchSplitJsonAsset<RawVerse>(manifest.file.replace(/\.json$/, ''));
    if (!rawVerses) {
        // Scripture text is core data - a missing/invalid verses file is a
        // broken deployment, not a degraded feature. Surface it.
        seedStatus.fail(manifest.name, new Error(`data file ${manifest.file} missing or invalid`));
        return;
    }

    const verses: VerseRecord[] = rawVerses.map((v) => ({
        id: `${manifest.id}.${v.osisId}`,
        translationId: manifest.id,
        book: v.book,
        chapter: v.chapter,
        verse: v.verse,
        ...(v.verseEnd ? { verseEnd: v.verseEnd } : {}),
        osisId: v.osisId,
        text: v.text,
        ...(v.lemmas ? { lemmas: v.lemmas } : {}),
        ...(v.align ? { align: v.align } : {}),
        ...(v.wj ? { wj: v.wj } : {}),
    }));

    const translation: Translation = {
        id: manifest.id,
        name: manifest.name,
        abbreviation: manifest.abbreviation,
        language: manifest.language,
        license: manifest.license,
        description: manifest.description,
        ...(manifest.coverage ? { coverage: manifest.coverage } : {}),
        ...(manifest.strongs ? { strongs: true } : {}),
        verseCount: verses.length,
    };

    // Bulk insert in a transaction, chunked so the boot progress bar can
    // advance while a full Bible (~31k verses) streams into IndexedDB
    const BATCH_SIZE = 5_000;
    await db.transaction('rw', [db.verses, db.translations], async () => {
        await db.translations.put(translation);
        for (let i = 0; i < verses.length; i += BATCH_SIZE) {
            await db.verses.bulkPut(verses.slice(i, i + BATCH_SIZE));
            seedProgress.during(SEED_WEIGHTS.translation, Math.min(1, (i + BATCH_SIZE) / verses.length));
        }
    });

    console.log(`[seed] ${manifest.id}: ${verses.length} verses loaded.`);

    // Invalidate cached search indexes - verse data has changed
    await clearCachedSearchIndexes();
}

/**
 * Seed Theographic data (persons, places, events, dictionary) from pre-processed
 * JSON files in /static/data/. Runs once - no-ops if data already exists.
 *
 * Requires the data pipeline to have run first:
 *   cd packages/data-pipeline && npx tsx src/import-theographic.ts
 *   # then copy data/processed/{persons,places,events,dictionary}.json → static/data/
 */
export async function seedTheographic(): Promise<void> {
    const alreadySeeded = await isTheographicSeeded();
    if (alreadySeeded) {
        seedProgress.finish(SEED_WEIGHTS.theographic);
        return;
    }

    console.log('[seed] Loading Theographic data...');
    seedStatus.step('Loading people, places & events…');

    const [persons, places, events, dictionary] = await Promise.all([
        fetchJsonAsset<Person[]>('persons.json'),
        fetchJsonAsset<Place[]>('places.json'),
        fetchJsonAsset<BibleEvent[]>('events.json'),
        fetchJsonAsset<DictionaryEntry[]>('dictionary.json'),
    ]);

    await db.transaction(
        'rw',
        [db.persons, db.places, db.events, db.dictionary],
        async () => {
            if (persons)    await db.persons.bulkPut(persons);
            if (places)     await db.places.bulkPut(places);
            if (events)     await db.events.bulkPut(events);
            if (dictionary) await db.dictionary.bulkPut(dictionary);
        }
    );

    console.log(
        `[seed] Theographic: ${persons?.length ?? 0} persons, ` +
        `${places?.length ?? 0} places, ` +
        `${events?.length ?? 0} events, ` +
        `${dictionary?.length ?? 0} dictionary entries.`
    );
    seedProgress.finish(SEED_WEIGHTS.theographic);
}

/**
 * Seed cross-reference data from pre-processed JSON.
 * Source: OpenBible.info (~340K cross-references derived from TSK).
 *
 * Requires the data pipeline to have run first:
 *   cd packages/data-pipeline && pnpm run fetch:crossrefs && pnpm run import:crossrefs
 *   # then copy data/processed/cross-references.json → static/data/
 */
export async function seedCrossReferences(): Promise<void> {
    const alreadySeeded = await isCrossReferencesSeeded();
    if (alreadySeeded) return;

    console.log('[seed] Loading cross-reference data...');
    seedStatus.step('Loading cross-references…');

    const records = await fetchSplitJsonAsset<CrossReference>('cross-references');
    if (!records) return;

    // Bulk insert in batches to avoid overwhelming IndexedDB
    const BATCH_SIZE = 10_000;
    await db.transaction('rw', db.crossReferences, async () => {
        for (let i = 0; i < records.length; i += BATCH_SIZE) {
            const batch = records.slice(i, i + BATCH_SIZE);
            await db.crossReferences.bulkPut(batch);
            seedProgress.during(SEED_WEIGHTS.crossReferences, (i + batch.length) / records.length);
        }
    });

    console.log(`[seed] Cross-references: ${records.length} records loaded.`);
}

/**
 * Seed relationships (genealogy) from pre-processed JSON.
 * Source: BibleData / Theographic relationship maps.
 *
 * Requires the data pipeline to have run first:
 *   cd packages/data-pipeline && pnpm run import:genealogy
 *   # then copy data/processed/genealogy.json → static/data/
 */
export async function seedRelationships(): Promise<void> {
    const alreadySeeded = await isRelationshipsSeeded();
    if (alreadySeeded) return;

    console.log('[seed] Loading relationships data...');
    seedStatus.step('Loading genealogy…');

    const records = await fetchJsonAsset<Relationship[]>('genealogy.json');
    if (!records) return;

    // Emitting empty JSON is a valid missing-dependency behavior from the pipeline
    if (records.length === 0) {
        console.log('[seed] Relationships data is structurally intact but empty. Skipping tx.');
        return;
    }

    const BATCH_SIZE = 10_000;
    await db.transaction('rw', db.relationships, async () => {
        for (let i = 0; i < records.length; i += BATCH_SIZE) {
            const batch = records.slice(i, i + BATCH_SIZE);
            await db.relationships.bulkPut(batch);
            seedProgress.during(SEED_WEIGHTS.relationships, (i + batch.length) / records.length);
        }
    });

    console.log(`[seed] Relationships: ${records.length} records loaded.`);
}

/**
 * Seed the Strong's lexicon from pre-processed JSON files.
 * Loads Hebrew (and Greek when available) from /static/data/lexicon-*.json.
 *
 * Requires the data pipeline to have run first:
 *   cd packages/data-pipeline && pnpm run fetch:bibledata && pnpm run import:lexicon
 *   # then copy data/processed/lexicon-hebrew.json → static/data/
 */
export async function seedLexicon(): Promise<void> {
    const alreadySeeded = await isLexiconSeeded();
    if (alreadySeeded) return;

    console.log('[seed] Loading Strong\'s lexicon...');
    seedStatus.step('Loading Strong’s lexicon…');

    const sources: Array<{ file: string }> = [
        { file: 'lexicon-hebrew.json' },
        { file: 'lexicon-greek.json' },
    ];

    let totalLoaded = 0;

    for (const [index, { file }] of sources.entries()) {
        const records = await fetchJsonAsset<LexiconEntry[]>(file);
        if (!records || records.length === 0) continue;

        await db.transaction('rw', db.lexicon, async () => {
            await db.lexicon.bulkPut(records);
        });

        console.log(`[seed] Lexicon (${file}): ${records.length} entries loaded.`);
        totalLoaded += records.length;
        seedProgress.during(SEED_WEIGHTS.lexicon, (index + 1) / sources.length);
    }

    if (totalLoaded === 0) {
        console.warn('[seed] No lexicon data loaded. Run: pnpm run fetch:bibledata && pnpm run import:lexicon');
    }
}

/** Seed all translations. Called once on app startup. */
export async function seedAll(): Promise<void> {
    const manifests: TranslationManifest[] = [
        {
            id: 'KJV',
            name: 'King James Version',
            abbreviation: 'KJV',
            language: 'en',
            license: 'Public Domain',
            description: 'The Authorized King James Version (1769)',
            strongs: true,
            file: 'kjv-verses.json',
        },
        {
            id: 'OEB',
            name: 'Open English Bible',
            abbreviation: 'OEB',
            language: 'en',
            license: 'Public Domain (CC0)',
            description: 'Open English Bible - a free, open-license modern English translation (in progress: full NT, partial OT)',
            coverage: 'NT + partial OT',
            file: 'oeb-verses.json',
        },
        {
            id: 'WEB',
            name: 'World English Bible',
            abbreviation: 'WEB',
            language: 'en',
            license: 'Public Domain',
            description: 'World English Bible - a modern public domain translation',
            file: 'web-verses.json',
        },
        {
            id: 'BSB',
            name: 'Berean Standard Bible',
            abbreviation: 'BSB',
            language: 'en',
            license: 'Public Domain',
            description: 'Berean Standard Bible - a modern, readable translation released into the public domain in 2023',
            strongs: true,
            file: 'bsb-verses.json',
        },
        {
            id: 'ASV',
            name: 'American Standard Version',
            abbreviation: 'ASV',
            language: 'en',
            license: 'Public Domain',
            description: 'American Standard Version (1901) - the classic formal-equivalence revision of the KJV',
            strongs: true,
            file: 'asv-verses.json',
        },
        {
            id: 'YLT',
            name: "Young's Literal Translation",
            abbreviation: 'YLT',
            language: 'en',
            license: 'Public Domain',
            description: "Young's Literal Translation (1898) - a hyper-literal study translation",
            file: 'ylt-verses.json',
        },
        {
            id: 'DBY',
            name: 'Darby Translation',
            abbreviation: 'DBY',
            language: 'en',
            license: 'Public Domain',
            description: 'Darby Translation (1890) - John Nelson Darby\'s formal translation',
            strongs: true,
            file: 'dby-verses.json',
        },
    ];

    // The progress total includes theographic: the layout runs
    // seedTheographic() immediately after seedAll(), on the same boot screen.
    seedProgress.start([
        ...manifests.map(() => SEED_WEIGHTS.translation),
        SEED_WEIGHTS.crossReferences,
        SEED_WEIGHTS.relationships,
        SEED_WEIGHTS.lexicon,
        SEED_WEIGHTS.theographic,
    ]);

    // Seed sequentially to avoid overwhelming the browser.
    // Each step is isolated: one dataset failing (missing file, quota,
    // DB error) must not prevent the remaining datasets from seeding.
    // Every failure is surfaced through seedStatus (known-issues #16) -
    // boot still completes, but the UI shows what's missing.
    for (const manifest of manifests) {
        try {
            await seedTranslation(manifest);
        } catch (err) {
            console.error(`[seed] ${manifest.id} failed:`, err);
            seedStatus.fail(manifest.name, err);
        } finally {
            seedProgress.finish(SEED_WEIGHTS.translation);
        }
    }

    // Refresh translation metadata on already-seeded profiles.
    // seedTranslation skips fully-seeded translations, so fields added in
    // later app versions (e.g. coverage, known-issues #30) would otherwise
    // never reach existing users. update() no-ops when the record is absent.
    for (const m of manifests) {
        try {
            await db.translations.update(m.id, {
                name: m.name,
                abbreviation: m.abbreviation,
                language: m.language,
                license: m.license,
                description: m.description,
                ...(m.coverage ? { coverage: m.coverage } : {}),
                ...(m.strongs ? { strongs: true } : {}),
            });
        } catch {
            // metadata refresh is best-effort
        }
    }

    // Seed cross-references (after translations, before UI needs them)
    try {
        await seedCrossReferences();
    } catch (err) {
        console.error('[seed] Cross-references failed:', err);
        seedStatus.fail('Cross-references', err);
    } finally {
        seedProgress.finish(SEED_WEIGHTS.crossReferences);
    }

    // Seed relationships (genealogy)
    try {
        await seedRelationships();
    } catch (err) {
        console.error('[seed] Relationships failed:', err);
        seedStatus.fail('Genealogy', err);
    } finally {
        seedProgress.finish(SEED_WEIGHTS.relationships);
    }

    // Seed Strong's lexicon (Hebrew + Greek when available)
    try {
        await seedLexicon();
    } catch (err) {
        console.error('[seed] Lexicon failed:', err);
        seedStatus.fail("Strong's lexicon", err);
    } finally {
        seedProgress.finish(SEED_WEIGHTS.lexicon);
    }

    seedStatus.step(null);
}
