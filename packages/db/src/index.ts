import Dexie, { type EntityTable } from 'dexie';
import type { VerseRecord, Translation, Annotation, Tag, UserPreferences, HighlightPreset, SavedSearch, ConcordanceSearchResult, Person, Place, BibleEvent, DictionaryEntry, SearchIndexCache } from '@codex-scriptura/core';
import { BOOKS } from '@codex-scriptura/core';

// ─── Database Definition ───────────────────────────────────

export class CodexDB extends Dexie {
    verses!: EntityTable<VerseRecord, 'id'>;
    translations!: EntityTable<Translation, 'id'>;
    annotations!: EntityTable<Annotation, 'id'>;
    tags!: EntityTable<Tag, 'id'>;
    settings!: EntityTable<UserPreferences, 'id'>;
    savedSearches!: EntityTable<SavedSearch, 'id'>;
    persons!: EntityTable<Person, 'id'>;
    places!: EntityTable<Place, 'id'>;
    events!: EntityTable<BibleEvent, 'id'>;
    dictionary!: EntityTable<DictionaryEntry, 'id'>;
    searchIndexes!: EntityTable<SearchIndexCache, 'id'>;

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

        // v3: added savedSearches table
        this.version(3).stores({
            savedSearches: 'id, created',
        });

        // v4: migrated UserSettings → UserPreferences (nested fonts, reader, presets)
        this.version(4).upgrade(async (tx) => {
            const old = await tx.table('settings').get('default');
            if (!old) return;
            const migrated: UserPreferences = {
                id: 'default',
                activeTranslation: old.activeTranslation ?? 'KJV',
                parallelTranslation: old.parallelTranslation,
                theme: old.theme ?? 'system',
                accentColor: '#6b5ce7',
                fonts: {
                    ui: 'Inter',
                    reader: 'Georgia',
                    greek: 'SBL Greek',
                    hebrew: 'SBL Hebrew',
                    size: old.fontSize ?? 16,
                },
                reader: {
                    layout: old.readerLayout ?? 'single',
                    lineHeight: 1.7,
                    columnWidth: 'medium',
                    density: 'normal',
                    showVerseNumbers: true,
                    showRedLetters: true,
                    paragraphMode: false,
                },
                highlightPresets: [
                    { id: 'yellow', name: 'Yellow', color: '#f59e0b' },
                    { id: 'green',  name: 'Green',  color: '#22c55e' },
                    { id: 'blue',   name: 'Blue',   color: '#3b82f6' },
                    { id: 'pink',   name: 'Pink',   color: '#ec4899' },
                ],
            };
            await tx.table('settings').put(migrated);
        });

        // v5: Theographic entities — persons, places, events, dictionary
        this.version(5).stores({
            persons: 'id, name, *verseRefs',
            places: 'id, name, lat, lng, *verseRefs',
            events: 'id, name, *verseRefs',
            dictionary: 'id, term',
        });

        // v6: Update highlight preset colors for better contrast
        this.version(6).upgrade(async (tx) => {
            const settings = await tx.table('settings').get('default');
            if (settings && settings.highlightPresets) {
                const updated = settings.highlightPresets.map((p: HighlightPreset) => {
                    if (p.id === 'yellow' && (p.color === '#fef08a' || p.color.startsWith('rgba'))) return { ...p, color: '#f59e0b' };
                    if (p.id === 'green' && (p.color === '#bbf7d0' || p.color.startsWith('rgba'))) return { ...p, color: '#22c55e' };
                    if (p.id === 'blue' && (p.color === '#bfdbfe' || p.color.startsWith('rgba'))) return { ...p, color: '#3b82f6' };
                    if (p.id === 'pink' && (p.color === '#fbcfe8' || p.color.startsWith('rgba'))) return { ...p, color: '#ec4899' };
                    return p;
                });
                await tx.table('settings').update('default', { highlightPresets: updated });
            }
        });

        // v7: Clear persons table to force re-seed with nameMeaning/nameMeaningSource fields
        // from the BibleData PersonLabel enrichment (v0.3.0).
        this.version(7).upgrade(async (tx) => {
            await tx.table('persons').clear();
        });

        // v8: Cached MiniSearch indexes — avoids rebuilding from scratch every session
        this.version(8).stores({
            searchIndexes: 'id, translationId',
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

// ─── Default Preferences ──────────────────────────────────

const DEFAULT_PREFERENCES: Omit<UserPreferences, 'id'> = {
    activeTranslation: 'KJV',
    theme: 'system',
    accentColor: '#6b5ce7',
    fonts: {
        ui: 'Inter',
        reader: 'Georgia',
        greek: 'SBL Greek',
        hebrew: 'SBL Hebrew',
        size: 16,
    },
    reader: {
        layout: 'single',
        lineHeight: 1.7,
        columnWidth: 'medium',
        density: 'normal',
        showVerseNumbers: true,
        showRedLetters: true,
        paragraphMode: false,
    },
    highlightPresets: [
        { id: 'yellow', name: 'Yellow', color: '#f59e0b' },
        { id: 'green',  name: 'Green',  color: '#22c55e' },
        { id: 'blue',   name: 'Blue',   color: '#3b82f6' },
        { id: 'pink',   name: 'Pink',   color: '#ec4899' },
    ],
    readingSpeed: 200,
};

/** Get user preferences (singleton). */
export async function getSettings(): Promise<UserPreferences> {
    const prefs = await db.settings.get('default');
    return prefs ?? { id: 'default', ...DEFAULT_PREFERENCES };
}

/** Save user preferences. */
export async function saveSettings(prefs: UserPreferences): Promise<void> {
    await db.settings.put(prefs);
}

// ─── v0.3.0 Preferences API ───────────────────────────────

/** Get user preferences — canonical v0.3.0 name. */
export async function getUserPreferences(): Promise<UserPreferences> {
    return getSettings();
}

/** Save user preferences — canonical v0.3.0 name. */
export async function saveUserPreferences(prefs: UserPreferences): Promise<void> {
    return saveSettings(prefs);
}

/** Reset user preferences to factory defaults and return them. */
export async function resetUserPreferencesToDefaults(): Promise<UserPreferences> {
    const defaults: UserPreferences = { id: 'default', ...DEFAULT_PREFERENCES };
    await db.settings.put(defaults);
    return defaults;
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

// ─── All Annotations ──────────────────────────────────────

/** Get all annotations across all books, newest first. */
export async function getAllAnnotations(): Promise<Annotation[]> {
    return db.annotations.orderBy('modified').reverse().toArray();
}

// ─── Saved Searches ───────────────────────────────────────

/** Get all saved searches, newest first. */
export async function getSavedSearches(): Promise<SavedSearch[]> {
    return db.savedSearches.orderBy('created').reverse().toArray();
}

/** Save or update a saved search. */
export async function saveSearch(search: SavedSearch): Promise<void> {
    await db.savedSearches.put(search);
}

/** Delete a saved search. */
export async function deleteSavedSearch(id: string): Promise<void> {
    await db.savedSearches.delete(id);
}

// ─── Lexical / Concordance Search ─────────────────────────

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a word-boundary regex for the given query term.
 *
 * When `includeVariants` is false, produces an exact whole-word match.
 * When true, strips common English and KJV archaic suffixes to find an
 * approximate stem, then matches the stem plus common endings.
 * Handles forms like loved/loves/loving/loveth/lovest for the query "love".
 */
function buildWordPattern(word: string, includeVariants: boolean): RegExp | null {
    const w = word.trim().toLowerCase();
    if (!w) return null;

    if (!includeVariants) {
        return new RegExp(`\\b${escapeRegex(w)}\\b`, 'gi');
    }

    // Strip common English and KJV archaic suffixes — longer suffixes first.
    let stem = w
        .replace(/ieth$/, 'y')   // "glorieth" → "glory"
        .replace(/ied$/, 'y')    // "gloried"  → "glory"
        .replace(/ies$/, 'y')    // "glories"  → "glory"
        .replace(/eth$/, '')     // "loveth"   → "lov"
        .replace(/est$/, '')     // "lovest"   → "lov"
        .replace(/ing$/, '')     // "loving"   → "lov"
        .replace(/ed$/, '')      // "loved"    → "lov"
        .replace(/es$/, '')      // "loves"    → "lov"
        .replace(/s$/, '')       // plural/3rd person
        .replace(/e$/, '');      // trailing silent e

    if (stem.length < 3) stem = w; // don't over-strip short words

    const escaped = escapeRegex(stem);
    // Match stem + optional silent 'e' bridge + optional common suffix
    return new RegExp(
        `\\b${escaped}e?(?:s|d|th|ing|eth|est|er|ers|ieth|ied|ies|y)?\\b`,
        'gi'
    );
}

/**
 * Lexical concordance search — exhaustively finds every verse in a translation
 * where a word (or its inflected variants) appears as a complete word token.
 *
 * Unlike MiniSearch full-text search (top-N ranked), this scan is:
 * - Deterministic: returns ALL matching verses, not just top results
 * - Ordered by insertion (canonical Bible) order from the DB
 * - Precise: counts exact occurrences per verse and records surface forms
 *
 * This is the foundation for Strong's-number-based search once a tagged
 * source (e.g. OpenScriptures morphhb/morphgnt) is integrated.
 */
export async function wordSearch(
    translationId: string,
    word: string,
    includeVariants = false
): Promise<ConcordanceSearchResult[]> {
    const pattern = buildWordPattern(word, includeVariants);
    if (!pattern) return [];

    const allVerses = await db.verses
        .where('translationId')
        .equals(translationId)
        .toArray();

    const results: ConcordanceSearchResult[] = [];

    for (const verse of allVerses) {
        // Create a fresh regex per verse to reset lastIndex
        const re = new RegExp(pattern.source, pattern.flags);
        const found = verse.text.match(re);
        if (!found || found.length === 0) continue;

        const surfaceMap = new Map<string, number>();
        for (const m of found) {
            const lc = m.toLowerCase();
            surfaceMap.set(lc, (surfaceMap.get(lc) ?? 0) + 1);
        }

        results.push({
            verse,
            matches: Array.from(surfaceMap.entries()).map(([surface, count]) => ({
                surface,
                count,
            })),
            hitCount: found.length,
        });
    }

    return results;
}

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

/** Check if Theographic data has been seeded. */
export async function isTheographicSeeded(): Promise<boolean> {
    return (await db.persons.count()) > 0;
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

// ─── Search Index Cache ────────────────────────────────────

/** Retrieve a cached MiniSearch index by its id key (e.g. "minisearch:KJV", "palette:KJV"). */
export async function getCachedSearchIndex(id: string): Promise<SearchIndexCache | undefined> {
    return db.searchIndexes.get(id);
}

/** Persist a serialized MiniSearch index for a translation. */
export async function saveCachedSearchIndex(entry: SearchIndexCache): Promise<void> {
    await db.searchIndexes.put(entry);
}

/** Clear all cached search indexes (e.g. after re-seeding translation data). */
export async function clearCachedSearchIndexes(): Promise<void> {
    await db.searchIndexes.clear();
}
