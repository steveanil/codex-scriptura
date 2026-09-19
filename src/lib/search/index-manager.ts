/**
 * The one owner of full-text indexes (issue #164). Components ask for a
 * translation's index and never construct MiniSearch or touch the
 * `searchIndexes` table themselves.
 */

import MiniSearch from 'minisearch';
import { translationDatasetId } from '@codex-scriptura/core';
import type { VerseRecord } from '@codex-scriptura/core';
import { db, clearCachedSearchIndexes, getCachedSearchIndex, getInstalledDataset, saveCachedSearchIndex } from '@codex-scriptura/db';
import { INDEX_CONFIG_KEY, INDEX_OPTIONS } from './config';

export type SearchIndex = MiniSearch<VerseRecord>;

const held = new Map<string, { key: string; index: Promise<SearchIndex> }>();

/**
 * What an index of this translation must have been built from: the
 * installed dataset's identity plus the index configuration. A corpus
 * refresh or a config change yields a new key, so the old index is
 * rebuilt without a schema migration. Null when nothing is installed.
 */
async function currentKey(translationId: string): Promise<string | null> {
    const receipt = await getInstalledDataset(translationDatasetId(translationId));
    return receipt ? `${receipt.version}:${receipt.contentHash ?? ''}:${INDEX_CONFIG_KEY}` : null;
}

async function loadOrBuild(translationId: string, key: string | null): Promise<SearchIndex> {
    const id = `minisearch:${translationId}`;

    if (key) {
        const cached = await getCachedSearchIndex(id);
        if (cached?.key === key) {
            try {
                return MiniSearch.loadJSON<VerseRecord>(cached.serializedIndex, INDEX_OPTIONS);
            } catch {
                // corrupt cached index - rebuild below
            }
        }
    }

    const verses = await db.verses.where('translationId').equals(translationId).toArray();
    const index = new MiniSearch<VerseRecord>(INDEX_OPTIONS);
    index.addAll(verses);

    // Without a receipt there is no identity to check the copy against later
    if (key) {
        try {
            await saveCachedSearchIndex({
                id,
                translationId,
                serializedIndex: JSON.stringify(index),
                key,
                createdAt: Date.now(),
            });
        } catch (err) {
            // Best-effort (quota, private mode); the in-memory index still works this session
            console.warn(`Could not cache search index for ${translationId}`, err);
        }
    }
    return index;
}

/**
 * The translation's index: the one in memory when it is still current,
 * else the cached copy, else a fresh build. Concurrent callers share one
 * load. A failed load is forgotten, so calling again retries.
 */
export async function getOrBuildIndex(translationId: string): Promise<SearchIndex> {
    const key = await currentKey(translationId);
    const existing = held.get(translationId);
    if (existing && existing.key === (key ?? '')) return existing.index;

    const index = loadOrBuild(translationId, key);
    held.set(translationId, { key: key ?? '', index });
    index.catch(() => {
        if (held.get(translationId)?.index === index) held.delete(translationId);
    });
    return index;
}

/** Free a translation's in-memory index, e.g. when it is deselected. The cached copy stays. */
export function releaseIndex(translationId: string): void {
    held.delete(translationId);
}

/** Drop every index, cached and in memory; each rebuilds the next time it is asked for. */
export async function clearSearchIndexes(): Promise<void> {
    held.clear();
    await clearCachedSearchIndexes();
}

/** Which translations hold an index in memory right now. */
export function heldIndexes(): string[] {
    return [...held.keys()];
}
