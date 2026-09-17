import type { Person, Place, BibleEvent, DictionaryEntry } from '@codex-scriptura/core';
import { db } from './database.js';

// ─── Theographic Queries ───────────────────────────────────

/** Get a single person by Theographic ID. */
export async function getPersonById(id: string): Promise<Person | undefined> {
    return db.persons.get(id);
}

/** Get a single place by Theographic ID. */
export async function getPlaceById(id: string): Promise<Place | undefined> {
    return db.places.get(id);
}

/** Get a single event by Theographic ID. */
export async function getEventById(id: string): Promise<BibleEvent | undefined> {
    return db.events.get(id);
}

/** Get all persons mentioned in a specific verse (e.g. "Gen.1.1"). */
export async function getPersonsByVerse(ref: string): Promise<Person[]> {
    return db.persons.where('verseRefs').equals(ref).toArray();
}

/** Get all places mentioned in a specific verse (e.g. "Gen.1.1"). */
export async function getPlacesByVerse(ref: string): Promise<Place[]> {
    return db.places.where('verseRefs').equals(ref).toArray();
}

/** Get all events associated with a specific verse (e.g. "Gen.1.1"). */
export async function getEventsByVerse(ref: string): Promise<BibleEvent[]> {
    return db.events.where('verseRefs').equals(ref).toArray();
}

/**
 * Look up a term in Easton's dictionary (case-insensitive).
 * The `id` is the lowercased term, so this is a primary-key lookup.
 */
export async function lookupDictionary(term: string): Promise<DictionaryEntry | undefined> {
    return db.dictionary.get(term.trim().toLowerCase());
}

/**
 * Get all persons, places, and events that appear in any of the given OSIS verse refs.
 *
 * Uses `anyOf` on the multiEntry index so the entire chapter resolves in 3 queries
 * instead of N×3. Duplicate entities (same entity in multiple verses) are collapsed
 * automatically by `.distinct()` on the primary key.
 *
 * Returns empty arrays when Theographic data has not yet been seeded.
 */
export async function getEntitiesForChapter(osisIds: string[]): Promise<{
    persons: Person[];
    places: Place[];
    events: BibleEvent[];
}> {
    if (osisIds.length === 0) return { persons: [], places: [], events: [] };

    const [persons, places, events] = await Promise.all([
        db.persons.where('verseRefs').anyOf(osisIds).distinct().toArray(),
        db.places.where('verseRefs').anyOf(osisIds).distinct().toArray(),
        db.events.where('verseRefs').anyOf(osisIds).distinct().toArray(),
    ]);

    return { persons, places, events };
}
