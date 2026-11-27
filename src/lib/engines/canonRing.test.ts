import { describe, it, expect } from 'vitest';
import {
    SECTIONS,
    layoutRing,
    adjacencyFromMatrix,
    buildEdges,
    bookTotals,
    rankByCrossReferences,
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
        expect(nodeById.get('Gen')!.fill).toBe('var(--cat-ot)');
        expect(nodeById.get('Matt')!.fill).toBe('var(--cat-nt)');
    });

    it('builds 8 section arcs', () => {
        const { sections } = layoutRing();
        expect(sections).toHaveLength(8);
        expect(sections.map((s) => s.name)).toContain('General & Rev.');
    });
});

type Matrix = Map<string, Map<string, number>>;
const matrixOf = (cells: [string, string, number][]): Matrix => {
    const m: Matrix = new Map();
    for (const [from, to, n] of cells) {
        if (!m.has(from)) m.set(from, new Map());
        m.get(from)!.set(to, n);
    }
    return m;
};

describe('edges', () => {
    // Gen-Matt has a cell in each direction; Ps-Rom sits under the old weight floor of 5.
    const adjacency = adjacencyFromMatrix(
        matrixOf([
            ['Matt', 'Gen', 30],
            ['Gen', 'Matt', 12],
            ['Exod', 'Gen', 7],
            ['Rom', 'Ps', 4],
        ]),
    );

    it('bows edges toward the center as quadratic béziers', () => {
        const edges = buildEdges(layoutRing(), adjacency);
        expect(edges).toHaveLength(3);
        for (const e of edges) {
            expect(e.d).toMatch(/^M [\d.]+ [\d.]+ Q [\d.]+ [\d.]+ [\d.]+ [\d.]+$/);
        }
        // de-duped: no reversed duplicates
        const keys = edges.map((e) => (e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`));
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('flags cross-testament edges', () => {
        const edges = buildEdges(layoutRing(), adjacency);
        const flagged = edges.filter((e) => e.crossTestament).map((e) => [e.a, e.b].sort().join('|')).sort();
        expect(flagged).toEqual(['Gen|Matt', 'Ps|Rom']);
    });

    it('folds a directional matrix into a symmetric adjacency, keeping weak pairs', () => {
        expect(adjacency.get('Gen')?.get('Matt')).toBe(42);
        expect(adjacency.get('Matt')?.get('Gen')).toBe(42);
        expect(adjacency.get('Ps')?.get('Rom')).toBe(4);
        expect(adjacency.get('Gen')?.size).toBe(2);
    });

    it('leaves within-book cells out of the adjacency', () => {
        const adj = adjacencyFromMatrix(matrixOf([['Ps', 'Ps', 9], ['Ps', 'Isa', 2]]));
        expect(adj.get('Ps')?.has('Ps')).toBe(false);
        expect(adj.get('Ps')?.get('Isa')).toBe(2);
    });
});

describe('book totals and ranking', () => {
    it('matches a hand count for a small matrix', () => {
        const totals = bookTotals(
            matrixOf([
                ['Matt', 'Gen', 30],
                ['Gen', 'Matt', 12],
                ['Exod', 'Gen', 7],
                ['Gen', 'Gen', 5],
                ['Rom', 'Ps', 4],
            ]),
        );
        expect(totals.get('Gen')).toEqual({ between: 49, within: 5, books: 2 });
        expect(totals.get('Matt')).toEqual({ between: 42, within: 0, books: 1 });
        expect(totals.get('Exod')).toEqual({ between: 7, within: 0, books: 1 });
        expect(totals.get('Ps')).toEqual({ between: 4, within: 0, books: 1 });
        expect(totals.get('Rom')).toEqual({ between: 4, within: 0, books: 1 });
    });

    it('sums A to B and B to A cells once each, counting the pair as one book', () => {
        const totals = bookTotals(matrixOf([['Isa', 'Matt', 10], ['Matt', 'Isa', 3]]));
        expect(totals.get('Isa')).toEqual({ between: 13, within: 0, books: 1 });
        expect(totals.get('Matt')).toEqual({ between: 13, within: 0, books: 1 });
        // every cross-book reference lands on exactly two books
        const sum = [...totals.values()].reduce((n, t) => n + t.between, 0);
        expect(sum).toBe(2 * 13);
    });

    it('keeps within-book references out of between', () => {
        const totals = bookTotals(matrixOf([['Ps', 'Ps', 100], ['Ps', 'Isa', 1], ['Matt', 'Gen', 2]]));
        expect(totals.get('Ps')).toEqual({ between: 1, within: 100, books: 1 });
        // Psalms would lead if its 100 within-book references counted
        expect(rankByCrossReferences(totals)).toEqual(['Gen', 'Matt', 'Ps', 'Isa']);
    });

    it('ranks by cross-references to other books, most first', () => {
        const totals = bookTotals(
            matrixOf([
                ['Matt', 'Isa', 50],
                ['Acts', 'Ps', 20],
                ['Ps', 'Gen', 15],
            ]),
        );
        // Isa 50, Matt 50, Ps 35, Acts 20, Gen 15
        expect(rankByCrossReferences(totals)).toEqual(['Isa', 'Matt', 'Ps', 'Acts', 'Gen']);
    });

    it('breaks ties in canonical order, not alphabetically', () => {
        const totals = bookTotals(matrixOf([['Rev', 'Gen', 5], ['Jude', 'Exod', 5]]));
        expect(rankByCrossReferences(totals)).toEqual(['Gen', 'Exod', 'Jude', 'Rev']);
    });

    it('gives an empty ranking and adjacency for an empty matrix', () => {
        const empty: Matrix = new Map();
        expect(rankByCrossReferences(bookTotals(empty))).toEqual([]);
        expect(adjacencyFromMatrix(empty).size).toBe(0);
    });
});
