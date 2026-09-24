import Dexie, { type EntityTable, type Table } from 'dexie';
import type { VerseRecord, Translation, Annotation, Tag, UserPreferences, SavedSearch, Person, Place, BibleEvent, DictionaryEntry, CrossReference, LexiconEntry, Topic, SearchIndexCache, Relationship, InstalledDataset, AggregateRecord, StrongsPostingRecord, ResourceDescriptor, CommentaryEntry } from '@codex-scriptura/core';
import { defineSchema } from './schema.js';

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
    topics!: EntityTable<Topic, 'id'>;
    kv!: EntityTable<KvRecord, 'id'>;
    datasets!: EntityTable<InstalledDataset, 'id'>;
    aggregates!: EntityTable<AggregateRecord, 'id'>;
    strongsPostings!: Table<StrongsPostingRecord, [string, string]>;
    resources!: EntityTable<ResourceDescriptor, 'id'>;
    commentaryEntries!: Table<CommentaryEntry, [string, string]>;

    constructor() {
        super('codex-scriptura');
        defineSchema(this);
    }
}

/** The one authoritative instance. Domain modules import this; nothing else constructs a CodexDB. */
export const db = new CodexDB();
