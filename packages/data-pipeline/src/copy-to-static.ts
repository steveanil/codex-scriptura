import fs from 'node:fs';
import path from 'node:path';

/**
 * Copies processed Theographic JSON files from data/processed/ → static/data/
 * so SvelteKit can serve them at /data/*.json for runtime seeding.
 *
 * Run from repo root:
 *   cd packages/data-pipeline && npx tsx src/copy-to-static.ts
 */

const root = path.resolve(process.cwd(), '../..');
const srcDir  = path.join(root, 'data', 'processed');
const destDir = path.join(root, 'static', 'data');

const FILES = ['persons.json', 'places.json', 'events.json', 'dictionary.json'];

fs.mkdirSync(destDir, { recursive: true });

let copied = 0;
for (const file of FILES) {
    const src  = path.join(srcDir, file);
    const dest = path.join(destDir, file);

    if (!fs.existsSync(src)) {
        console.warn(`[copy] Missing: ${src} — run import:theographic first`);
        continue;
    }

    fs.copyFileSync(src, dest);
    const kb = (fs.statSync(dest).size / 1024).toFixed(1);
    console.log(`[copy] ${file} → static/data/ (${kb} KB)`);
    copied++;
}

if (copied === 0) {
    console.error('[copy] No files copied. Run import:theographic first.');
    process.exit(1);
}

console.log(`[copy] Done — ${copied}/${FILES.length} files ready in static/data/.`);
