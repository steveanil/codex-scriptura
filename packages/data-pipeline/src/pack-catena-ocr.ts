/**
 * Packs the Catena Aurea's OCR documents into one versioned archive with a
 * manifest of checksums (issue #85). Run where the documents are, after
 * ocr:catena; the archive is then published as a release asset and every
 * other machine retrieves it with fetch:catena-ocr.
 *
 *   pnpm run pack:catena-ocr -- --version catena-ocr-v1 [--out <directory>]
 *
 * The archive is written to data/archives/ unless --out says otherwise, and
 * the manifest to packages/data-pipeline/catena-ocr.manifest.json.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './core/paths.js';
import { SOURCE_CHECKSUMS } from './core/source-checksums.js';
import { CATENA_OCR_MANIFEST_FILE, sha256OfFile, type CatenaOcrManifest } from './core/catena-ocr-archive.js';
import { CATENA_SCANS, scanOcrFile, scanSourceKey } from './import-catena-aurea.js';
import { rapidOcrProblem, type RapidOcrDocument } from './importers/rapidocr-json.js';

const REPOSITORY = 'steveanil/codex-scriptura';

const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
};

const version = arg('--version');
if (!version || !/^catena-ocr-v\d+$/.test(version)) {
    console.error('[pack:catena-ocr] --version catena-ocr-v<N> is required');
    process.exit(1);
}
const outDir = arg('--out') ?? path.join(dataDir, 'archives');
const ocrDir = path.join(dataDir, 'texts', 'catena', 'ocr');

const files: CatenaOcrManifest['files'] = [];
for (const scan of CATENA_SCANS) {
    const name = path.basename(scanOcrFile(scan));
    const file = path.join(ocrDir, name);
    if (!fs.existsSync(file)) throw new Error(`[pack:catena-ocr] Missing ${file}`);
    const doc = JSON.parse(fs.readFileSync(file, 'utf-8')) as RapidOcrDocument;
    const problem = rapidOcrProblem(doc, scan.item, SOURCE_CHECKSUMS[scanSourceKey(scan)]?.sha256);
    if (problem) throw new Error(`[pack:catena-ocr] ${name}: ${problem}`);
    files.push({ file: name, sha256: sha256OfFile(file), bytes: fs.statSync(file).size, item: scan.item, bundleSha256: doc.source.sha256, pages: doc.pages.length });
}
files.sort((a, b) => a.file.localeCompare(b.file));

fs.mkdirSync(outDir, { recursive: true });
const archiveName = `${version}.tar.xz`;
const archive = path.join(outDir, archiveName);
const tarball = archive.replace(/\.xz$/, '');
// Sorted names, no owner and a fixed time: the same documents always pack to the same tar
execFileSync('tar', ['--sort=name', '--format=ustar', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '--mode=0644', '-cf', tarball, '-C', ocrDir, ...files.map((f) => f.file)]);
execFileSync('xz', ['-9', '-T1', '-f', tarball]);

const manifest: CatenaOcrManifest = {
    version,
    archive: { file: archiveName, sha256: sha256OfFile(archive), bytes: fs.statSync(archive).size },
    url: `https://github.com/${REPOSITORY}/releases/download/${version}/${archiveName}`,
    files,
};
fs.writeFileSync(CATENA_OCR_MANIFEST_FILE, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
console.log(`[pack:catena-ocr] ${archive}: ${files.length} documents, ${(manifest.archive.bytes / 1024 / 1024).toFixed(1)} MB, sha256 ${manifest.archive.sha256}`);
console.log(`[pack:catena-ocr] Manifest: ${CATENA_OCR_MANIFEST_FILE}`);
