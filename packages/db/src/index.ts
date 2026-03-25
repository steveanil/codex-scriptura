import Dexie, { type EntityTable } from 'dexie';
import type { VerseRecord, Translation, Annotation, Tag, UserSettings } from '@codex-scriptura/core';
import { BOOKS } from '@codex-scriptura/core';

// ─── Database Definition ───────────────────────────────────

export class CodexDB extends Dexie {
    verses!: EntityTable<VerseRecord, 'id'>;
    translations!: EntityTable<Translation, 'id'>;
    annotations!: EntityTable<Annotation, 'id'>;
    tags!: EntityTable<Tag, 'id'>;
    settings!: EntityTable<UserSettings, 'id'>;

    constructor() {
        super('codex-scriptura');

        // v1: initial schema
        this.version(1).stores({
            verses: 'id, translationId, [translationId+book+chapter], [translationId+osisId], book, chapter',
            translations: 'id',
            annotations: 'id, type, verseStart, verseEnd, *tags, created, modified',
            tags: 'id, name',
            settings: 'id',
        });

        // v2: added 'book' index to annotations for cross-translation lookups
        this.version(2).stores({
            annotations: 'id, type, book, verseStart, verseEnd, *tags, created, modified',
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

/** Get all books that have verses for a translation, in canonical order. */
export async function getBookList(translationId: string): Promise<string[]> {
    const verses = await db.verses
        .where('translationId')
        .equals(translationId)
        .toArray();

    const books = new Set<string>();
    for (const v of verses) books.add(v.book);

    // Only include books that exist in the canonical BOOKS array
    const canonicalOrder = BOOKS.map(b => b.osisId);
    return canonicalOrder.filter(id => books.has(id));
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

// ─── Annotation Helpers ───────────────────────────────────

/** 
 * Get all annotations for a specific book.
 * It is highly efficient to query by book, then filter by chapter/verses 
 * in-memory to handle cross-chapter highlights.
 */
export async function getAnnotationsForBook(book: string): Promise<Annotation[]> {
    return db.annotations
        .where('book')
        .equals(book)
        .toArray();
}

/** Save or update an annotation. */
export async function saveAnnotation(annotation: Annotation): Promise<void> {
    annotation.modified = Date.now();
    await db.annotations.put(annotation);
}

/** Delete an annotation. */
export async function deleteAnnotation(id: string): Promise<void> {
    await db.annotations.delete(id);
}

// ─── Tag Helpers ──────────────────────────────────────────

/** Get all defined tags. */
export async function getTags(): Promise<Tag[]> {
    return db.tags.toArray();
}

/** Save a tag. */
export async function saveTag(tag: Tag): Promise<void> {
    await db.tags.put(tag);
}

/** Delete a tag. */
export async function deleteTag(id: string): Promise<void> {
    await db.tags.delete(id);
}
