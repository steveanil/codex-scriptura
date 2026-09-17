import Dexie from 'dexie';
import type { VerseRecord } from '@codex-scriptura/core';
import { BOOKS, parseOsisId } from '@codex-scriptura/core';
import { db } from './database.js';

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

/**
 * Get a single verse by translation and OSIS ID (e.g. "Gen.1.1").
 *
 * Falls back to bridged records: when a source bridges verses
 * (e.g. "Neh.7.15–16" stored as verse 15 with `verseEnd: 16`), a lookup
 * for the second verse of the bridge ("Neh.7.16") resolves to the bridge
 * record instead of returning undefined - cross-references and hover
 * previews targeting bridged verses keep working.
 */
export async function getVerse(
    translationId: string,
    osisId: string
): Promise<VerseRecord | undefined> {
    const direct = await db.verses
        .where({ translationId, osisId })
        .first();
    if (direct) return direct;

    const parsed = parseOsisId(osisId);
    if (!parsed) return undefined;
    const { book, chapter, verse } = parsed;

    const chapterVerses = await getChapter(translationId, book, chapter);
    return chapterVerses.find(
        (v) => v.verseEnd !== undefined && v.verse < verse && verse <= v.verseEnd
    );
}

/**
 * A fresh maximum-key value per call site. `Dexie.maxKey` is a single shared
 * `[[]]` array instance - putting it twice into one compound bound makes the
 * key contain the same object reference twice, which fake-indexeddb's
 * circular-reference detection rejects (real browsers accept it).
 */
function freshMaxKey(): unknown {
    return Array.isArray(Dexie.maxKey) ? [[]] : Dexie.maxKey;
}

/**
 * Get all books that have verses for a translation, in canonical order.
 *
 * Index-only scan: `uniqueKeys()` on the [translationId+book+chapter]
 * compound index yields ~1 key per chapter (~1.2K) without hydrating the
 * ~31K verse records - this runs on every navigation load, per pane.
 */
export async function getBookList(translationId: string): Promise<string[]> {
    const keys = await db.verses
        .where('[translationId+book+chapter]')
        .between(
            [translationId, Dexie.minKey, Dexie.minKey],
            [translationId, freshMaxKey(), freshMaxKey()],
        )
        .uniqueKeys();

    const books = new Set<string>();
    for (const k of keys) books.add((k as unknown as [string, string, number])[1]);

    // Only include books that exist in the canonical BOOKS array
    const canonicalOrder = BOOKS.map(b => b.osisId);
    return canonicalOrder.filter(id => books.has(id));
}

/** Get all chapters for a book in a translation (index-only, see getBookList). */
export async function getChapterList(
    translationId: string,
    book: string
): Promise<number[]> {
    const keys = await db.verses
        .where('[translationId+book+chapter]')
        .between(
            [translationId, book, Dexie.minKey],
            [translationId, book, freshMaxKey()],
        )
        .uniqueKeys();

    return keys
        .map((k) => (k as unknown as [string, string, number])[2])
        .sort((a, b) => a - b);
}
