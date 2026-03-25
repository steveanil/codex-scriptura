import Dexie, { type EntityTable } from 'dexie';
import type { VerseRecord, Translation, Annotation, Tag, UserSettings } from '@codex-scriptura/core';

// ─── Database Definition ───────────────────────────────────

export class CodexDB extends Dexie {
    verses!: EntityTable<VerseRecord, 'id'>;
    translations!: EntityTable<Translation, 'id'>;
    annotations!: EntityTable<Annotation, 'id'>;
    tags!: EntityTable<Tag, 'id'>;
    settings!: EntityTable<UserSettings, 'id'>;

    constructor() {
        super('codex-scriptura');

        this.version(1).stores({
            // Key format: "KJV.Gen.1.1" — compound index on translationId+book+chapter
            verses: 'id, translationId, [translationId+book+chapter], [translationId+osisId], book, chapter',
            translations: 'id',
            annotations: 'id, type, verseStart, verseEnd, *tags, created, modified',
            tags: 'id, name',
            settings: 'id',
        });
    }
}

export const db = new CodexDB();

// ─── Repository Helpers ───────────────────────────────────

/** Get all verses for a chapter in a given translation. */
export async function getChapter(
    translationId: string,
    book: string,
    chapter: number
): Promise<VerseRecord[]> {
    return db.verses
        .where({ translationId, book, chapter })
        .sortBy('verse');
}

/** Get a single verse by translation and OSIS ID (e.g. "Gen.1.1"). */
export async function getVerse(
    translationId: string,
    osisId: string
): Promise<VerseRecord | undefined> {
    return db.verses
        .where({ translationId, osisId })
        .first();
}

/** Get all books that have verses for a translation. */
export async function getBookList(translationId: string): Promise<string[]> {
    const verses = await db.verses
        .where('translationId')
        .equals(translationId)
        .toArray();

    const books = new Set<string>();
    for (const v of verses) books.add(v.book);
    return Array.from(books);
}

/** Get all chapters for a book in a translation. */
export async function getChapterList(
    translationId: string,
    book: string
): Promise<number[]> {
    const verses = await db.verses
        .where({ translationId, book })
        .toArray();

    const chapters = new Set<number>();
    for (const v of verses) chapters.add(v.chapter);
    return Array.from(chapters).sort((a, b) => a - b);
}

/** Get all available translations. */
export async function getTranslations(): Promise<Translation[]> {
    return db.translations.toArray();
}

/** Get user settings (singleton). */
export async function getSettings(): Promise<UserSettings> {
    const settings = await db.settings.get('default');
    return settings ?? {
        id: 'default',
        activeTranslation: 'KJV',
        theme: 'system',
        fontSize: 16,
        readerLayout: 'single',
    };
}

/** Save user settings. */
export async function saveSettings(settings: UserSettings): Promise<void> {
    await db.settings.put(settings);
}

/** Check if a translation has been seeded. */
export async function isTranslationSeeded(translationId: string): Promise<boolean> {
    const count = await db.verses
        .where('translationId')
        .equals(translationId)
        .count();
    return count > 0;
}
