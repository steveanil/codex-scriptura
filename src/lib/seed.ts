import { db, isTranslationSeeded, isTheographicSeeded, isCrossReferencesSeeded, isRelationshipsSeeded, isLexiconSeeded, clearCachedSearchIndexes } from '@codex-scriptura/db';
import type { VerseRecord, Translation, Person, Place, BibleEvent, DictionaryEntry, CrossReference, Relationship, LexiconEntry } from '@codex-scriptura/core';

const DATA_BASE_URL = '/data';

type RawVerse = {
    translation: string;
    book: string;
    chapter: number;
    verse: number;
    osisId: string;
    text: string;
    /** Present only in verses imported from morphologically tagged sources. */
    lemmas?: string;
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
    file: string;
};

/**
 * Seed a translation into IndexedDB from a static JSON file.
 * The JSON files live in /static/data/ and are fetched at runtime.
 */
async function seedTranslation(manifest: TranslationManifest): Promise<void> {
    const alreadySeeded = await isTranslationSeeded(manifest.id);
    if (alreadySeeded) return;

    console.log(`[seed] Loading ${manifest.id}...`);
    const res = await fetch(`${DATA_BASE_URL}/${manifest.file}`);
    const rawVerses: RawVerse[] = await res.json();

    const verses: VerseRecord[] = rawVerses.map((v) => ({
        id: `${manifest.id}.${v.osisId}`,
        translationId: manifest.id,
        book: v.book,
        chapter: v.chapter,
        verse: v.verse,
        osisId: v.osisId,
        text: v.text,
        ...(v.lemmas ? { lemmas: v.lemmas } : {}),
        ...(v.wj ? { wj: v.wj } : {}),
    }));

    const translation: Translation = {
        id: manifest.id,
        name: manifest.name,
        abbreviation: manifest.abbreviation,
        language: manifest.language,
        license: manifest.license,
        description: manifest.description,
        verseCount: verses.length,
    };

    // Bulk insert in a transaction
    await db.transaction('rw', [db.verses, db.translations], async () => {
        await db.translations.put(translation);
        await db.verses.bulkPut(verses);
    });

    console.log(`[seed] ${manifest.id}: ${verses.length} verses loaded.`);

    // Invalidate cached search indexes — verse data has changed
    await clearCachedSearchIndexes();
}

/**
 * Seed Theographic data (persons, places, events, dictionary) from pre-processed
 * JSON files in /static/data/. Runs once — no-ops if data already exists.
 *
 * Requires the data pipeline to have run first:
 *   cd packages/data-pipeline && npx tsx src/import-theographic.ts
 *   # then copy data/processed/{persons,places,events,dictionary}.json → static/data/
 */
export async function seedTheographic(): Promise<void> {
    const alreadySeeded = await isTheographicSeeded();
    if (alreadySeeded) return;

    console.log('[seed] Loading Theographic data...');

    async function fetchJson<T>(file: string): Promise<T[] | null> {
        try {
            const res = await fetch(`${DATA_BASE_URL}/${file}`);
            if (!res.ok) {
                console.warn(`[seed] Theographic file not found: ${file} — skipping`);
                return null;
            }
            return res.json() as Promise<T[]>;
        } catch {
            console.warn(`[seed] Failed to fetch ${file} — skipping`);
            return null;
        }
    }

    const [persons, places, events, dictionary] = await Promise.all([
        fetchJson<Person>('persons.json'),
        fetchJson<Place>('places.json'),
        fetchJson<BibleEvent>('events.json'),
        fetchJson<DictionaryEntry>('dictionary.json'),
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

    try {
        const res = await fetch(`${DATA_BASE_URL}/cross-references.json`);
        if (!res.ok) {
            console.warn('[seed] Cross-reference data not found — skipping');
            return;
        }
        const records: CrossReference[] = await res.json();

        // Bulk insert in batches to avoid overwhelming IndexedDB
        const BATCH_SIZE = 10_000;
        await db.transaction('rw', db.crossReferences, async () => {
            for (let i = 0; i < records.length; i += BATCH_SIZE) {
                const batch = records.slice(i, i + BATCH_SIZE);
                await db.crossReferences.bulkPut(batch);
            }
        });

        console.log(`[seed] Cross-references: ${records.length} records loaded.`);
    } catch (err) {
        console.warn('[seed] Failed to load cross-reference data:', err);
    }
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

    try {
        const res = await fetch(`${DATA_BASE_URL}/genealogy.json`);
        if (!res.ok) {
            console.warn('[seed] Relationships data not found — skipping (run importer pipeline)');
            return;
        }
        
        const records: Relationship[] = await res.json();
        
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
            }
        });

        console.log(`[seed] Relationships: ${records.length} records loaded.`);
    } catch (err) {
        console.warn('[seed] Failed to load relationships data:', err);
    }
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

    const sources: Array<{ file: string }> = [
        { file: 'lexicon-hebrew.json' },
        { file: 'lexicon-greek.json' },
    ];

    let totalLoaded = 0;

    for (const { file } of sources) {
        try {
            const res = await fetch(`${DATA_BASE_URL}/${file}`);
            if (!res.ok) {
                console.warn(`[seed] Lexicon file not found: ${file} — skipping`);
                continue;
            }
            const records: LexiconEntry[] = await res.json();
            if (records.length === 0) continue;

            await db.transaction('rw', db.lexicon, async () => {
                await db.lexicon.bulkPut(records);
            });

            console.log(`[seed] Lexicon (${file}): ${records.length} entries loaded.`);
            totalLoaded += records.length;
        } catch (err) {
            console.warn(`[seed] Failed to load ${file}:`, err);
        }
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
            file: 'kjv-verses.json',
        },
        {
            id: 'OEB',
            name: 'Open English Bible',
            abbreviation: 'OEB',
            language: 'en',
            license: 'Public Domain (CC0)',
            description: 'Open English Bible — a free, open-license modern English translation',
            file: 'oeb-verses.json',
        },
        {
            id: 'WEB',
            name: 'World English Bible',
            abbreviation: 'WEB',
            language: 'en',
            license: 'Public Domain',
            description: 'World English Bible — a modern public domain translation',
            file: 'web-verses.json',
        },
    ];

    // Seed sequentially to avoid overwhelming the browser
    for (const manifest of manifests) {
        await seedTranslation(manifest);
    }

    // Seed cross-references (after translations, before UI needs them)
    await seedCrossReferences();
    
    // Seed relationships (genealogy)
    await seedRelationships();

    // Seed Strong's lexicon (Hebrew + Greek when available)
    await seedLexicon();
}
