/**
 * The versioned archive of the Catena Aurea's OCR documents (issue #85).
 *
 * The corpus is built from eight OCR documents that take the 2.9 GB of page
 * scans and hours of OCR to regenerate, so they are kept as one pinned
 * archive: pack:catena-ocr writes it with a manifest, fetch:catena-ocr
 * retrieves it and refuses anything the manifest does not vouch for.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type CatenaOcrManifest = {
    /** Also the release tag the archive is published under. */
    version: string;
    archive: { file: string; sha256: string; bytes: number };
    /** Where fetch:catena-ocr downloads the archive from. */
    url: string;
    /** Each document by its name inside the archive, with the scan bundle it was generated from. */
    files: Array<{ file: string; sha256: string; bytes: number; item: string; bundleSha256: string; pages: number }>;
};

export const CATENA_OCR_MANIFEST_FILE = path.resolve(import.meta.dirname, '..', '..', 'catena-ocr.manifest.json');

export function loadCatenaOcrManifest(file: string = CATENA_OCR_MANIFEST_FILE): CatenaOcrManifest {
    if (!fs.existsSync(file)) throw new Error(`[catena-ocr] No manifest at ${file} - run pack:catena-ocr where the OCR documents are`);
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as CatenaOcrManifest;
}

export function sha256OfFile(file: string): string {
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.allocUnsafe(1 << 20);
    for (let n = fs.readSync(fd, buf); n > 0; n = fs.readSync(fd, buf)) hash.update(buf.subarray(0, n));
    fs.closeSync(fd);
    return hash.digest('hex');
}

/** What keeps the documents in `dir` from being the manifest's: one line per missing, differing or unlisted document. */
export function catenaOcrProblems(manifest: CatenaOcrManifest, dir: string): string[] {
    const problems: string[] = [];
    for (const f of manifest.files) {
        const file = path.join(dir, f.file);
        if (!fs.existsSync(file)) { problems.push(`${f.file}: missing`); continue; }
        const bytes = fs.statSync(file).size;
        if (bytes !== f.bytes) { problems.push(`${f.file}: ${bytes} bytes, the manifest has ${f.bytes}`); continue; }
        const sha = sha256OfFile(file);
        if (sha !== f.sha256) problems.push(`${f.file}: sha256 ${sha.slice(0, 12)}, the manifest has ${f.sha256.slice(0, 12)}`);
    }
    const listed = new Set(manifest.files.map((f) => f.file));
    if (fs.existsSync(dir)) for (const name of fs.readdirSync(dir)) if (name.endsWith('.rapidocr.json') && !listed.has(name)) problems.push(`${name}: not in the manifest`);
    return problems;
}
