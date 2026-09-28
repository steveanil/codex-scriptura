/**
 * Downloads the page-structured OCR (djvu XML) of the 1841 Oxford scans of
 * the Catena Aurea from the Internet Archive (issue #85).
 *
 * The scans are the canonical acquisition source: public-domain editions
 * digitised by the University of Toronto, with each page's words and their
 * coordinates, so an imported entry can be traced back to the exact leaf.
 * The Archive serves the derived XML in place, so each download is verified
 * against an accepted checksum like the other unpinnable sources.
 *
 * Downloads to data/texts/catena/<item>_djvu.xml.
 *
 * Run from packages/data-pipeline:
 *   pnpm run fetch:catena            every scan the importer reads
 *   pnpm run fetch:catena -- --force re-download files already present
 */

import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './core/paths.js';
import { verifyChecksum } from './core/checksums.js';
import { CATENA_SCANS } from './import-catena-aurea.js';

const outDir = path.join(dataDir, 'texts', 'catena');
const FORCE = process.argv.includes('--force');

async function download(item: string): Promise<void> {
    const file = `${item}_djvu.xml`;
    const dest = path.join(outDir, file);
    const key = `catena/${file}`;
    if (!FORCE && fs.existsSync(dest)) {
        verifyChecksum(key, dest);
        console.log(`[fetch:catena] ${file} present and verified`);
        return;
    }
    // The metadata names the file server; the generic /download/ path sometimes answers with a listing
    const meta = await (await fetch(`https://archive.org/metadata/${item}`)).json() as { server?: string; dir?: string };
    if (!meta.server || !meta.dir) throw new Error(`[fetch:catena] ${item}: no file server in metadata`);
    const url = `https://${meta.server}${meta.dir}/${file}`;
    console.log(`[fetch:catena] ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`[fetch:catena] ${url}: HTTP ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    if (!body.subarray(0, 200).toString('utf-8').includes('<?xml') && !body.subarray(0, 200).toString('utf-8').includes('DjVuXML')) {
        throw new Error(`[fetch:catena] ${url}: not DjVu XML (got ${body.subarray(0, 60).toString('utf-8').replace(/\s+/g, ' ')})`);
    }
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(dest, body);
    verifyChecksum(key, dest);
    console.log(`[fetch:catena] ${file}: ${(body.length / 1024 / 1024).toFixed(1)} MB, verified`);
}

for (const scan of CATENA_SCANS) await download(scan.item);
