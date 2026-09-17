import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import type { Topic } from '@codex-scriptura/core';
import { db } from './database';
import { searchTopics, getTopicById, clearTopicIndexCache } from './topics';

describe('topical index (issue #28)', () => {
    beforeAll(async () => {
        const topic = (id: string, name: string, refCount: number): Topic => ({
            id, name, refCount,
            sections: [{ heading: 'GENERAL', entries: [{ label: '', refs: [{ osis: 'Gen.1.1', label: 'Ge 1:1' }] }], seeAlso: [] }],
            seeAlso: [],
        });
        await db.topics.bulkPut([
            topic('faith', 'Faith', 300),
            topic('faithfulness', 'Faithfulness', 60),
            topic('unfaithfulness', 'Unfaithfulness', 20),
            topic('shield-of-faith', 'Shield Of Faith', 5),
            topic('forgiveness', 'Forgiveness', 46),
        ]);
        clearTopicIndexCache();
    });

    it('ranks exact > prefix > word-boundary > substring', async () => {
        const results = await searchTopics('faith');
        expect(results.map((t) => t.id)).toEqual([
            'faith',            // exact
            'faithfulness',     // prefix
            'shield-of-faith',  // word boundary
            'unfaithfulness',   // substring
        ]);
    });

    it('breaks ties by reference count', async () => {
        const results = await searchTopics('f');
        const prefixed = results.filter((t) => t.name.toLowerCase().startsWith('f'));
        expect(prefixed[0].id).toBe('faith'); // 300 refs beats the others
    });

    it('returns the full record via getTopicById', async () => {
        const topic = await getTopicById('forgiveness');
        expect(topic?.name).toBe('Forgiveness');
        expect(topic?.sections[0].entries[0].refs[0].osis).toBe('Gen.1.1');
    });

    it('returns nothing for a blank query', async () => {
        expect(await searchTopics('   ')).toEqual([]);
    });
});
