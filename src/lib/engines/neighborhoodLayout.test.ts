import { describe, it, expect } from 'vitest';
import { layoutNeighborhood, bfsDepths, nodeFill, NEIGHBORHOOD_VIEW, VERSE_OT_COLOR, VERSE_NT_COLOR, PERSON_COLOR } from './neighborhoodLayout';
import type { GraphNode, GraphEdge } from '@codex-scriptura/core';

function verse(osis: string): GraphNode {
    return { id: `verse:${osis}`, type: 'verse', label: osis.replace('.', ' ').replace('.', ':') };
}
function person(id: string, name: string): GraphNode {
    return { id: `person:${id}`, type: 'person', label: name };
}
function edge(source: string, target: string, category: GraphEdge['category'] = 'cross-reference'): GraphEdge {
    return { id: `${source}→${target}`, source, target, category, type: 'unclassified', weight: 1 };
}

const SEED = 'verse:Gen.1.1';

describe('bfsDepths', () => {
    it('assigns hop distance from the seed over undirected edges', () => {
        const nodes = [verse('Gen.1.1'), verse('John.1.1'), verse('Col.1.16'), person('word_1', 'The Word')];
        const edges = [
            edge(SEED, 'verse:John.1.1'),
            edge('verse:John.1.1', 'verse:Col.1.16'),
            edge('verse:John.1.1', 'person:word_1', 'entity-mention'),
        ];
        const depths = bfsDepths(SEED, nodes, edges);
        expect(depths.get(SEED)).toBe(0);
        expect(depths.get('verse:John.1.1')).toBe(1);
        expect(depths.get('verse:Col.1.16')).toBe(2);
        expect(depths.get('person:word_1')).toBe(2);
    });
});

describe('layoutNeighborhood', () => {
    const nodes = [verse('Gen.1.1'), verse('John.1.1'), verse('Ps.19.1'), person('david_1', 'David')];
    const edges = [
        edge(SEED, 'verse:John.1.1'),
        edge(SEED, 'verse:Ps.19.1'),
        edge('verse:Ps.19.1', 'person:david_1', 'entity-mention'),
    ];

    it('centers the seed and places every node and edge', () => {
        const layout = layoutNeighborhood(SEED, nodes, edges);
        expect(layout.nodes).toHaveLength(nodes.length);
        expect(layout.edges).toHaveLength(edges.length);
        const seed = layout.nodes.find((p) => p.node.id === SEED)!;
        expect(seed.x).toBe(NEIGHBORHOOD_VIEW.w / 2);
        expect(seed.y).toBe(NEIGHBORHOOD_VIEW.h / 2);
        expect(seed.depth).toBe(0);
    });

    it('places deeper rings farther from the center and inside the viewBox', () => {
        const layout = layoutNeighborhood(SEED, nodes, edges);
        const cx = NEIGHBORHOOD_VIEW.w / 2;
        const cy = NEIGHBORHOOD_VIEW.h / 2;
        const dist = (p: { x: number; y: number }) => Math.hypot(p.x - cx, p.y - cy);
        for (const p of layout.nodes) {
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.x).toBeLessThanOrEqual(NEIGHBORHOOD_VIEW.w);
            if (p.depth === 2) {
                const ringOne = layout.nodes.find((q) => q.depth === 1)!;
                expect(dist(p)).toBeGreaterThan(dist(ringOne));
            }
        }
    });

    it('is deterministic for the same input', () => {
        const a = layoutNeighborhood(SEED, nodes, edges);
        const b = layoutNeighborhood(SEED, [...nodes], [...edges]);
        expect(a).toEqual(b);
    });

    it('always labels entities and the seed', () => {
        const many = [verse('Gen.1.1'), person('moses_1', 'Moses'), ...Array.from({ length: 50 }, (_, i) => verse(`Ps.119.${i + 1}`))];
        const manyEdges = [
            edge(SEED, 'person:moses_1', 'entity-mention'),
            ...Array.from({ length: 50 }, (_, i) => edge(SEED, `verse:Ps.119.${i + 1}`)),
        ];
        const layout = layoutNeighborhood(SEED, many, manyEdges);
        const seed = layout.nodes.find((p) => p.node.id === SEED)!;
        const moses = layout.nodes.find((p) => p.node.id === 'person:moses_1')!;
        const denseVerse = layout.nodes.find((p) => p.node.id === 'verse:Ps.119.1')!;
        expect(seed.showLabel).toBe(true);
        expect(moses.showLabel).toBe(true);
        // 50 verses on one ring is past the density cap - labels hidden
        expect(denseVerse.showLabel).toBe(false);
    });
});

describe('nodeFill', () => {
    it('colors verses by testament and entities by type', () => {
        expect(nodeFill(verse('Gen.1.1'))).toBe(VERSE_OT_COLOR);
        expect(nodeFill(verse('John.1.1'))).toBe(VERSE_NT_COLOR);
        expect(nodeFill(person('moses_1', 'Moses'))).toBe(PERSON_COLOR);
    });
});
