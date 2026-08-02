/**
 * Deterministic concentric layout for neighborhood subgraphs (issue #21).
 *
 * The seed sits at the center; nodes at BFS depth d sit on ring d. Within a
 * ring, verses come first in canonical order (book, chapter, verse), then
 * persons, places, and events alphabetically; rings past the first are then
 * re-ordered by the mean angle of their parents to reduce edge crossings.
 * Pure geometry - no DOM, no DB - so it is unit-testable.
 */

import { BOOKS, findBook } from '@codex-scriptura/core';
import type { GraphNode, GraphEdge } from '@codex-scriptura/core';

export const NEIGHBORHOOD_VIEW = { w: 940, h: 810 } as const;

// Shared palette: verse nodes reuse the canon ring testament colors,
// entity nodes reuse the reader's entity-mark colors (app.css).
export const VERSE_OT_COLOR = '#e0891d';
export const VERSE_NT_COLOR = '#6d6cf0';
export const PERSON_COLOR = '#378ADD';
export const PLACE_COLOR = '#1D9E75';
export const EVENT_COLOR = '#EF9F27';

export type PlacedNode = {
    node: GraphNode;
    depth: number;
    x: number;
    y: number;
    r: number;
    fill: string;
    /** Label placement, mirroring the ring page conventions. */
    lx: number;
    ly: number;
    anchor: 'start' | 'middle' | 'end';
    /** Dense verse rings hide their labels; entities and the seed never do. */
    showLabel: boolean;
};

export type PlacedEdge = {
    edge: GraphEdge;
    /** SVG path between the two node centers. */
    d: string;
};

export type NeighborhoodLayout = {
    nodes: PlacedNode[];
    edges: PlacedEdge[];
    /** BFS depth per node ID - handy for consumers (e.g. dimming by ring). */
    depths: Map<string, number>;
};

const CX = NEIGHBORHOOD_VIEW.w / 2;
const CY = NEIGHBORHOOD_VIEW.h / 2;
const MAX_RADIUS = 330;
/** Verse rings denser than this hide their verse labels. */
const LABEL_DENSITY_CAP = 36;

const bookOrder = new Map(BOOKS.map((b, i) => [b.osisId, i]));

/** Canonical sort key: verses by book/chapter/verse, then entities by type then name. */
function ringSortKey(node: GraphNode): [number, number, number, number, string] {
    if (node.type === 'verse') {
        const parts = node.id.slice('verse:'.length).split('.');
        return [0, bookOrder.get(parts[0]) ?? 999, parseInt(parts[1], 10) || 0, parseInt(parts[2], 10) || 0, ''];
    }
    const typeRank = node.type === 'person' ? 1 : node.type === 'place' ? 2 : 3;
    return [typeRank, 0, 0, 0, node.label];
}

function compareKeys(a: ReturnType<typeof ringSortKey>, b: ReturnType<typeof ringSortKey>): number {
    for (let i = 0; i < a.length; i++) {
        if (a[i] < b[i]) return -1;
        if (a[i] > b[i]) return 1;
    }
    return 0;
}

export function nodeFill(node: GraphNode): string {
    switch (node.type) {
        case 'person': return PERSON_COLOR;
        case 'place': return PLACE_COLOR;
        case 'event': return EVENT_COLOR;
        default: {
            const book = node.id.slice('verse:'.length).split('.')[0];
            return findBook(book)?.testament === 'NT' ? VERSE_NT_COLOR : VERSE_OT_COLOR;
        }
    }
}

/** BFS depths from the seed over the (undirected) edge set. */
export function bfsDepths(seedId: string, nodes: GraphNode[], edges: GraphEdge[]): Map<string, number> {
    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
        (adjacency.get(e.source) ?? adjacency.set(e.source, []).get(e.source)!).push(e.target);
        (adjacency.get(e.target) ?? adjacency.set(e.target, []).get(e.target)!).push(e.source);
    }
    const depths = new Map<string, number>([[seedId, 0]]);
    let frontier = [seedId];
    while (frontier.length > 0) {
        const next: string[] = [];
        for (const id of frontier) {
            const d = depths.get(id)!;
            for (const n of adjacency.get(id) ?? []) {
                if (!depths.has(n)) {
                    depths.set(n, d + 1);
                    next.push(n);
                }
            }
        }
        frontier = next;
    }
    // The engine returns connected results, but guard anyway: anything
    // unreachable goes on the outermost ring instead of vanishing.
    const maxDepth = Math.max(1, ...depths.values());
    for (const node of nodes) {
        if (!depths.has(node.id)) depths.set(node.id, maxDepth);
    }
    return depths;
}

export function layoutNeighborhood(
    seedId: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
): NeighborhoodLayout {
    const depths = bfsDepths(seedId, nodes, edges);
    const maxDepth = Math.max(1, ...depths.values());

    // Group nodes per ring
    const rings = new Map<number, GraphNode[]>();
    for (const node of nodes) {
        const d = depths.get(node.id)!;
        if (d === 0) continue;
        (rings.get(d) ?? rings.set(d, []).get(d)!).push(node);
    }

    const ringRadius = (d: number) =>
        maxDepth === 1 ? 250 : (d / maxDepth) * MAX_RADIUS;

    const positioned = new Map<string, PlacedNode>();

    // Seed at the center
    const seed = nodes.find((n) => n.id === seedId);
    if (seed) {
        positioned.set(seedId, {
            node: seed,
            depth: 0,
            x: CX,
            y: CY,
            r: 15,
            fill: nodeFill(seed),
            lx: CX,
            ly: CY + 32,
            anchor: 'middle',
            showLabel: true,
        });
    }

    const angleOf = new Map<string, number>();

    for (let d = 1; d <= maxDepth; d++) {
        const ring = rings.get(d) ?? [];
        if (ring.length === 0) continue;

        ring.sort((a, b) => compareKeys(ringSortKey(a), ringSortKey(b)));

        // Rings past the first follow their parents' angles (barycenter
        // pass) so edges point outward instead of criss-crossing.
        if (d > 1) {
            const parentAngle = new Map<string, number>();
            const adjacency = new Map<string, string[]>();
            for (const e of edges) {
                (adjacency.get(e.source) ?? adjacency.set(e.source, []).get(e.source)!).push(e.target);
                (adjacency.get(e.target) ?? adjacency.set(e.target, []).get(e.target)!).push(e.source);
            }
            for (const node of ring) {
                const parents = (adjacency.get(node.id) ?? []).filter((n) => (depths.get(n) ?? 99) === d - 1);
                const angles = parents.map((p) => angleOf.get(p)).filter((a): a is number => a !== undefined);
                if (angles.length > 0) {
                    parentAngle.set(node.id, angles.reduce((s, a) => s + a, 0) / angles.length);
                }
            }
            ring.sort((a, b) => {
                const pa = parentAngle.get(a.id);
                const pb = parentAngle.get(b.id);
                if (pa !== undefined && pb !== undefined && pa !== pb) return pa - pb;
                if (pa !== undefined && pb === undefined) return -1;
                if (pa === undefined && pb !== undefined) return 1;
                return compareKeys(ringSortKey(a), ringSortKey(b));
            });
        }

        const radius = ringRadius(d);
        const verseLabelsVisible = ring.filter((n) => n.type === 'verse').length <= LABEL_DENSITY_CAP;

        ring.forEach((node, i) => {
            // Start at 12 o'clock, clockwise; slight offset keeps a
            // single-node ring from overlapping the seed label.
            const angle = -Math.PI / 2 + (2 * Math.PI * i) / ring.length;
            angleOf.set(node.id, angle);
            const x = CX + radius * Math.cos(angle);
            const y = CY + radius * Math.sin(angle);
            const isEntity = node.type !== 'verse';
            const anchor: PlacedNode['anchor'] =
                Math.cos(angle) > 0.25 ? 'start' : Math.cos(angle) < -0.25 ? 'end' : 'middle';
            const labelGap = isEntity ? 14 : 11;
            positioned.set(node.id, {
                node,
                depth: d,
                x,
                y,
                r: isEntity ? 9 : 6.5,
                fill: nodeFill(node),
                lx: x + (anchor === 'start' ? labelGap : anchor === 'end' ? -labelGap : 0),
                ly: y + (anchor === 'middle' ? (Math.sin(angle) > 0 ? labelGap + 8 : -labelGap) : 4),
                anchor,
                showLabel: isEntity || verseLabelsVisible,
            });
        });
    }

    const placedEdges: PlacedEdge[] = [];
    for (const edge of edges) {
        const a = positioned.get(edge.source);
        const b = positioned.get(edge.target);
        if (!a || !b) continue;
        // Same-ring edges bow toward the center so they don't cut through
        // neighbouring nodes; radial edges stay straight.
        if (a.depth === b.depth && a.depth > 0) {
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            const qx = mx + (CX - mx) * 0.35;
            const qy = my + (CY - my) * 0.35;
            placedEdges.push({ edge, d: `M ${a.x} ${a.y} Q ${qx} ${qy} ${b.x} ${b.y}` });
        } else {
            placedEdges.push({ edge, d: `M ${a.x} ${a.y} L ${b.x} ${b.y}` });
        }
    }

    return { nodes: [...positioned.values()], edges: placedEdges, depths };
}
