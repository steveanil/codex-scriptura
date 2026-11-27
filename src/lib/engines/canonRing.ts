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

// ─── Geometry constants ─────────────────────────────────────
// Lengths are SVG user units. The ring radius is not one of them: each book
// takes an arc equal to its node diameter plus NODE_GAP, each section adds
// SECTION_GAP, and the radius is whatever circle that total closes into.

/** Node radius = NODE_R_BASE + NODE_R_PER_SQRT_CHAPTER * sqrt(chapters). */
export const NODE_R_BASE = 3.5;
export const NODE_R_PER_SQRT_CHAPTER = 1.5;
export const NODE_GAP = 6;
export const SECTION_GAP = 26;

/** Book labels read outward along their spoke, starting LABEL_OFFSET past the node edge. */
export const LABEL_FONT = 11;
export const LABEL_OFFSET = 5;
/**
 * Advance per character (in em) used to reserve room for labels. Instrument
 * Sans measures about 0.55em at weight 700 for these abbreviations, so this
 * leaves headroom for the bold selected state.
 */
export const LABEL_CHAR_W = 0.62;

/** Section labels sit on a circle outside the longest book label, tangent to the ring. */
export const SECTION_FONT = 11;
/** On phones the book labels are hidden, so section labels move in and grow. */
export const SECTION_FONT_COMPACT = 20;
/** JetBrains Mono advances 0.6em; the label CSS adds 0.04em tracking. */
export const SECTION_CHAR_W = 0.66;
const SECTION_BAND_GAP = 10;
const VIEW_MARGIN = 6;

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
    /** direction of the node's spoke in degrees, clockwise from 3 o'clock (-90 is the top) */
    angle: number;
    /** label anchor point, LABEL_OFFSET outside the node on its spoke */
    lx: number;
    ly: number;
    /** start on the right half (text runs outward), end on the left half (flipped) */
    anchor: 'start' | 'end';
    /** label rotation in degrees about (lx, ly), always within [-90, 90] so it reads upright */
    rotate: number;
    fill: string;
};

export type SectionArc = {
    name: string;
    color: string;
    d: string;
    /** centre of the label, tangent to the ring at the middle of the section */
    lx: number;
    ly: number;
    rotate: number;
    /** label centre when book labels are hidden (phone layout) */
    clx: number;
    cly: number;
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

export type ViewBox = { x: number; y: number; w: number; h: number };

/** Symmetric book↔book adjacency with reference counts. */
export type Adjacency = Map<string, Map<string, number>>;

const toRad = (deg: number) => (deg * Math.PI) / 180;

export const nodeRadius = (chapters: number) => NODE_R_BASE + NODE_R_PER_SQRT_CHAPTER * Math.sqrt(chapters);

/** Reserved length of a book label along its spoke. */
export const labelLength = (label: string) => label.length * LABEL_CHAR_W * LABEL_FONT;
export const sectionLabelLength = (name: string, font = SECTION_FONT) => name.length * SECTION_CHAR_W * font;

// ─── Ring layout ────────────────────────────────────────────

const CANON = SECTIONS.map((sec) => ({
    sec,
    books: sec.bookIds.map((id) => findBook(id)).filter((m): m is BookMeta => m !== undefined),
}));

/** Ring radius: the circle whose circumference is exactly every book's footprint plus the section gaps. */
export const RING_R =
    CANON.reduce(
        (sum, { books }) => sum + books.reduce((s, m) => s + 2 * nodeRadius(m.chapters) + NODE_GAP, 0) + SECTION_GAP,
        0,
    ) /
    (2 * Math.PI);

const MAX_NODE_R = Math.max(...CANON.flatMap(({ books }) => books.map((m) => nodeRadius(m.chapters))));
/** Outermost reach of any book label, measured from the ring. */
const LABEL_REACH = Math.max(
    ...CANON.flatMap(({ books }) => books.map((m) => nodeRadius(m.chapters) + LABEL_OFFSET + labelLength(m.abbrev))),
);
export const SECTION_LABEL_R = RING_R + LABEL_REACH + SECTION_BAND_GAP + SECTION_FONT / 2;
export const SECTION_LABEL_R_COMPACT = RING_R + MAX_NODE_R + SECTION_BAND_GAP + SECTION_FONT_COMPACT / 2;

/** Upright rotation for text tangent to the ring at `deg`. */
function tangentRotation(deg: number): number {
    const sin = Math.sin(toRad(deg));
    let rot = sin > 0 ? deg - 90 : deg + 90;
    while (rot > 180) rot -= 360;
    while (rot <= -180) rot += 360;
    return rot;
}

function buildRing(cx: number, cy: number): RingLayout {
    const R = RING_R;
    const nodes: RingNode[] = [];
    const sections: SectionArc[] = [];
    const at = (rad: number, deg: number) => [cx + rad * Math.cos(toRad(deg)), cy + rad * Math.sin(toRad(deg))];
    // Walk the circumference in arc length; Genesis starts half a section gap past 12 o'clock
    let s = SECTION_GAP / 2;
    const deg = (arc: number) => -90 + (arc / R) * (180 / Math.PI);

    for (const { sec, books } of CANON) {
        const s0 = s;
        for (const meta of books) {
            const r = nodeRadius(meta.chapters);
            const angle = deg(s + r + NODE_GAP / 2);
            const [x, y] = at(R, angle);
            const [lx, ly] = at(R + r + LABEL_OFFSET, angle);
            const right = Math.cos(toRad(angle)) >= 0;
            nodes.push({
                id: meta.osisId,
                label: meta.abbrev,
                name: meta.name,
                section: sec.name,
                testament: sec.testament,
                chapters: meta.chapters,
                r,
                x,
                y,
                angle,
                lx,
                ly,
                anchor: right ? 'start' : 'end',
                rotate: right ? angle : angle - 180,
                fill: sec.testament === 'OT' ? OT_NODE_COLOR : NT_NODE_COLOR,
            });
            s += 2 * r + NODE_GAP;
        }
        // The guide arc runs from the first node's centre to the last one's
        const first = nodes[nodes.length - books.length];
        const last = nodes[nodes.length - 1];
        const mid = deg((s0 + s) / 2);
        const [lx, ly] = at(SECTION_LABEL_R, mid);
        const [clx, cly] = at(SECTION_LABEL_R_COMPACT, mid);
        const large = last.angle - first.angle > 180 ? 1 : 0;
        sections.push({
            name: sec.name,
            color: sec.color,
            d: `M ${first.x.toFixed(1)} ${first.y.toFixed(1)} A ${R.toFixed(1)} ${R.toFixed(1)} 0 ${large} 1 ${last.x.toFixed(1)} ${last.y.toFixed(1)}`,
            lx,
            ly,
            rotate: tangentRotation(mid),
            clx,
            cly,
        });
        s += SECTION_GAP;
    }

    return { nodes, nodeById: new Map(nodes.map((n) => [n.id, n])), sections };
}

// ─── Label geometry (shared by the viewBox fit and the tests) ──

export type Point = [number, number];

/** Rectangle centred on (x, y), `len` long along `rotate` degrees and `thick` across, as 4 corners. */
export function rotatedRect(x: number, y: number, rotate: number, len: number, thick: number, from: 'start' | 'middle' | 'end'): Point[] {
    const ux = Math.cos(toRad(rotate));
    const uy = Math.sin(toRad(rotate));
    const a = from === 'start' ? 0 : from === 'end' ? -len : -len / 2;
    const b = a + len;
    const h = thick / 2;
    return [
        [x + ux * a - uy * -h, y + uy * a + ux * -h],
        [x + ux * b - uy * -h, y + uy * b + ux * -h],
        [x + ux * b - uy * h, y + uy * b + ux * h],
        [x + ux * a - uy * h, y + uy * a + ux * h],
    ];
}

/** Book label box as laid out (text height taken as one full em). */
export const nodeLabelBox = (n: RingNode): Point[] =>
    rotatedRect(n.lx, n.ly, n.rotate, labelLength(n.label), LABEL_FONT, n.anchor);

export const sectionLabelBox = (sec: SectionArc, compact = false): Point[] => {
    const font = compact ? SECTION_FONT_COMPACT : SECTION_FONT;
    return rotatedRect(compact ? sec.clx : sec.lx, compact ? sec.cly : sec.ly, sec.rotate, sectionLabelLength(sec.name, font), font, 'middle');
};

function fit(points: Point[]): ViewBox {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const x = Math.min(...xs) - VIEW_MARGIN;
    const y = Math.min(...ys) - VIEW_MARGIN;
    return { x, y, w: Math.max(...xs) + VIEW_MARGIN - x, h: Math.max(...ys) + VIEW_MARGIN - y };
}

const circleBox = (n: RingNode): Point[] => [
    [n.x - n.r, n.y - n.r],
    [n.x + n.r, n.y + n.r],
];

// Fit the full view around a ring centred at the origin, then shift the
// centre so the viewBox starts at 0,0.
const probe = buildRing(0, 0);
const probeView = fit([
    ...probe.nodes.flatMap((n) => [...circleBox(n), ...nodeLabelBox(n)]),
    ...probe.sections.flatMap((s) => sectionLabelBox(s)),
]);
const CX = -probeView.x;
const CY = -probeView.y;

/** Everything: nodes, radial book labels, section labels. */
export const RING_VIEW: ViewBox = { x: 0, y: 0, w: probeView.w, h: probeView.h };
export const RING_CENTER = { x: CX, y: CY } as const;

/**
 * Phone view: nodes and the moved-in section labels only. Book labels are
 * not drawn there, so the canvas can crop to the ring.
 */
export const RING_VIEW_COMPACT: ViewBox = (() => {
    const v = fit([...probe.nodes.flatMap(circleBox), ...probe.sections.flatMap((s) => sectionLabelBox(s, true))]);
    return { x: v.x + CX, y: v.y + CY, w: v.w, h: v.h };
})();

export function layoutRing(): RingLayout {
    return buildRing(CX, CY);
}

/** Half-width of the tappable band around the ring. */
export const RING_HIT_BAND = MAX_NODE_R + LABEL_OFFSET * 2;

/**
 * The book under a point, for taps that miss the small circles. Within the
 * ring band the nearest node edge wins, so every book owns its whole slot.
 */
export function nodeAt(layout: RingLayout, x: number, y: number): RingNode | null {
    const d = Math.hypot(x - CX, y - CY);
    if (Math.abs(d - RING_R) > RING_HIT_BAND) return null;
    let best: RingNode | null = null;
    let bestGap = Infinity;
    for (const n of layout.nodes) {
        const gap = Math.hypot(x - n.x, y - n.y) - n.r;
        if (gap < bestGap) {
            bestGap = gap;
            best = n;
        }
    }
    return best;
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
