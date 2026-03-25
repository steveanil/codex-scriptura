import { db, isTranslationSeeded } from '@codex-scriptura/db';
import type { VerseRecord, Translation } from '@codex-scriptura/core';

const DATA_BASE_URL = '/data';

type RawVerse = {
    translation: string;
    book: string;
    chapter: number;
    verse: number;
    osisId: string;
    text: string;
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
