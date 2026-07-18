/**
 * Canonical-ring layout for the Scripture Graph.
 *
 * Places all 66 canonical books on a single circle grouped into 8 sections
 * (Law → … → General & Rev.), with node radius scaled by chapter count and
 * cross-reference edges bowed through the center as quadratic Béziers.
 *
 * Edge weights come from the real cross-reference matrix (TSK et al. in
 * Dexie); when that data hasn't been seeded yet, a deterministic seeded
 * generator produces a stable stand-in graph.
 */

import { BOOKS, findBook } from '@codex-scriptura/core';
import type { BookMeta } from '@codex-scriptura/core';

// ─── Geometry constants (from the design: viewBox 940×810) ──

export const RING_VIEW = { w: 940, h: 810 } as const;
const CX = 470;
const CY = 402;
const R = 250;
const SECTION_GAP_DEG = 5.2;
const LABEL_OFFSET = 12;
const SECTION_LABEL_R = R + 66;

// ─── Canonical sections ─────────────────────────────────────

export type RingSection = {
    name: string;
    testament: 'OT' | 'NT';
    color: string;
    bookIds: string[];
};

export const SECTIONS: readonly RingSection[] = [
    { name: 'Law', testament: 'OT', color: '#e0a44a', bookIds: ['Gen', 'Exod', 'Lev', 'Num', 'Deut'] },
    { name: 'History', testament: 'OT', color: '#e0912e', bookIds: ['Josh', 'Judg', 'Ruth', '1Sam', '2Sam', '1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra', 'Neh', 'Esth'] },
    { name: 'Wisdom', testament: 'OT', color: '#e8b25c', bookIds: ['Job', 'Ps', 'Prov', 'Eccl', 'Song'] },
    { name: 'Major Prophets', testament: 'OT', color: '#d17d33', bookIds: ['Isa', 'Jer', 'Lam', 'Ezek', 'Dan'] },
    { name: 'Minor Prophets', testament: 'OT', color: '#d68f45', bookIds: ['Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal'] },
    { name: 'Gospels', testament: 'NT', color: '#7b79f2', bookIds: ['Matt', 'Mark', 'Luke', 'John', 'Acts'] },
    { name: 'Pauline', testament: 'NT', color: '#6d6cf0', bookIds: ['Rom', '1Cor', '2Cor', 'Gal', 'Eph', 'Phil', 'Col', '1Thess', '2Thess', '1Tim', '2Tim', 'Titus', 'Phlm'] },
    { name: 'General & Rev.', testament: 'NT', color: '#8f8ef4', bookIds: ['Heb', 'Jas', '1Pet', '2Pet', '1John', '2John', '3John', 'Jude', 'Rev'] },
];

export const OT_NODE_COLOR = '#e0891d';
export const NT_NODE_COLOR = '#6d6cf0';
export const EDGE_SAME_TESTAMENT = '#8f8ef6';
export const EDGE_CROSS_TESTAMENT = '#d99a4a';

// ─── Layout types ───────────────────────────────────────────

export type RingNode = {
    id: string; // OSIS book id
    label: string;
    name: string;
    section: string;
    testament: 'OT' | 'NT';
    chapters: number;
    r: number;
    x: number;
    y: number;
    /** label anchor point, just outside the node radially */
    lx: number;
    ly: number;
    anchor: 'start' | 'end' | 'middle';
    fill: string;
};

export type SectionArc = {
    name: string;
    color: string;
    d: string;
    lx: number;
    ly: number;
    anchor: 'start' | 'end' | 'middle';
};

export type RingEdge = {
    a: string;
    b: string;
    weight: number;
    crossTestament: boolean;
    d: string;
};

export type RingLayout = {
    nodes: RingNode[];
    nodeById: Map<string, RingNode>;
    sections: SectionArc[];
};

/** Symmetric book↔book adjacency with reference counts. */
export type Adjacency = Map<string, Map<string, number>>;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const anchorFor = (cos: number): 'start' | 'end' | 'middle' =>
    cos > 0.08 ? 'start' : cos < -0.08 ? 'end' : 'middle';

// ─── Ring layout ────────────────────────────────────────────

export function layoutRing(): RingLayout {
    const totalBooks = SECTIONS.reduce((n, s) => n + s.bookIds.length, 0);
    const usable = 360 - SECTION_GAP_DEG * SECTIONS.length;
    const per = usable / totalBooks;

    const nodes: RingNode[] = [];
    const sections: SectionArc[] = [];
    let ang = -90 + SECTION_GAP_DEG / 2;

    for (const sec of SECTIONS) {
        const a0 = ang;
        for (const id of sec.bookIds) {
            const meta: BookMeta | undefined = findBook(id);
            if (!meta) continue;
            const ca = ang + per / 2;
            const r = 6 + Math.sqrt(meta.chapters) * 1.5;
            const cos = Math.cos(toRad(ca));
            const sin = Math.sin(toRad(ca));
            const outward = R + r + LABEL_OFFSET;
            nodes.push({
                id: meta.osisId,
                label: meta.abbrev,
                name: meta.name,
                section: sec.name,
                testament: sec.testament,
                chapters: meta.chapters,
                r,
                x: CX + R * cos,
                y: CY + R * sin,
                lx: CX + outward * cos,
                ly: CY + outward * sin + 3.5,
                anchor: anchorFor(cos),
                fill: sec.testament === 'OT' ? OT_NODE_COLOR : NT_NODE_COLOR,
            });
            ang += per;
        }
        const a1 = ang; // end of this section's span
        const mid = (a0 + a1) / 2;
        const p0x = CX + R * Math.cos(toRad(a0));
        const p0y = CY + R * Math.sin(toRad(a0));
        const p1x = CX + R * Math.cos(toRad(a1));
        const p1y = CY + R * Math.sin(toRad(a1));
        const midCos = Math.cos(toRad(mid));
        sections.push({
            name: sec.name,
            color: sec.color,
            d: `M ${p0x.toFixed(1)} ${p0y.toFixed(1)} A ${R} ${R} 0 0 1 ${p1x.toFixed(1)} ${p1y.toFixed(1)}`,
            lx: CX + SECTION_LABEL_R * midCos,
            ly: CY + SECTION_LABEL_R * Math.sin(toRad(mid)) + 4,
            anchor: anchorFor(midCos),
        });
        ang += SECTION_GAP_DEG;
    }

    return { nodes, nodeById: new Map(nodes.map((n) => [n.id, n])), sections };
}

// ─── Edges ──────────────────────────────────────────────────

/**
 * Quadratic Bézier from a to b whose control point sits 32% of the way from
 * the chord midpoint toward the ring center, so links bow through the middle.
 */
function edgePath(a: RingNode, b: RingNode): string {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const cx = CX + (mx - CX) * 0.32;
    const cy = CY + (my - CY) * 0.32;
    return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

export function buildEdges(layout: RingLayout, adjacency: Adjacency): RingEdge[] {
    const edges: RingEdge[] = [];
    const seen = new Set<string>();
    for (const [aId, row] of adjacency) {
        const a = layout.nodeById.get(aId);
        if (!a) continue;
        for (const [bId, weight] of row) {
            const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const b = layout.nodeById.get(bId);
            if (!b) continue;
            edges.push({
                a: aId,
                b: bId,
                weight,
                crossTestament: a.testament !== b.testament,
                d: edgePath(a, b),
            });
        }
    }
    return edges;
}

/**
 * Fold a directional book-connection matrix into a symmetric adjacency map,
 * dropping weak pairs so the "show all" view stays readable.
 */
export function adjacencyFromMatrix(
    matrix: Map<string, Map<string, number>>,
    minWeight = 5,
): Adjacency {
    const combined = new Map<string, Map<string, number>>();
    const bump = (a: string, b: string, w: number) => {
        let row = combined.get(a);
        if (!row) combined.set(a, (row = new Map()));
        row.set(b, (row.get(b) ?? 0) + w);
    };
    for (const [src, targets] of matrix) {
        for (const [tgt, count] of targets) {
            if (src === tgt) continue;
            bump(src, tgt, count);
            bump(tgt, src, count);
        }
    }
    const adjacency: Adjacency = new Map();
    for (const [a, row] of combined) {
        const kept = new Map([...row].filter(([, w]) => w >= minWeight));
        if (kept.size > 0) adjacency.set(a, kept);
    }
    return adjacency;
}

// ─── Seeded fallback generator ──────────────────────────────

const HUBS = new Set(['Gen', 'Exod', 'Deut', 'Ps', 'Isa', 'Jer', 'Matt', 'Luke', 'John', 'Rom', 'Heb', 'Rev']);

/** mulberry32 - deterministic so the fallback graph is stable across renders */
function seededRng(seed: number): () => number {
    let s = seed | 0;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Stand-in adjacency used until real cross-reference data is seeded:
 * hub books get more links, link count scales with chapter count, and
 * weights (2–~40) skew higher for hubs.
 */
export function seededAdjacency(seed = 20260702): Adjacency {
    const rnd = seededRng(seed);
    const canon = SECTIONS.flatMap((s) => s.bookIds);
    const chaptersOf = new Map(canon.map((id) => [id, findBook(id)?.chapters ?? 1]));

    const weight = new Map(
        canon.map((id) => [id, HUBS.has(id) ? 10 : 1 + (chaptersOf.get(id) ?? 1) / 22]),
    );
    const wsum = [...weight.values()].reduce((a, b) => a + b, 0);
    const pick = (not: string): string => {
        let r = rnd() * wsum;
        for (const id of canon) {
            r -= weight.get(id)!;
            if (r <= 0 && id !== not) return id;
        }
        return canon[0];
    };

    const adjacency: Adjacency = new Map(canon.map((id) => [id, new Map()]));
    const seen = new Set<string>();
    for (const id of canon) {
        const ch = chaptersOf.get(id) ?? 1;
        const links = 2 + (HUBS.has(id) ? 4 : 0) + (ch > 30 ? 2 : ch > 12 ? 1 : 0);
        for (let k = 0; k < links; k++) {
            let tgt = pick(id);
            let tries = 0;
            while (tgt === id && tries++ < 6) tgt = pick(id);
            const key = id < tgt ? `${id}|${tgt}` : `${tgt}|${id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const w = 2 + Math.floor(rnd() * (HUBS.has(id) || HUBS.has(tgt) ? 38 : 16));
            adjacency.get(id)!.set(tgt, w);
            adjacency.get(tgt)!.set(id, w);
        }
    }
    return adjacency;
}

/** Degree (number of connected books) per book. */
export function degrees(adjacency: Adjacency): Map<string, number> {
    return new Map([...adjacency].map(([id, row]) => [id, row.size]));
}
