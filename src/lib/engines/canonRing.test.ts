import { describe, it, expect } from 'vitest';
import {
    SECTIONS,
    layoutRing,
    seededAdjacency,
    adjacencyFromMatrix,
    buildEdges,
    degrees,
} from './canonRing';

describe('canonical ring layout', () => {
    it('places all 66 canonical books', () => {
        const { nodes } = layoutRing();
        expect(nodes).toHaveLength(66);
        expect(SECTIONS.reduce((n, s) => n + s.bookIds.length, 0)).toBe(66);
    });

    it('starts at the top and proceeds clockwise (Gen first, Rev last)', () => {
        const { nodes } = layoutRing();
        expect(nodes[0].id).toBe('Gen');
        expect(nodes[65].id).toBe('Rev');
        // Genesis sits near 12 o'clock: x ≈ center, y above center
        expect(nodes[0].y).toBeLessThan(402 - 200);
    });

    it('scales node radius with chapter count', () => {
        const { nodeById } = layoutRing();
        const ps = nodeById.get('Ps')!;
        const obad = nodeById.get('Obad')!;
        expect(ps.r).toBeCloseTo(6 + Math.sqrt(150) * 1.5, 5);
        expect(obad.r).toBeCloseTo(7.5, 5);
    });

    it('colors nodes by testament', () => {
        const { nodeById } = layoutRing();
        expect(nodeById.get('Gen')!.fill).toBe('#e0891d');
        expect(nodeById.get('Matt')!.fill).toBe('#6d6cf0');
    });

    it('builds 8 section arcs', () => {
        const { sections } = layoutRing();
        expect(sections).toHaveLength(8);
        expect(sections.map((s) => s.name)).toContain('General & Rev.');
    });
});

describe('edges', () => {
    it('seeded generator is deterministic', () => {
        const a = seededAdjacency();
        const b = seededAdjacency();
        expect([...a.get('Gen')!.entries()]).toEqual([...b.get('Gen')!.entries()]);
    });

    it('seeded adjacency is symmetric', () => {
        const adj = seededAdjacency();
        for (const [x, row] of adj) {
            for (const [y, w] of row) {
                expect(adj.get(y)?.get(x)).toBe(w);
            }
        }
    });

    it('bows edges toward the center as quadratic béziers', () => {
        const layout = layoutRing();
        const edges = buildEdges(layout, seededAdjacency());
        expect(edges.length).toBeGreaterThan(50);
        for (const e of edges.slice(0, 5)) {
            expect(e.d).toMatch(/^M [\d.]+ [\d.]+ Q [\d.]+ [\d.]+ [\d.]+ [\d.]+$/);
        }
        // de-duped: no reversed duplicates
        const keys = edges.map((e) => (e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`));
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('flags cross-testament edges', () => {
        const layout = layoutRing();
        const edges = buildEdges(layout, seededAdjacency());
        const cross = edges.find((e) => e.crossTestament);
        expect(cross).toBeDefined();
    });

    it('folds a directional matrix into symmetric adjacency with a weight floor', () => {
        const matrix = new Map([
            ['Gen', new Map([['Matt', 30], ['Obad', 1]])],
            ['Matt', new Map([['Gen', 12]])],
        ]);
        const adj = adjacencyFromMatrix(matrix, 5);
        expect(adj.get('Gen')?.get('Matt')).toBe(42);
        expect(adj.get('Matt')?.get('Gen')).toBe(42);
        expect(adj.get('Gen')?.has('Obad')).toBe(false);
        expect(degrees(adj).get('Gen')).toBe(1);
    });
});
