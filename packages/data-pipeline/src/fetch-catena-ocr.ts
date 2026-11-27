/**
 * Retrieves the Catena Aurea's OCR documents from their pinned archive
 * (issue #85), so the corpus can be rebuilt without the page scans.
 *
 *   pnpm run fetch:catena-ocr                    download the archive the manifest pins
 *   pnpm run fetch:catena-ocr -- --from <file>   use a local copy of the archive instead
 *   pnpm run fetch:catena-ocr -- --force         replace local documents that differ
 *
 * Nothing is put in place unless the archive and every document in it match
 * the manifest. Documents already present and matching are left alone; ones
 * that differ are kept unless --force, since they may be a newer OCR run
 * that has not been packed yet.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dataDir } from './core/paths.js';
import { catenaOcrProblems, loadCatenaOcrManifest, sha256OfFile } from './core/catena-ocr-archive.js';

const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
};
const FORCE = process.argv.includes('--force');
const ocrDir = arg('--to') ?? path.join(dataDir, 'texts', 'catena', 'ocr');
const manifest = loadCatenaOcrManifest();

const before = catenaOcrProblems(manifest, ocrDir);
if (before.length === 0) {
    console.log(`[fetch:catena-ocr] ${manifest.files.length} documents present and verified (${manifest.version})`);
    process.exit(0);
}
const differing = before.filter((p) => !p.endsWith(': missing'));
if (differing.length && !FORCE) {
    for (const p of differing) console.error(`  ${p}`);
    console.error(`[fetch:catena-ocr] Local documents differ from ${manifest.version}. Pack them as a new version, or pass --force to replace them.`);
    process.exit(1);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'catena-ocr-'));
try {
    let archive = arg('--from');
    if (!archive) {
        archive = path.join(work, manifest.archive.file);
        console.log(`[fetch:catena-ocr] ${manifest.url}`);
        const res = await fetch(manifest.url);
        if (!res.ok || !res.body) throw new Error(`[fetch:catena-ocr] ${manifest.url}: HTTP ${res.status}`);
        await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(archive));
    }
    const sha = sha256OfFile(archive);
    if (sha !== manifest.archive.sha256) throw new Error(`[fetch:catena-ocr] ${archive}: sha256 ${sha}, the manifest pins ${manifest.archive.sha256}`);
    const unpacked = path.join(work, 'unpacked');
    fs.mkdirSync(unpacked);
    // Only the names the manifest lists are extracted, so nothing else in an archive can land anywhere
    execFileSync('tar', ['-xJf', archive, '-C', unpacked, '--no-same-owner', ...manifest.files.map((f) => f.file)]);
    const problems = catenaOcrProblems(manifest, unpacked);
    if (problems.length) throw new Error(`[fetch:catena-ocr] The archive's documents do not match the manifest:\n  ${problems.join('\n  ')}`);
    fs.mkdirSync(ocrDir, { recursive: true });
    for (const f of manifest.files) fs.copyFileSync(path.join(unpacked, f.file), path.join(ocrDir, f.file));
    console.log(`[fetch:catena-ocr] ${manifest.files.length} documents verified and in place (${manifest.version}, ${(manifest.archive.bytes / 1024 / 1024).toFixed(1)} MB)`);
} finally {
    fs.rmSync(work, { recursive: true, force: true });
}
