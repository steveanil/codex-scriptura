import { describe, it, expect } from 'vitest';
import type { RawCommentaryEntry } from '@codex-scriptura/core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CATENA_SCANS, scanMapProblem, assignUniqueIds, readScanPages, scanSourceKey } from './import-catena-aurea.js';
import { SOURCE_CHECKSUMS } from './core/source-checksums.js';
import { RAPIDOCR_FORMAT } from './importers/rapidocr-json.js';

const entry = (id: string, item: string): RawCommentaryEntry & { item: string } =>
    ({ id, item, startRef: 'John.1.14', endRef: 'John.1.14', content: 'x' });

describe('Catena scan map and corpus ids (issue #85)', () => {
    it('gives every chapter exactly one owning scan', () => {
        expect(scanMapProblem()).toBeNull();
        expect(scanMapProblem([...CATENA_SCANS, { item: 'dup', gospel: 'John', chapters: [10, 12], ocr: 'archive' }])).toMatch(/John.10 is owned by both/);
        const chapters = new Map<string, number>();
        for (const s of CATENA_SCANS) chapters.set(s.gospel, Math.max(chapters.get(s.gospel) ?? 0, s.chapters[1]));
        expect(Object.fromEntries(chapters)).toEqual({ Matt: 28, Mark: 16, Luke: 24, John: 21 });
    });

    it('suffixes only consecutive repeats of one scan, and refuses the same id from two places', () => {
        const ok = [entry('catena-john-1-13', 'a'), entry('catena-john-1-14', 'a'), entry('catena-john-1-14', 'a'), entry('catena-john-1-15', 'a')];
        assignUniqueIds(ok);
        expect(ok.map((e) => e.id)).toEqual(['catena-john-1-13', 'catena-john-1-14', 'catena-john-1-14_2', 'catena-john-1-15']);
        expect(() => assignUniqueIds([entry('catena-john-1-14', 'a'), entry('catena-john-1-14', 'b')])).toThrow(/duplicate entry catena-john-1-14: a and b/);
        expect(() => assignUniqueIds([entry('catena-john-1-14', 'a'), entry('catena-john-1-15', 'a'), entry('catena-john-1-14', 'a')])).toThrow(/not consecutive/);
    });
});

describe('scan parts and their OCR backend', () => {
    it('names an OCR backend for every part, and the acquisition artifact that backend needs', () => {
        for (const s of CATENA_SCANS) {
            expect(['archive', 'rapidocr']).toContain(s.ocr);
            expect(scanSourceKey(s)).toBe(`catena/source/${s.item}_${s.ocr === 'archive' ? 'djvu.xml' : 'jp2.zip'}`);
            expect(SOURCE_CHECKSUMS[scanSourceKey(s)], scanSourceKey(s)).toBeDefined();
        }
    });

    it('reads a self-read part only from OCR generated from the accepted bundle', () => {
        const scan = CATENA_SCANS.find((s) => s.ocr === 'rapidocr')!;
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catena-'));
        fs.mkdirSync(path.join(dir, 'ocr'));
        const file = path.join(dir, 'ocr', `${scan.item}.rapidocr.json`);
        const page = { leaf: 3, width: 100, height: 100, rendered_width: 100, rendered_height: 100, lines: [{ x1: 1, y1: 1, x2: 9, y2: 9, score: 1, text: 'one', words: [{ t: 'one', x1: 1, y1: 1, x2: 9, y2: 9 }] }] };
        fs.writeFileSync(file, JSON.stringify({ format: RAPIDOCR_FORMAT, item: scan.item, source: { file: 'x', sha256: 'stale' }, engine: {}, models: {}, config: {}, pages: [page] }));
        expect(() => readScanPages(scan, dir)).toThrow(/run ocr:catena/);
        fs.writeFileSync(file, JSON.stringify({ format: RAPIDOCR_FORMAT, item: scan.item, source: { file: 'x', sha256: SOURCE_CHECKSUMS[scanSourceKey(scan)].sha256 }, engine: {}, models: {}, config: {}, pages: [page] }));
        expect(readScanPages(scan, dir).map((p) => p.leaf)).toEqual([3]);
        fs.rmSync(dir, { recursive: true });
    });
});
