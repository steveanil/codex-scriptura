import fs from 'node:fs';
import path from 'node:path';

/**
 * Downloads Theographic Bible Metadata CSVs from GitHub.
 *
 * Source: github.com/robertrouse/theographic-bible-metadata
 *
 * If this script fails (network error, 404, renamed branch), download the repo
 * manually and place the CSV files in data/theographic/:
 *   People.csv, Places.csv, Events.csv, Easton.csv
 *
 * Run from repo root:
 *   cd packages/data-pipeline && npx tsx src/fetch-theographic.ts
 */

const GITHUB_RAW =
    'https://raw.githubusercontent.com/robertrouse/theographic-bible-metadata/master';

const FILES: Array<{ remote: string; local: string }> = [
    { remote: 'CSV/People.csv',  local: 'People.csv'  },
    { remote: 'CSV/Places.csv',  local: 'Places.csv'  },
    { remote: 'CSV/Events.csv',  local: 'Events.csv'  },
    { remote: 'CSV/Easton.csv',  local: 'Easton.csv'  },
];

const outDir = path.resolve(process.cwd(), '../../data/theographic');

async function download(remote: string, localPath: string): Promise<void> {
    if (fs.existsSync(localPath)) {
        console.log(`[fetch] Already present, skipping: ${path.basename(localPath)}`);
        return;
    }

    const url = `${GITHUB_RAW}/${remote}`;
    console.log(`[fetch] Downloading ${path.basename(localPath)} ...`);

    const res = await fetch(url);

    if (!res.ok) {
        throw new Error(
            `HTTP ${res.status} fetching ${url}\n` +
            `If the file path has changed, edit GITHUB_RAW / FILES in fetch-theographic.ts\n` +
            `or download the CSV files manually into data/theographic/.`
        );
    }

    const text = await res.text();
    fs.writeFileSync(localPath, text, 'utf-8');
    const kb = (Buffer.byteLength(text, 'utf-8') / 1024).toFixed(1);
    console.log(`[fetch] Saved: ${path.basename(localPath)} (${kb} KB)`);
}

async function main(): Promise<void> {
    fs.mkdirSync(outDir, { recursive: true });
    console.log(`[fetch] Output dir: ${outDir}`);

    const errors: string[] = [];

    for (const { remote, local } of FILES) {
        try {
            await download(remote, path.join(outDir, local));
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[fetch] FAILED: ${local}\n  ${msg}`);
            errors.push(local);
        }
    }

    if (errors.length > 0) {
        console.error(`\n[fetch] ${errors.length} file(s) failed: ${errors.join(', ')}`);
        console.error('[fetch] Place them manually in data/theographic/ and re-run import:theographic');
        process.exit(1);
    }

    console.log('[fetch] Done.');
}

main();
