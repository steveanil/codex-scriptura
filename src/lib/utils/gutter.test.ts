import { describe, expect, it } from 'vitest';
import type { CrossReference } from '@codex-scriptura/core';
import { buildGutterMarks, otherEnd } from './gutter';

const ref = (source: string, target: string, type: CrossReference['type'] = 'parallel', votes = 1): CrossReference =>
    ({ id: `${source}>${target}`, sourceVerse: source, targetVerse: target, type, votes } as CrossReference);

describe('buildGutterMarks', () => {
    const xrefs = new Map<string, CrossReference[]>([
        ['Gen.1.1', [ref('Gen.1.1', 'John.1.1', 'parallel', 90), ref('Heb.11.3', 'Gen.1.1')]],
        ['Gen.1.3', [ref('Gen.1.3', 'Ps.33.9', 'quotation')]],
    ]);
    const boxes = [
        { verse: 1, osisId: 'Gen.1.1', top: 0, lineHeight: 37 },
        { verse: 2, osisId: 'Gen.1.2', top: 37, lineHeight: 37 },
        { verse: 3, osisId: 'Gen.1.3', top: 111, lineHeight: 37 },
    ];

    it('emits one marker per verse with references, skipping verses without', () => {
        const marks = buildGutterMarks(boxes, xrefs, 20);
        expect(marks.map((m) => m.verse)).toEqual([1, 3]);
    });

    it('centres the marker on the first line box', () => {
        const [m1, m3] = buildGutterMarks(boxes, xrefs, 20);
        expect(m1.top).toBe(Math.round((37 - 20) / 2));
        expect(m3.top).toBe(111 + Math.round((37 - 20) / 2));
    });

    it('counts references and quotations and names the top reference', () => {
        const [m1, m3] = buildGutterMarks(boxes, xrefs, 20);
        expect(m1.refs).toBe(2);
        expect(m1.quotes).toBe(0);
        expect(m1.topRef).toBe('John.1.1');
        expect(m3.refs).toBe(1);
        expect(m3.quotes).toBe(1);
    });

    it('pushes a marker down when two verses start on the same line', () => {
        const sameLine = [
            { verse: 1, osisId: 'Gen.1.1', top: 0, lineHeight: 37 },
            { verse: 2, osisId: 'Gen.1.2', top: 0, lineHeight: 37 },
            { verse: 3, osisId: 'Gen.1.3', top: 37, lineHeight: 37 },
        ];
        const refs = new Map<string, CrossReference[]>([
            ['Gen.1.1', [ref('Gen.1.1', 'John.1.1')]],
            ['Gen.1.2', [ref('Gen.1.2', 'Jer.4.23')]],
            ['Gen.1.3', [ref('Gen.1.3', 'Ps.33.9')]],
        ]);
        const [m1, m2, m3] = buildGutterMarks(sameLine, refs, 20);
        expect(m1.top).toBe(Math.round((37 - 20) / 2));
        expect(m2.top).toBe(m1.top + 20 + 2);
        expect(m3.top).toBeGreaterThanOrEqual(m2.top + 22);
    });

    it('reserves room under a verse that also carries a quotation mark', () => {
        const rows = [
            { verse: 1, osisId: 'Gen.1.1', top: 0, lineHeight: 37 },
            { verse: 2, osisId: 'Gen.1.2', top: 0, lineHeight: 37 },
        ];
        const refs = new Map<string, CrossReference[]>([
            ['Gen.1.1', [ref('Gen.1.1', 'John.1.1', 'quotation')]],
            ['Gen.1.2', [ref('Gen.1.2', 'Jer.4.23')]],
        ]);
        const [m1, m2] = buildGutterMarks(rows, refs, 20);
        expect(m1.quotes).toBe(1);
        expect(m2.top).toBe(m1.top + 20 + 2 + 20 + 2);
    });

    it('points at the other end whichever way the pair is stored', () => {
        expect(otherEnd(ref('Gen.1.1', 'John.1.1'), 'Gen.1.1')).toBe('John.1.1');
        expect(otherEnd(ref('Heb.11.3', 'Gen.1.1'), 'Gen.1.1')).toBe('Heb.11.3');
    });
});
