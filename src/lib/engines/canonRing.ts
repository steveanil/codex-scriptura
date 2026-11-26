/**
 * Canonical-ring layout for the Scripture Graph.
 *
 * Places all 66 canonical books on a single circle grouped into 8 sections
 * (Law → … → General & Rev.), with node radius scaled by chapter count and
 * cross-reference edges bowed through the center as quadratic Béziers.
 *
 * Edge weights and per-book totals come from the shipped book matrix
 * (cross-reference counts per book pair). With no matrix there are no edges
 * and no totals: nothing is drawn or counted that the data does not hold.
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
    { name: 'Law', testament: 'OT', color: 'var(--cat-ot-law)', bookIds: ['Gen', 'Exod', 'Lev', 'Num', 'Deut'] },
    { name: 'History', testament: 'OT', color: 'var(--cat-ot-history)', bookIds: ['Josh', 'Judg', 'Ruth', '1Sam', '2Sam', '1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra', 'Neh', 'Esth'] },
    { name: 'Wisdom', testament: 'OT', color: 'var(--cat-ot-wisdom)', bookIds: ['Job', 'Ps', 'Prov', 'Eccl', 'Song'] },
    { name: 'Major Prophets', testament: 'OT', color: 'var(--cat-ot-major)', bookIds: ['Isa', 'Jer', 'Lam', 'Ezek', 'Dan'] },
    { name: 'Minor Prophets', testament: 'OT', color: 'var(--cat-ot-minor)', bookIds: ['Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal'] },
    { name: 'Gospels', testament: 'NT', color: 'var(--cat-nt-gospels)', bookIds: ['Matt', 'Mark', 'Luke', 'John', 'Acts'] },
    { name: 'Pauline', testament: 'NT', color: 'var(--cat-nt-pauline)', bookIds: ['Rom', '1Cor', '2Cor', 'Gal', 'Eph', 'Phil', 'Col', '1Thess', '2Thess', '1Tim', '2Tim', 'Titus', 'Phlm'] },
    { name: 'General & Rev.', testament: 'NT', color: 'var(--cat-nt-general)', bookIds: ['Heb', 'Jas', '1Pet', '2Pet', '1John', '2John', '3John', 'Jude', 'Rev'] },
];

// Colours are categorical tokens from app.css (the --cat-* pool), emitted as
// var() strings so the same layout renders correctly in both themes.
export const OT_NODE_COLOR = 'var(--cat-ot)';
export const NT_NODE_COLOR = 'var(--cat-nt)';
export const EDGE_SAME_TESTAMENT = 'var(--cat-edge-same)';
export const EDGE_CROSS_TESTAMENT = 'var(--cat-edge-cross)';

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
 * Fold a directional book-connection matrix into a symmetric adjacency map.
 * The importer stores each verse pair once, so A->B and B->A cells are
 * different verse pairs and both add to the A-B weight.
 */
export function adjacencyFromMatrix(matrix: Map<string, Map<string, number>>): Adjacency {
    const adjacency: Adjacency = new Map();
    const bump = (a: string, b: string, w: number) => {
        let row = adjacency.get(a);
        if (!row) adjacency.set(a, (row = new Map()));
        row.set(b, (row.get(b) ?? 0) + w);
    };
    for (const [src, targets] of matrix) {
        for (const [tgt, count] of targets) {
            if (src === tgt) continue;
            bump(src, tgt, count);
            bump(tgt, src, count);
        }
    }
    return adjacency;
}

// ─── Per-book totals ────────────────────────────────────────

export type BookTotals = {
    /** cross-references whose other end is in a different book */
    between: number;
    /** cross-references with both ends in this book */
    within: number;
    /** distinct other books sharing at least one cross-reference */
    books: number;
};

/** Exact per-book counts, read straight from the directional matrix. */
export function bookTotals(matrix: Map<string, Map<string, number>>): Map<string, BookTotals> {
    const totals = new Map<string, BookTotals>();
    const partners = new Map<string, Set<string>>();
    const entry = (id: string) => {
        let t = totals.get(id);
        if (!t) {
            totals.set(id, (t = { between: 0, within: 0, books: 0 }));
            partners.set(id, new Set());
        }
        return t;
    };
    for (const [src, targets] of matrix) {
        for (const [tgt, count] of targets) {
            if (src === tgt) {
                entry(src).within += count;
                continue;
            }
            entry(src).between += count;
            entry(tgt).between += count;
            partners.get(src)!.add(tgt);
            partners.get(tgt)!.add(src);
        }
    }
    for (const [id, t] of totals) t.books = partners.get(id)!.size;
    return totals;
}

const CANON_INDEX = new Map(SECTIONS.flatMap((s) => s.bookIds).map((id, i) => [id, i]));

/** Book ids by cross-references to other books, most first; ties in canonical order. */
export function rankByCrossReferences(totals: Map<string, BookTotals>): string[] {
    const canon = (id: string) => CANON_INDEX.get(id) ?? Number.MAX_SAFE_INTEGER;
    return [...totals.keys()].sort(
        (a, b) =>
            totals.get(b)!.between - totals.get(a)!.between ||
            canon(a) - canon(b) ||
            (a < b ? -1 : a > b ? 1 : 0),
    );
}
