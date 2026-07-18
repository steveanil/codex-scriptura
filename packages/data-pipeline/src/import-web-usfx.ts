import fs from 'node:fs';
import path from 'node:path';
import { importUsfx } from './importers/import-usfx.js';
import { dataDir } from './core/paths.js';

// All USFX-format translations (eBible.org). Missing source files are
// skipped with a hint rather than failing, so a partial fetch still
// imports what it can.
const USFX_TRANSLATIONS: Array<{ id: string; file: string }> = [
    { id: 'WEB', file: 'eng-web.usfx.xml' },
    { id: 'ASV', file: 'eng-asv.usfx.xml' },
    { id: 'BSB', file: 'eng-bsb.usfx.xml' },
    { id: 'YLT', file: 'eng-ylt.usfx.xml' },
    { id: 'DBY', file: 'eng-dby.usfx.xml' },
];

for (const { id, file } of USFX_TRANSLATIONS) {
    const xmlPath = path.join(dataDir, 'texts', file);
    if (!fs.existsSync(xmlPath)) {
        console.warn(`[${id}] Source missing: ${file} - run: pnpm run fetch:texts`);
        continue;
    }
    importUsfx(
        xmlPath,
        id,
        path.join(dataDir, 'processed', `${id.toLowerCase()}-verses.json`)
    );
}
