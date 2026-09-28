/**
 * Downloads the acquisition artifacts of the 1841 Oxford scans of the
 * Catena Aurea from the Internet Archive (issue #85).
 *
 * The scans are the canonical source: public-domain editions digitised by
 * the University of Toronto. A part the pipeline reads through the
 * Archive's own OCR fetches the page-structured djvu XML; a part the
 * pipeline OCRs itself fetches the JP2 page-image bundle (CATENA_SCANS
 * says which). The Archive serves both in place, so each download is
 * verified against an accepted checksum like the other unpinnable sources.
 *
 * Downloads to data/texts/catena/source/.
 *
 * Run from packages/data-pipeline:
 *   pnpm run fetch:catena            every scan the importer reads
 *   pnpm run fetch:catena -- --force re-download files already present
 */

import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dataDir } from './core/paths.js';
import { verifyChecksum } from './core/checksums.js';
import { CATENA_SCANS, scanSourceFile, scanSourceKey, type CatenaScan } from './import-catena-aurea.js';

const outDir = path.join(dataDir, 'texts', 'catena', 'source');
const FORCE = process.argv.includes('--force');

async function download(scan: CatenaScan): Promise<void> {
    const file = scanSourceFile(scan);
    const dest = path.join(outDir, file);
    const key = scanSourceKey(scan);
    if (!FORCE && fs.existsSync(dest)) {
        verifyChecksum(key, dest);
        console.log(`[fetch:catena] ${file} present and verified`);
        return;
    }
    // The metadata names the file server; the generic /download/ path sometimes answers with a listing
    const meta = await (await fetch(`https://archive.org/metadata/${scan.item}`)).json() as { server?: string; dir?: string };
    if (!meta.server || !meta.dir) throw new Error(`[fetch:catena] ${scan.item}: no file server in metadata`);
    const url = `https://${meta.server}${meta.dir}/${file}`;
    console.log(`[fetch:catena] ${url}`);
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`[fetch:catena] ${url}: HTTP ${res.status}`);
    fs.mkdirSync(outDir, { recursive: true });
    const partial = `${dest}.part`;
    // Bundles run to hundreds of megabytes: streamed to disk, and named only once complete
    await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(partial));
    const head = fs.readFileSync(partial, { encoding: 'latin1', flag: 'r' }).slice(0, 200);
    const looksRight = scan.ocr === 'archive' ? head.includes('<?xml') || head.includes('DjVuXML') : head.startsWith('PK');
    if (!looksRight) { fs.rmSync(partial); throw new Error(`[fetch:catena] ${url}: not the expected ${scan.ocr === 'archive' ? 'DjVu XML' : 'zip bundle'} (got ${head.slice(0, 60).replace(/\s+/g, ' ')})`); }
    fs.renameSync(partial, dest);
    verifyChecksum(key, dest);
    console.log(`[fetch:catena] ${file}: ${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB, verified`);
}

for (const scan of CATENA_SCANS) await download(scan);
