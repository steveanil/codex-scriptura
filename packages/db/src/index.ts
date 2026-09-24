/**
 * @codex-scriptura/db - public API.
 *
 * One Dexie database (`database.ts`), its schema and migrations
 * (`schema.ts`), and one module per domain. This file only re-exports;
 * the app imports everything from '@codex-scriptura/db'.
 */

export { db, CodexDB, type KvRecord } from './database.js';
export * from './verses.js';
export * from './translations.js';
export * from './preferences.js';
export * from './annotations.js';
export * from './saved-searches.js';
export * from './word-search.js';
export * from './entities.js';
export * from './search-indexes.js';
export * from './cross-references.js';
export * from './topics.js';
export * from './lexicon.js';
export * from './strongs.js';
export * from './relationships.js';
export * from './datasets.js';
export * from './aggregates.js';
export * from './resources.js';
