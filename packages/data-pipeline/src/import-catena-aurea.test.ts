import { describe, it, expect } from 'vitest';
import type { RawCommentaryEntry } from '@codex-scriptura/core';
import { CATENA_SCANS, scanMapProblem, assignUniqueIds } from './import-catena-aurea.js';

const entry = (id: string, item: string): RawCommentaryEntry & { item: string } =>
    ({ id, item, startRef: 'John.1.14', endRef: 'John.1.14', content: 'x' });

describe('Catena scan map and corpus ids (issue #85)', () => {
    it('gives every chapter exactly one owning scan', () => {
        expect(scanMapProblem()).toBeNull();
        expect(scanMapProblem([...CATENA_SCANS, { item: 'dup', gospel: 'John', chapters: [10, 12] }])).toMatch(/John.10 is owned by both/);
        const chapters = new Map<string, number>();
        for (const s of CATENA_SCANS) chapters.set(s.gospel, Math.max(chapters.get(s.gospel) ?? 0, s.chapters[1]));
        expect(Object.fromEntries(chapters)).toEqual({ Matt: 28, Mark: 16, Luke: 24, John: 21 });
    });

    it('suffixes only consecutive repeats of one scan, and refuses the same id from two places', () => {
        const ok = [entry('catena-john-1-13', 'a'), entry('catena-john-1-14', 'a'), entry('catena-john-1-14', 'a'), entry('catena-john-1-15', 'a')];
        assignUniqueIds(ok);
        expect(ok.map((e) => e.id)).toEqual(['catena-john-1-13', 'catena-john-1-14', 'catena-john-1-14-2', 'catena-john-1-15']);
        expect(() => assignUniqueIds([entry('catena-john-1-14', 'a'), entry('catena-john-1-14', 'b')])).toThrow(/duplicate entry catena-john-1-14: a and b/);
        expect(() => assignUniqueIds([entry('catena-john-1-14', 'a'), entry('catena-john-1-15', 'a'), entry('catena-john-1-14', 'a')])).toThrow(/not consecutive/);
    });
});
