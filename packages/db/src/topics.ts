import type { Topic } from '@codex-scriptura/core';
import { db } from './database.js';

// ─── Topical Index (Nave's, issue #28) ─────────────────────

/** Full topic record - sections with refs, see-also slugs. */
export async function getTopicById(id: string): Promise<Topic | undefined> {
    return db.topics.get(id);
}

export type TopicSummary = { id: string; name: string; refCount: number };

/**
 * In-memory name index for topic search. Topic records carry their full
 * outline (~4 MB across ~5,300 topics), so matching against live Dexie
 * reads per keystroke would deserialize all of it every time; the static
 * dataset never changes within a session, so one lazy load is enough.
 */
let _topicIndex: TopicSummary[] | null = null;

async function topicIndex(): Promise<TopicSummary[]> {
    if (_topicIndex) return _topicIndex;
    const index = (await db.topics.toArray()).map(({ id, name, refCount }) => ({ id, name, refCount }));
    // An empty table is not worth remembering: the dataset may still be
    // streaming in behind a live reader (issue #244).
    if (index.length > 0) _topicIndex = index;
    return index;
}

/** Drop the cached topic name index: after the dataset installs, and in tests. */
export function clearTopicIndexCache(): void {
    _topicIndex = null;
}

/**
 * Rank topics for a query: exact name match, then name prefix, then
 * word-boundary match, then substring - ties broken by reference count
 * so weighty topics ("Faith", 500 refs) beat obscure ones.
 */
export async function searchTopics(query: string, limit = 25): Promise<TopicSummary[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const scored: { topic: TopicSummary; rank: number }[] = [];
    for (const topic of await topicIndex()) {
        const name = topic.name.toLowerCase();
        let rank: number;
        if (name === q) rank = 0;
        else if (name.startsWith(q)) rank = 1;
        else if (name.includes(` ${q}`) || name.includes(`-${q}`) || name.includes(`(${q}`)) rank = 2;
        else if (name.includes(q)) rank = 3;
        else continue;
        scored.push({ topic, rank });
    }
    return scored
        .sort((a, b) => a.rank - b.rank || b.topic.refCount - a.topic.refCount || a.topic.name.localeCompare(b.topic.name))
        .slice(0, limit)
        .map((s) => s.topic);
}
