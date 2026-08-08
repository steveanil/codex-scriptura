import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256File, verifyChecksum, UNPINNABLE_SOURCE_FILES } from './checksums.js';
import { SOURCE_CHECKSUMS } from './source-checksums.js';

let tmpDir: string;
let filePath: string;

// SHA-256 of the ASCII string "hello"
const HELLO_SHA =
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checksums-test-'));
    filePath = path.join(tmpDir, 'sample.txt');
    fs.writeFileSync(filePath, 'hello');
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('sha256File', () => {
    it('computes the hex SHA-256 of file contents', () => {
        expect(sha256File(filePath)).toBe(HELLO_SHA);
    });
});

describe('verifyChecksum', () => {
    it('passes when the checksum matches', () => {
        const checksums = { key: { sha256: HELLO_SHA, accepted: '2026-07-22' } };
        expect(() => verifyChecksum('key', filePath, checksums)).not.toThrow();
    });

    it('fails loudly on a mismatch, citing the accepted date and remediation', () => {
        const checksums = { key: { sha256: 'deadbeef', accepted: '2026-01-01' } };
        expect(() => verifyChecksum('key', filePath, checksums)).toThrow(
            /accepted on 2026-01-01[\s\S]*checksums:update/
        );
    });

    it('fails on a missing entry and prints the actual hash for acceptance', () => {
        expect(() => verifyChecksum('unknown', filePath, {})).toThrow(
            new RegExp(`No accepted checksum[\\s\\S]*${HELLO_SHA}`)
        );
    });
});

describe('source-checksums registry', () => {
    it('covers every unpinnable source file', () => {
        for (const key of UNPINNABLE_SOURCE_FILES) {
            expect(SOURCE_CHECKSUMS[key], `missing entry for ${key}`).toBeDefined();
            expect(SOURCE_CHECKSUMS[key].sha256).toMatch(/^[0-9a-f]{64}$/);
            expect(SOURCE_CHECKSUMS[key].accepted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });
});
