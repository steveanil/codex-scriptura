import Dexie, { type EntityTable } from 'dexie';
import type { VerseRecord, Translation, Annotation, Tag, UserPreferences, HighlightPreset, SavedSearch, ConcordanceSearchResult, Person, Place, BibleEvent, DictionaryEntry, CrossReference, LexiconEntry, SearchIndexCache, BookConnectionMatrix, Relationship } from '@codex-scriptura/core';
import { BOOKS } from '@codex-scriptura/core';

// ─── Database Definition ───────────────────────────────────

/**
 * Generic key-value record for app-level state that is not part of
 * `UserPreferences` (nav history, split-pane layout, …). Kept separate so
 * the typed `settings` table holds exactly one record shape and a future
 * "export all user data" pass can enumerate both tables cleanly.
 */
export type KvRecord = { id: string; value: unknown };

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
    crossReferences!: EntityTable<CrossReference, 'id'>;
    searchIndexes!: EntityTable<SearchIndexCache, 'id'>;
    relationships!: EntityTable<Relationship, 'id'>;
    lexicon!: EntityTable<LexiconEntry, 'id'>;
    kv!: EntityTable<KvRecord, 'id'>;

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

        // v5: Theographic entities - persons, places, events, dictionary
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

        // v8: Cached MiniSearch indexes - avoids rebuilding from scratch every session
        this.version(8).stores({
            searchIndexes: 'id, translationId',
        });

        // v9: Cross-references - ~340K verse-to-verse linkages from OpenBible/TSK
        this.version(9).stores({
            crossReferences: 'id, sourceVerse, targetVerse, type, [sourceVerse+type], [targetVerse+type]',
        });

        // v10: Genealogy relationships
        this.version(10).stores({
            relationships: 'id, personFrom, personTo, type, [personFrom+type], [personTo+type]',
        });

        // v11: Strong's lexicon - Hebrew entries from BibleData (Greek TBD)
        this.version(11).stores({
            lexicon: 'id, strongsNumber, language, lemma',
        });

        // v12: Clear relationships to force re-seed with deterministically mapped Theographic IDs
        this.version(12).upgrade(async (tx) => {
            await tx.table('relationships').clear();
        });

        // v13: Clear cross-references to re-seed with corrected quotation classifications
        //       (overlay type-priority fix: OT-NT-Reference-Map quotation no longer
        //        shadowed by UBS allusion on the same verse pair)
        this.version(13).upgrade(async (tx) => {
            await tx.table('crossReferences').clear();
        });

        // v14: Cool-slate design refresh - move users still on the old default
        // accent/fonts to the new defaults. Deliberate customizations (values
        // that differ from the old defaults) are left untouched.
        this.version(14).upgrade(async (tx) => {
            const prefs = await tx.table('settings').get('default');
            if (!prefs) return;
            const patch: Record<string, unknown> = {};
            if (prefs.accentColor === '#6b5ce7' || prefs.accentColor === '#8b7cf6') {
                patch.accentColor = '#5e9ed6';
            }
            const fonts = { ...prefs.fonts };
            let fontsChanged = false;
            if (fonts.ui === 'Inter') { fonts.ui = 'Instrument Sans'; fontsChanged = true; }
            if (fonts.reader === 'Georgia' || fonts.reader === 'Crimson Pro') {
                fonts.reader = 'Newsreader';
                fontsChanged = true;
            }
            if (fontsChanged) patch.fonts = fonts;
            if (Object.keys(patch).length > 0) {
                await tx.table('settings').update('default', patch);
            }
        });

        // v15: The cool-slate design is dark-first - users still on the old
        // 'system' default follow the app default; an explicit 'light' stays.
        this.version(15).upgrade(async (tx) => {
            const prefs = await tx.table('settings').get('default');
            if (prefs?.theme === 'system') {
                await tx.table('settings').update('default', { theme: 'dark' });
            }
        });

        // v16: Clear verses to re-seed with corrected text extraction -
        // translator footnote/cross-ref note content no longer leaks into
        // verse text (WEB <f>/<x>, OEB <note>), and bridged verses
        // (<v id="15-16"/>) are now imported instead of dropped. Cached
        // search indexes are cleared because they index the old text.
        this.version(16).upgrade(async (tx) => {
            await tx.table('verses').clear();
            await tx.table('searchIndexes').clear();
        });

        // v17: God is not part of the family tree. Theographic encodes
        // Luke 3:38 ("Adam, which was the son of God") as literal family
        // columns, giving god_1324 father-of edges to Adam and Eve - which
        // put God at the apex of every ancestry walk. The importer now
        // excludes these; this removes them from already-seeded databases.
        this.version(17).upgrade(async (tx) => {
            await tx.table('relationships').where('personFrom').equals('god_1324').delete();
            await tx.table('relationships').where('personTo').equals('god_1324').delete();
        });

        // v18: generic kv table for app state that isn't UserPreferences
        // (known-issues #15). navHistory previously lived as a stray record
        // in the typed settings table via `as any` - delete it there (it is
        // ephemeral by design: cleared on tab close, so nothing to migrate).
        // The split-pane layout migrates from localStorage lazily on first
        // restore (stores/splitPanes.svelte.ts).
        this.version(18).stores({
            kv: 'id',
        }).upgrade(async (tx) => {
            await tx.table('settings').delete('navHistory');
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

    const parts = osisId.split('.');
    if (parts.length !== 3) return undefined;
    const chapter = parseInt(parts[1], 10);
    const verse = parseInt(parts[2], 10);
    if (!Number.isFinite(chapter) || !Number.isFinite(verse)) return undefined;

    const chapterVerses = await getChapter(translationId, parts[0], chapter);
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

/** Get all available translations. */
export async function getTranslations(): Promise<Translation[]> {
    return db.translations.toArray();
}

// ─── Default Preferences ──────────────────────────────────

const DEFAULT_PREFERENCES: Omit<UserPreferences, 'id'> = {
    activeTranslation: 'KJV',
    theme: 'dark',
    accentColor: '#5e9ed6',
    fonts: {
        ui: 'Instrument Sans',
        reader: 'Newsreader',
        greek: 'SBL Greek',
        hebrew: 'SBL Hebrew',
        size: 19,
    },
    reader: {
        layout: 'single',
        lineHeight: 1.95,
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
    lastBook: 'Gen',
    lastChapter: 1,
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

/** Get user preferences - canonical v0.3.0 name. */
export async function getUserPreferences(): Promise<UserPreferences> {
    return getSettings();
}

/** Save user preferences - canonical v0.3.0 name. */
export async function saveUserPreferences(prefs: UserPreferences): Promise<void> {
    return saveSettings(prefs);
}

/** Reset user preferences to factory defaults and return them. */
export async function resetUserPreferencesToDefaults(): Promise<UserPreferences> {
    const defaults: UserPreferences = { id: 'default', ...DEFAULT_PREFERENCES };
    await db.settings.put(defaults);
    return defaults;
}

// ─── Key-Value Store ──────────────────────────────────────

/** Read an app-state value from the kv table. */
export async function getKv<T>(id: string): Promise<T | undefined> {
    const rec = await db.kv.get(id);
    return rec?.value as T | undefined;
}

/** Write an app-state value to the kv table. Values must be structured-cloneable (no reactive proxies - snapshot first). */
export async function setKv(id: string, value: unknown): Promise<void> {
    await db.kv.put({ id, value });
}

/** Delete an app-state value from the kv table. */
export async function deleteKv(id: string): Promise<void> {
    await db.kv.delete(id);
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

    // Strip common English and KJV archaic suffixes - longer suffixes first.
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
 * Lexical concordance search - exhaustively finds every verse in a translation
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

// ─── Cross-Reference Queries ──────────────────────────────

/** Get all cross-references FROM a given verse (outbound edges). */
export async function getCrossReferencesFrom(osisId: string): Promise<CrossReference[]> {
    return db.crossReferences
        .where('sourceVerse')
        .equals(osisId)
        .toArray();
}

/** Get all cross-references TO a given verse (inbound edges). */
export async function getCrossReferencesTo(osisId: string): Promise<CrossReference[]> {
    return db.crossReferences
        .where('targetVerse')
        .equals(osisId)
        .toArray();
}

/**
 * Get all cross-references for a verse (both directions).
 * Returns deduplicated edges - if A→B exists, it won't be doubled.
 */
export async function getCrossReferencesForVerse(osisId: string): Promise<CrossReference[]> {
    const [from, to] = await Promise.all([
        getCrossReferencesFrom(osisId),
        getCrossReferencesTo(osisId),
    ]);

    // Deduplicate by ID
    const seen = new Set<string>();
    const result: CrossReference[] = [];
    for (const ref of [...from, ...to]) {
        if (!seen.has(ref.id)) {
            seen.add(ref.id);
            result.push(ref);
        }
    }
    return result;
}

/** Get all cross-references where the source verse is in the given book. */
export async function getCrossReferencesFromBook(book: string): Promise<CrossReference[]> {
    return db.crossReferences
        .where('sourceVerse')
        .startsWith(`${book}.`)
        .toArray();
}

/** Get all cross-references where the target verse is in the given book. */
export async function getCrossReferencesToBook(book: string): Promise<CrossReference[]> {
    return db.crossReferences
        .where('targetVerse')
        .startsWith(`${book}.`)
        .toArray();
}

/**
 * Get all outbound cross-references for every verse in a chapter.
 *
 * Uses a prefix range scan on the `sourceVerse` index (e.g. "Gen.1.")
 * to fetch the entire chapter in a single query. Returns a Map keyed
 * by source OSIS verse ID for O(1) per-verse lookups in the UI.
 *
 * Sorted by descending votes within each verse group so the UI can
 * slice the top-N without re-sorting.
 */
export async function getCrossReferencesForChapter(
    book: string,
    chapter: number,
): Promise<Map<string, CrossReference[]>> {
    const prefix = `${book}.${chapter}.`;
    const all = await db.crossReferences
        .where('sourceVerse')
        .startsWith(prefix)
        .toArray();

    const map = new Map<string, CrossReference[]>();
    for (const ref of all) {
        let arr = map.get(ref.sourceVerse);
        if (!arr) { arr = []; map.set(ref.sourceVerse, arr); }
        arr.push(ref);
    }

    // Sort each group by votes descending (highest-confidence first)
    for (const arr of map.values()) {
        arr.sort((a, b) => b.votes - a.votes);
    }

    return map;
}

/** Check if cross-reference data has been seeded. */
export async function isCrossReferencesSeeded(): Promise<boolean> {
    return (await db.crossReferences.count()) > 0;
}

/**
 * Get all cross-references between two books (both directions).
 *
 * When bookA === bookB, returns intra-book cross-references only.
 * Otherwise returns all edges where one endpoint is in bookA and
 * the other is in bookB.
 *
 * Uses the `sourceVerse` index to range-scan each book, then filters
 * the target in memory - fast because each book has O(1K–20K) source refs.
 */
export async function getCrossReferencesBetweenBooks(
    bookA: string,
    bookB: string,
): Promise<CrossReference[]> {
    if (bookA === bookB) {
        return db.crossReferences
            .where('sourceVerse').startsWith(`${bookA}.`)
            .filter(r => r.targetVerse.startsWith(`${bookA}.`))
            .toArray();
    }

    const [aToB, bToA] = await Promise.all([
        db.crossReferences
            .where('sourceVerse').startsWith(`${bookA}.`)
            .filter(r => r.targetVerse.startsWith(`${bookB}.`))
            .toArray(),
        db.crossReferences
            .where('sourceVerse').startsWith(`${bookB}.`)
            .filter(r => r.targetVerse.startsWith(`${bookA}.`))
            .toArray(),
    ]);

    return [...aToB, ...bToA];
}

/**
 * Aggregate all cross-references into a book-to-book connection matrix.
 *
 * Performs a full table scan (~340K rows) - intended for zoomed-out graph
 * views that need density weights between books. Cache the result; it only
 * changes after a re-seed.
 *
 * Access pattern: `matrix.get('Gen')?.get('John')` → count of cross-refs
 * from Genesis to John. Intra-book edges are included (src === tgt book).
 */
export async function getBookCrossReferenceMatrix(): Promise<BookConnectionMatrix> {
    const matrix = new Map<string, Map<string, number>>();

    await db.crossReferences.each(ref => {
        const srcDot = ref.sourceVerse.indexOf('.');
        const tgtDot = ref.targetVerse.indexOf('.');
        const srcBook = srcDot > 0 ? ref.sourceVerse.slice(0, srcDot) : ref.sourceVerse;
        const tgtBook = tgtDot > 0 ? ref.targetVerse.slice(0, tgtDot) : ref.targetVerse;

        let row = matrix.get(srcBook);
        if (!row) { row = new Map(); matrix.set(srcBook, row); }
        row.set(tgtBook, (row.get(tgtBook) ?? 0) + 1);
    });

    return matrix;
}

// ─── Genealogy Relationships ──────────────────────────────

/** Check if the Strong's lexicon has been seeded. */
export async function isLexiconSeeded(): Promise<boolean> {
    return (await db.lexicon.count()) > 0;
}

/** Look up a Strong's entry by its ID (e.g. "H430"). */
export async function getLexiconEntry(id: string): Promise<LexiconEntry | undefined> {
    return db.lexicon.get(id);
}

/** Get all lexicon entries for a given language. */
export async function getLexiconByLanguage(language: 'hebrew' | 'greek'): Promise<LexiconEntry[]> {
    return db.lexicon.where('language').equals(language).toArray();
}

/**
 * Search the lexicon by gloss (English definition) or lemma (original language word).
 * Case-insensitive substring match against both fields.
 * Returns all matching entries across Hebrew and Greek.
 *
 * This is a full table scan (~8K+ rows) - suitable for interactive search with
 * debouncing but not for high-frequency programmatic use.
 */
export async function searchLexicon(query: string): Promise<LexiconEntry[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    return db.lexicon
        .filter(entry =>
            entry.gloss.toLowerCase().includes(q) ||
            entry.lemma.toLowerCase().includes(q) ||
            entry.transliteration.toLowerCase().includes(q) ||
            entry.strongsNumber.toLowerCase() === q
        )
        .toArray();
}

/**
 * Normalize a query that looks like a Strong's number to its canonical ID
 * ("h7225" → "H7225"), or return null when the query isn't one.
 * Leading zeros are stripped: sources write both G0026 and G26.
 */
export function parseStrongsQuery(query: string): string | null {
    const m = query.trim().match(/^([HGhg])0*(\d{1,5})$/);
    if (!m) return null;
    return `${m[1].toUpperCase()}${m[2]}`;
}

/**
 * Strong's-number concordance search - finds every verse in a translation
 * whose lemma tokens include the given Strong's ID, in canonical order.
 *
 * Only translations imported from morphologically tagged sources carry
 * VerseRecord.lemmas (Translation.strongs is true for them); an untagged
 * translation simply yields no results. Like wordSearch this is a full
 * scan of the translation's verses, so it's suited to interactive use,
 * not tight loops.
 */
export async function strongsSearch(
    translationId: string,
    strongsId: string
): Promise<ConcordanceSearchResult[]> {
    const id = parseStrongsQuery(strongsId);
    if (!id) return [];

    const allVerses = await db.verses
        .where('translationId')
        .equals(translationId)
        .toArray();

    const results: ConcordanceSearchResult[] = [];
    for (const verse of allVerses) {
        if (!verse.lemmas) continue;
        let count = 0;
        for (const token of verse.lemmas.split(' ')) {
            if (token === id) count++;
        }
        if (count === 0) continue;
        // Lemma tokens are verse-level (no word alignment yet), so there is
        // no English surface form to report; the ID itself stands in.
        results.push({
            verse,
            matches: [{ surface: id, count }],
            hitCount: count,
        });
    }
    return results;
}

/**
 * Get all lexicon entries whose Strong's numbers appear in a given verse.
 * Returns an empty array for verses of untagged translations.
 */
export async function getStrongsForVerse(
    translationId: string,
    osisId: string
): Promise<LexiconEntry[]> {
    const verse = await getVerse(translationId, osisId);
    if (!verse?.lemmas) return [];
    const ids = [...new Set(verse.lemmas.split(' ').filter(Boolean))];
    const entries = await db.lexicon.bulkGet(ids);
    return entries.filter((e): e is LexiconEntry => Boolean(e));
}

/** Check if genealogy relationships have been seeded. */
export async function isRelationshipsSeeded(): Promise<boolean> {
    return (await db.relationships.count()) > 0;
}

/**
 * Get all immediate relationships for a given person.
 * Used for BFS expansion in the genealogy engine.
 */
export async function getRelationshipsForPerson(personId: string): Promise<Relationship[]> {
    const [from, to] = await Promise.all([
        db.relationships.where('personFrom').equals(personId).toArray(),
        db.relationships.where('personTo').equals(personId).toArray(),
    ]);

    // Deduplicate by ID
    const seen = new Set<string>();
    const result: Relationship[] = [];
    for (const rel of [...from, ...to]) {
        if (!seen.has(rel.id)) {
            seen.add(rel.id);
            result.push(rel);
        }
    }
    return result;
}
