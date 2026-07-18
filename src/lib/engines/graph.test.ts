import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@codex-scriptura/db';
import type { CrossReference, Person } from '@codex-scriptura/core';
import { getChapterConnections, getNeighborhood } from './graph';

function assertNoDanglingEdges(result: { nodes: { id: string }[]; edges: { source: string; target: string }[] }) {
    const nodeIds = new Set(result.nodes.map((n) => n.id));
    for (const edge of result.edges) {
        expect(nodeIds.has(edge.source)).toBe(true);
        expect(nodeIds.has(edge.target)).toBe(true);
    }
}

function ref(sourceVerse: string, targetVerse: string, type = 'unclassified', votes = 1): CrossReference {
    return {
        id: `${sourceVerse}→${targetVerse}`,
        sourceVerse,
        targetVerse,
        type: type as CrossReference['type'],
        votes,
    };
}

beforeEach(async () => {
    await Promise.all([
        db.crossReferences.clear(),
        db.persons.clear(),
        db.places.clear(),
        db.events.clear(),
    ]);
});

describe('getNeighborhood', () => {
    it('returns an empty result for non-verse starting nodes (Phase 3 contract)', async () => {
        const result = await getNeighborhood('person:moses_1', 1);
        expect(result).toEqual({ nodes: [], edges: [], truncated: false });
    });

    it('always includes the seed node, even with no data', async () => {
        const result = await getNeighborhood('verse:Gen.1.1', 1);
        expect(result.nodes.map((n) => n.id)).toEqual(['verse:Gen.1.1']);
        expect(result.edges).toEqual([]);
        expect(result.truncated).toBe(false);
    });

    it('expands 1-hop cross-references in both directions', async () => {
        await db.crossReferences.bulkPut([
            ref('Gen.1.1', 'John.1.1'),
            ref('Heb.11.3', 'Gen.1.1'), // inbound edge - Gen.1.1 is the target
        ]);

        const result = await getNeighborhood('verse:Gen.1.1', 1);
        const nodeIds = result.nodes.map((n) => n.id).sort();
        expect(nodeIds).toEqual(['verse:Gen.1.1', 'verse:Heb.11.3', 'verse:John.1.1']);
        expect(result.edges).toHaveLength(2);
        expect(result.truncated).toBe(false);
    });

    it('only reaches 2-hop neighbours when hops >= 2', async () => {
        await db.crossReferences.bulkPut([
            ref('Gen.1.1', 'John.1.1'),
            ref('John.1.1', 'Col.1.16'),
        ]);

        const oneHop = await getNeighborhood('verse:Gen.1.1', 1);
        expect(oneHop.nodes.map((n) => n.id)).not.toContain('verse:Col.1.16');

        const twoHop = await getNeighborhood('verse:Gen.1.1', 2);
        expect(twoHop.nodes.map((n) => n.id)).toContain('verse:Col.1.16');
    });

    it('treats entity nodes as terminal leaves - their other verses are never pulled in', async () => {
        await db.crossReferences.bulkPut([ref('Gen.1.1', 'John.1.1')]);
        await db.persons.put({
            id: 'word_1',
            name: 'The Word',
            verseRefs: ['John.1.1', 'Rev.19.13'],
        } as unknown as Person);

        const result = await getNeighborhood('verse:Gen.1.1', 3);
        const nodeIds = result.nodes.map((n) => n.id);

        expect(nodeIds).toContain('person:word_1');
        // The person is mentioned in Rev.19.13, but entities must not expand
        expect(nodeIds).not.toContain('verse:Rev.19.13');
    });

    it('enforces the node cap and flags truncation', async () => {
        const refs: CrossReference[] = [];
        for (let v = 1; v <= 20; v++) {
            refs.push(ref('Gen.1.1', `Ps.19.${v}`));
        }
        await db.crossReferences.bulkPut(refs);

        const result = await getNeighborhood('verse:Gen.1.1', 1, { maxNodes: 5 });
        expect(result.nodes.length).toBeLessThanOrEqual(5);
        expect(result.truncated).toBe(true);
    });

    it('never returns edges pointing at nodes outside the node set (dangling-edge regression)', async () => {
        const refs: CrossReference[] = [];
        for (let v = 1; v <= 20; v++) {
            refs.push(ref('Gen.1.1', `Ps.19.${v}`));
        }
        await db.crossReferences.bulkPut(refs);
        await db.persons.put({
            id: 'david_1',
            name: 'David',
            verseRefs: ['Ps.19.1'],
        } as unknown as Person);

        // Case 1: node cap truncation must not leave dangling edges
        const capped = await getNeighborhood('verse:Gen.1.1', 1, { maxNodes: 5 });
        expect(capped.truncated).toBe(true);
        assertNoDanglingEdges(capped);

        // Case 2 (the actual pre-fix bug): a nodeTypes filter that excludes
        // verses used to emit cross-reference edges whose endpoint verse
        // nodes were never added to the node set.
        const entityOnly = await getNeighborhood('verse:Gen.1.1', 1, {
            nodeTypes: ['person', 'place', 'event'],
        });
        assertNoDanglingEdges(entityOnly);
    });

    it('applies the edgeTypes filter at query level', async () => {
        await db.crossReferences.bulkPut([
            ref('Matt.4.4', 'Deut.8.3', 'quotation'),
            ref('Matt.4.4', 'Luke.4.4', 'parallel'),
        ]);

        const result = await getNeighborhood('verse:Matt.4.4', 1, { edgeTypes: ['quotation'] });
        expect(result.edges).toHaveLength(1);
        expect(result.edges[0].type).toBe('quotation');
        expect(result.nodes.map((n) => n.id)).not.toContain('verse:Luke.4.4');
    });
});

describe('getChapterConnections', () => {
    it('aggregates cross-book links to book-level neighbors, counting both directions', async () => {
        await db.crossReferences.bulkPut([
            ref('Gen.1.1', 'John.1.1'),   // outbound from Gen 1
            ref('Gen.1.26', 'John.1.3'),  // outbound from Gen 1
            ref('Heb.11.3', 'Gen.1.1'),   // inbound to Gen 1
            ref('Gen.12.1', 'Acts.7.3'),  // outbound from Gen 12
        ]);

        const conns = await getChapterConnections('Gen');

        expect(conns.get(1)?.get('book:John')).toBe(2);
        expect(conns.get(1)?.get('book:Heb')).toBe(1);
        expect(conns.get(12)?.get('book:Acts')).toBe(1);
        expect(conns.get(2)).toBeUndefined();
    });

    it('keeps same-book links at chapter granularity, visible from both chapters', async () => {
        await db.crossReferences.bulkPut([
            ref('Ps.14.1', 'Ps.53.1'), // the classic duplicated psalm
        ]);

        const conns = await getChapterConnections('Ps');
        expect(conns.get(14)?.get('chapter:Ps.53')).toBe(1);
        expect(conns.get(53)?.get('chapter:Ps.14')).toBe(1);
    });

    it('ignores intra-chapter links and never double-counts same-book refs', async () => {
        await db.crossReferences.bulkPut([
            ref('Gen.1.1', 'Gen.1.26'), // same chapter - invisible at this zoom
            ref('Gen.1.1', 'Gen.2.4'),  // same book, different chapters
        ]);

        const conns = await getChapterConnections('Gen');
        expect(conns.get(1)?.get('chapter:Gen.1')).toBeUndefined();
        expect(conns.get(1)?.get('chapter:Gen.2')).toBe(1);
        expect(conns.get(2)?.get('chapter:Gen.1')).toBe(1);
    });

    it('does not confuse books whose names share a prefix', async () => {
        await db.crossReferences.bulkPut([
            ref('Jonah.1.1', 'Matt.12.40'),
        ]);

        const conns = await getChapterConnections('John');
        expect(conns.size).toBe(0);
    });
});
