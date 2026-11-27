/**
 * Downloads the transcription the Catena's acceptance gate compares the
 * corpus with (issue #85): the Dominican House of Studies transcription of
 * the 1842 printing. It is consulted only to find OCR errors; nothing is
 * copied from it, it is never published, and the import does not read it.
 *
 * The host serves the files in place, so each is pinned by checksum here:
 * a file that has changed upstream is refused, because every reviewed
 * discrepancy is bound to the comparison as it stood.
 *
 *   pnpm run fetch:catena-oracle
 */

import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './core/paths.js';
import { sha256File } from './core/checksums.js';

const BASE = 'https://isidore.co/aquinas/english';
const FILES: Record<string, string> = {
    'CAMatthew.htm': 'e03e0eda6d2135333f55ff09a1b93f72620f35f2a29f6ef84bd2c559f253603d',
    'CAMark.htm': '5bf48be7e1667cafbd6dc5036bfc28e3eb2932c9ac87c1e8d39479b74d1e627d',
    'CALuke.htm': 'f3b5c9b9757037e99f25c3bc5884d96e49ad0f9323460ac8ebc7b4fe4c27b05e',
    'CAJohn.htm': 'fdb4ed22c4b451e790eb7f3aaa56a67fe74eccf89787dfd52d77cc69b447148d',
};

const outDir = path.join(dataDir, 'texts', 'catena', 'oracle');
fs.mkdirSync(outDir, { recursive: true });
for (const [file, sha256] of Object.entries(FILES)) {
    const dest = path.join(outDir, file);
    if (fs.existsSync(dest) && sha256File(dest) === sha256) {
        console.log(`[fetch:catena-oracle] ${file} present and verified`);
        continue;
    }
    const res = await fetch(`${BASE}/${file}`);
    if (!res.ok) throw new Error(`[fetch:catena-oracle] ${BASE}/${file}: HTTP ${res.status}`);
    const partial = `${dest}.part`;
    fs.writeFileSync(partial, Buffer.from(await res.arrayBuffer()));
    const got = sha256File(partial);
    if (got !== sha256) {
        fs.rmSync(partial);
        throw new Error(`[fetch:catena-oracle] ${file}: sha256 ${got}, expected ${sha256}. The transcription has changed upstream; the gate's reviews were made against the pinned text.`);
    }
    fs.renameSync(partial, dest);
    console.log(`[fetch:catena-oracle] ${file}: ${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB, verified`);
}
