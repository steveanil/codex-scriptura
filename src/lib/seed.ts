import { db, isTranslationSeeded, isTheographicSeeded } from '@codex-scriptura/db';
import type { VerseRecord, Translation, Person, Place, BibleEvent, DictionaryEntry } from '@codex-scriptura/core';

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
}
