import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { dataDir } from './core/paths.js';

/**
 * Downloads Bible translation source XML files from public repositories.
 *
 * Sources:
 *   - KJV (OSIS):  github.com/seven1m/open-bibles  (Public Domain)
 *   - OEB (OSIS):  github.com/seven1m/open-bibles  (Public Domain)
 *   - WEB (USFX):  ebible.org                       (Public Domain)
 *
 * If this script fails (network error, 404, renamed branch), download the
 * files manually and place them in data/texts/:
 *   eng-kjv.osis.xml, eng-oeb.osis.xml, eng-web.usfx.xml
 *
 * Run from repo root:
 *   cd packages/data-pipeline && pnpm run fetch:texts
 */

// Pinned 2026-07-03 for reproducible fetches.
// Bump: gh api repos/seven1m/open-bibles/commits --jq '.[0].sha'
const OPEN_BIBLES_COMMIT = '8c31c380a9f7af19fbe04e8eaaa6fa74601083d7';

const GITHUB_RAW =
    `https://raw.githubusercontent.com/seven1m/open-bibles/${OPEN_BIBLES_COMMIT}`;

/** Pass --force to re-download files that are already present. */
const FORCE = process.argv.includes('--force');

const FILES: Array<{ url: string; local: string; note: string }> = [
    {
        url: `${GITHUB_RAW}/eng-kjv.osis.xml`,
        local: 'eng-kjv.osis.xml',
        note: 'King James Version (OSIS)',
    },
    {
        url: `${GITHUB_RAW}/eng-us-oeb.osis.xml`,
        local: 'eng-oeb.osis.xml',
        note: 'Open English Bible, US Edition (OSIS)',
    },
    {
        // eBible.org serves only the latest build - no commit pinning possible.
        // The import-runs audit records when it was consumed.
        url: 'https://eBible.org/Scriptures/eng-web_usfx.zip',
        local: 'eng-web.usfx.xml',
        note: 'World English Bible (USFX, zipped)',
    },
    {
        url: 'https://eBible.org/Scriptures/eng-asv_usfx.zip',
        local: 'eng-asv.usfx.xml',
        note: 'American Standard Version 1901 (USFX, zipped)',
    },
    {
        url: 'https://eBible.org/Scriptures/engbsb_usfx.zip',
        local: 'eng-bsb.usfx.xml',
        note: 'Berean Standard Bible (USFX, zipped)',
    },
    {
        url: 'https://eBible.org/Scriptures/engylt_usfx.zip',
        local: 'eng-ylt.usfx.xml',
        note: "Young's Literal Translation 1898 (USFX, zipped)",
    },
    {
        url: 'https://eBible.org/Scriptures/engDBY_usfx.zip',
        local: 'eng-dby.usfx.xml',
        note: 'Darby Translation 1890 (USFX, zipped)',
    },
];

const outDir = path.join(dataDir, 'texts');

async function downloadFile(url: string, localPath: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(localPath, buffer);
    return;
}

async function downloadAndExtractZip(url: string, localPath: string): Promise<void> {
    const zipPath = localPath + '.zip';
    await downloadFile(url, zipPath);

    // Extract the USFX XML from the zip - look for the *_usfx.xml file
    const tmpDir = localPath + '_tmp';
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
        execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`, { stdio: 'pipe' });

        // Find the usfx XML file inside the extracted contents
        const files = fs.readdirSync(tmpDir, { recursive: true }) as string[];
        const usfxFile = files.find(
            (f) => typeof f === 'string' && f.endsWith('_usfx.xml')
        );

        if (!usfxFile) {
            throw new Error(
                `No *_usfx.xml file found in zip. Contents: ${files.join(', ')}`
            );
        }

        fs.copyFileSync(path.join(tmpDir, usfxFile), localPath);
    } finally {
        // Clean up temp files
        fs.rmSync(tmpDir, { recursive: true, force: true });
        fs.rmSync(zipPath, { force: true });
    }
}

async function download(
    url: string,
    localPath: string,
    note: string
): Promise<void> {
    if (!FORCE && fs.existsSync(localPath)) {
        console.log(`[fetch] Already present, skipping: ${path.basename(localPath)} (--force to re-download)`);
        return;
    }

    console.log(`[fetch] Downloading ${note} ...`);

    const isZip = url.endsWith('.zip');
    if (isZip) {
        await downloadAndExtractZip(url, localPath);
    } else {
        await downloadFile(url, localPath);
    }

    const kb = (fs.statSync(localPath).size / 1024).toFixed(1);
    console.log(`[fetch] Saved: ${path.basename(localPath)} (${kb} KB)`);
}

async function main(): Promise<void> {
    fs.mkdirSync(outDir, { recursive: true });
    console.log(`[fetch] Output dir: ${outDir}`);

    const errors: string[] = [];

    for (const { url, local, note } of FILES) {
        try {
            await download(url, path.join(outDir, local), note);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[fetch] FAILED: ${local}\n  ${msg}`);
            errors.push(local);
        }
    }

    if (errors.length > 0) {
        console.error(
            `\n[fetch] ${errors.length} file(s) failed: ${errors.join(', ')}`
        );
        console.error(
            '[fetch] Place them manually in data/texts/ and re-run import:all'
        );
        process.exit(1);
    }

    console.log('[fetch] Done - all Bible text sources ready.');
}

main();
