import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

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

const GITHUB_RAW =
    'https://raw.githubusercontent.com/seven1m/open-bibles/master';

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
        url: 'https://eBible.org/Scriptures/eng-web_usfx.zip',
        local: 'eng-web.usfx.xml',
        note: 'World English Bible (USFX, zipped)',
    },
];

const outDir = path.resolve(process.cwd(), '../../data/texts');

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

    // Extract the USFX XML from the zip — look for the *_usfx.xml file
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
    if (fs.existsSync(localPath)) {
        console.log(`[fetch] Already present, skipping: ${path.basename(localPath)}`);
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

    console.log('[fetch] Done — all Bible text sources ready.');
}

main();
