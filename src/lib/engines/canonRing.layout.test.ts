import { describe, it, expect } from 'vitest';
import {
    SECTIONS,
    RING_VIEW,
    RING_VIEW_COMPACT,
    RING_CENTER,
    RING_R,
    NODE_GAP,
    SECTION_GAP,
    LABEL_FONT,
    LABEL_CHAR_W,
    layoutRing,
    nodeAt,
    nodeLabelBox,
    sectionLabelBox,
    type Point,
    type ViewBox,
} from './canonRing';

// Separating-axis test for convex quads; `tol` is how deep they must overlap to count
function quadsIntersect(a: Point[], b: Point[], tol = 0): boolean {
    for (const q of [a, b]) {
        for (let i = 0; i < q.length; i++) {
            const p = q[i];
            const n = q[(i + 1) % q.length];
            const ax = -(n[1] - p[1]);
            const ay = n[0] - p[0];
            const len = Math.hypot(ax, ay);
            const pa = a.map((v) => (v[0] * ax + v[1] * ay) / len);
            const pb = b.map((v) => (v[0] * ax + v[1] * ay) / len);
            if (Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)) <= tol) return false;
        }
    }
    return true;
}

function distToSegment(p: Point, a: Point, b: Point): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function quadHitsCircle(q: Point[], c: { x: number; y: number; r: number }): boolean {
    const inside = q.every((p, i) => {
        const n = q[(i + 1) % q.length];
        return (n[0] - p[0]) * (c.y - p[1]) - (n[1] - p[1]) * (c.x - p[0]) >= 0;
    });
    return inside || q.some((p, i) => distToSegment([c.x, c.y], p, q[(i + 1) % q.length]) < c.r);
}

const inView = (p: Point, v: ViewBox) => p[0] >= v.x && p[0] <= v.x + v.w && p[1] >= v.y && p[1] <= v.y + v.h;

describe('ring geometry', () => {
    const layout = layoutRing();
    const { nodes, sections } = layout;

    it('closes the circle: footprints plus gaps equal the circumference', () => {
        const total = nodes.reduce((s, n) => s + 2 * n.r + NODE_GAP, 0) + SECTIONS.length * SECTION_GAP;
        expect(total).toBeCloseTo(2 * Math.PI * RING_R, 6);
    });

    it('keeps at least NODE_GAP of clear space between any two nodes', () => {
        // The gap is laid out as arc length; the straight-line clearance is a hair shorter
        const minGap = NODE_GAP * 0.99;
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i];
                const b = nodes[j];
                const clear = Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
                expect(clear, `${a.id} / ${b.id}`).toBeGreaterThanOrEqual(minGap);
            }
        }
    });

    it('runs clockwise from the top in canonical order', () => {
        expect(nodes.map((n) => n.id)).toEqual(SECTIONS.flatMap((s) => s.bookIds));
        expect(nodes[0].angle).toBeGreaterThan(-90);
        expect(nodes[0].angle).toBeLessThan(-80);
        for (let i = 1; i < nodes.length; i++) expect(nodes[i].angle).toBeGreaterThan(nodes[i - 1].angle);
        expect(nodes[65].angle).toBeLessThan(270);
    });

    it('keeps each section contiguous', () => {
        const order = nodes.map((n) => n.section);
        for (const sec of SECTIONS) {
            const first = order.indexOf(sec.name);
            const last = order.lastIndexOf(sec.name);
            expect(last - first + 1).toBe(sec.bookIds.length);
        }
    });

    it('scales radius with chapters: Psalms largest, at least twice Obadiah', () => {
        const ps = layout.nodeById.get('Ps')!;
        const obad = layout.nodeById.get('Obad')!;
        expect(Math.max(...nodes.map((n) => n.r))).toBe(ps.r);
        expect(ps.r).toBeGreaterThanOrEqual(2 * obad.r);
        // still a visible node, not a dot
        expect(obad.r * 2).toBeGreaterThanOrEqual(LABEL_FONT * 0.8);
    });

    it('keeps every label upright', () => {
        for (const n of nodes) {
            expect(n.rotate, n.id).toBeGreaterThanOrEqual(-90);
            expect(n.rotate, n.id).toBeLessThanOrEqual(90);
        }
        for (const s of sections) {
            expect(Math.abs(s.rotate), s.name).toBeLessThanOrEqual(90);
        }
    });

    it(`book label boxes (${LABEL_CHAR_W}em per character, 1em tall) never meet each other or any node`, () => {
        const boxes = nodes.map(nodeLabelBox);
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                expect(quadsIntersect(boxes[i], boxes[j]), `${nodes[i].id} / ${nodes[j].id}`).toBe(false);
            }
            for (const c of nodes) expect(quadHitsCircle(boxes[i], c), `${nodes[i].id} on ${c.id}`).toBe(false);
        }
    });

    it('section labels clear book labels, nodes and each other', () => {
        for (const s of sections) {
            const box = sectionLabelBox(s);
            for (const n of nodes) {
                expect(quadsIntersect(box, nodeLabelBox(n)), `${s.name} / ${n.id}`).toBe(false);
                expect(quadHitsCircle(box, n), `${s.name} on ${n.id}`).toBe(false);
            }
            for (const o of sections) if (o !== s) expect(quadsIntersect(box, sectionLabelBox(o))).toBe(false);
        }
    });

    it('compact section labels clear the nodes and each other', () => {
        for (const s of sections) {
            const box = sectionLabelBox(s, true);
            for (const n of nodes) expect(quadHitsCircle(box, n), `${s.name} on ${n.id}`).toBe(false);
            for (const o of sections) if (o !== s) expect(quadsIntersect(box, sectionLabelBox(o, true))).toBe(false);
        }
    });

    it('centres each section label on its own arc', () => {
        for (const s of sections) {
            const books = nodes.filter((n) => n.section === s.name);
            const labelAngle = (Math.atan2(s.ly - RING_CENTER.y, s.lx - RING_CENTER.x) * 180) / Math.PI;
            const norm = (a: number) => ((a + 450) % 360) - 90;
            expect(norm(labelAngle)).toBeGreaterThan(books[0].angle);
            expect(norm(labelAngle)).toBeLessThan(books[books.length - 1].angle);
        }
    });

    it('fits every node and label inside RING_VIEW, and the ring inside RING_VIEW_COMPACT', () => {
        for (const n of nodes) {
            for (const p of [...nodeLabelBox(n), [n.x - n.r, n.y - n.r], [n.x + n.r, n.y + n.r]] as Point[]) {
                expect(inView(p, RING_VIEW), n.id).toBe(true);
                if (!nodeLabelBox(n).includes(p)) expect(inView(p, RING_VIEW_COMPACT), n.id).toBe(true);
            }
        }
        for (const s of sections) {
            for (const p of sectionLabelBox(s)) expect(inView(p, RING_VIEW), s.name).toBe(true);
            for (const p of sectionLabelBox(s, true)) expect(inView(p, RING_VIEW_COMPACT), s.name).toBe(true);
        }
    });

    it('uses the canvas: the ring spans most of the view', () => {
        expect((2 * RING_R) / Math.max(RING_VIEW.w, RING_VIEW.h)).toBeGreaterThan(0.75);
        expect((2 * RING_R) / Math.max(RING_VIEW_COMPACT.w, RING_VIEW_COMPACT.h)).toBeGreaterThan(0.78);
    });

    it('maps a point anywhere in a book slot to that book', () => {
        for (const n of nodes) {
            expect(nodeAt(layout, n.x, n.y)?.id).toBe(n.id);
            // just outside the circle on the outward side of the spoke
            const ox = n.x + Math.cos((n.angle * Math.PI) / 180) * (n.r + 4);
            const oy = n.y + Math.sin((n.angle * Math.PI) / 180) * (n.r + 4);
            expect(nodeAt(layout, ox, oy)?.id).toBe(n.id);
        }
        expect(nodeAt(layout, RING_CENTER.x, RING_CENTER.y)).toBeNull();
    });

    it('gives a point between two books to the one whose edge is nearer', () => {
        // Measured from the centres instead, a small book would take taps
        // that land right beside a large neighbour.
        for (let i = 0; i < nodes.length; i++) {
            const a = nodes[i];
            const b = nodes[(i + 1) % nodes.length];
            const dist = Math.hypot(b.x - a.x, b.y - a.y);
            const ux = (b.x - a.x) / dist;
            const uy = (b.y - a.y) / dist;
            expect(nodeAt(layout, a.x + ux * (a.r + 1), a.y + uy * (a.r + 1))?.id, `${a.id} beside ${b.id}`).toBe(a.id);
            expect(nodeAt(layout, b.x - ux * (b.r + 1), b.y - uy * (b.r + 1))?.id, `${b.id} beside ${a.id}`).toBe(b.id);
        }
    });
});
