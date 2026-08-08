/**
 * Downloads Nave's Topical Bible from CrossWire (SWORD "Nave" module).
 *
 * Source: https://crosswire.org/sword/modules/ModInfo.jsp?modName=Nave
 * License: Public Domain (module conf: DistributionLicense=Public Domain).
 * Orville J. Nave's topical index, ~5,300 topics with ~100,000 scripture
 * references, first published in the early 1900s.
 *
 * CrossWire serves the module zip in place (no commit pinning possible),
 * so the download is verified against an accepted checksum (issue #30).
 * The module content has been stable since 2008 (SwordVersionDate).
 *
 * Downloads to:
 *   data/texts/naves/Nave.zip, extracted alongside it
 *
 * Run from packages/data-pipeline:
 *   pnpm run fetch:naves
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { dataDir } from './core/paths.js';
import { verifyChecksum } from './core/checksums.js';

const ZIP_URL = 'https://crosswire.org/ftpmirror/pub/sword/packages/rawzip/Nave.zip';
const outDir = path.join(dataDir, 'texts', 'naves');
const zipPath = path.join(outDir, 'Nave.zip');
/** The zLD lexicon data files the importer reads. */
const dictDir = path.join(outDir, 'modules', 'lexdict', 'zld', 'nave');

/** Pass --force to re-download files that are already present. */
const FORCE = process.argv.includes('--force');

async function main(): Promise<void> {
    fs.mkdirSync(outDir, { recursive: true });

    // Skip if already extracted. Verify even when skipping - catches local
    // corruption and files fetched before their checksum was accepted.
    if (!FORCE && fs.existsSync(path.join(dictDir, 'dict.zdt')) && fs.existsSync(zipPath)) {
        verifyChecksum('naves/Nave.zip', zipPath);
        console.log('[fetch-naves] Already present: Nave module - skipping');
        return;
    }

    if (FORCE || !fs.existsSync(zipPath)) {
        console.log('[fetch-naves] Downloading Nave.zip ...');
        const res = await fetch(ZIP_URL);
        if (!res.ok) {
            throw new Error(
                `HTTP ${res.status} fetching ${ZIP_URL}\n` +
                `Download manually and place Nave.zip in data/texts/naves/`
            );
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(zipPath, buffer);
        console.log(`[fetch-naves] Saved: Nave.zip (${(buffer.length / 1024).toFixed(1)} KB)`);
    }

    // CrossWire publishes in place (no pin possible) - refuse silent
    // upstream changes (issue #30).
    verifyChecksum('naves/Nave.zip', zipPath);

    console.log('[fetch-naves] Extracting ...');
    execSync(`unzip -o "${zipPath}" -d "${outDir}"`, { stdio: 'pipe' });

    if (!fs.existsSync(path.join(dictDir, 'dict.zdt'))) {
        throw new Error(
            'Expected modules/lexdict/zld/nave/dict.zdt after extraction but it is missing.\n' +
            'Check the zip contents and update the extraction path.'
        );
    }
    console.log('[fetch-naves] Done.');
}

main();
