/**
 * Generates the OCR of every Catena Aurea scan part in CATENA_SCANS
 * (issue #85).
 *
 * Runs ocr/rapidocr_pages.py in the pinned uv environment against each
 * part's checksum-accepted JP2 bundle and writes data/texts/catena/ocr/
 * <item>.rapidocr.json. The document records the bundle checksum, the
 * package versions, the model checksums and the configuration that produced
 * it, so a present document is regenerated only when one of those changed.
 *
 * Run from packages/data-pipeline:
 *   pnpm run ocr:catena            every part, skipping current documents
 *   pnpm run ocr:catena -- --force regenerate them all
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dataDir } from './core/paths.js';
import { SOURCE_CHECKSUMS } from './core/source-checksums.js';
import { CATENA_SCANS, scanSourceFile, scanSourceKey, scanOcrFile } from './import-catena-aurea.js';
import { rapidOcrProblem, type RapidOcrDocument } from './importers/rapidocr-json.js';

const textsDir = path.join(dataDir, 'texts', 'catena');
const ocrProject = path.resolve(import.meta.dirname, '..', 'ocr');
const FORCE = process.argv.includes('--force');

/** The environment as installed: versions and model checksums, read the same way the script records them. */
function environment(): { engine: Record<string, string>; models: Record<string, string> } {
    const probe = spawnSync('uv', ['run', '--frozen', '--project', ocrProject, 'python', '-c', `
import json, hashlib, os, platform, sys
from importlib.metadata import version
import rapidocr_onnxruntime
base = os.path.dirname(rapidocr_onnxruntime.__file__)
models = {}
for root, _, files in os.walk(base):
    for f in sorted(files):
        if f.endswith('.onnx') or f == 'config.yaml':
            p = os.path.join(root, f); models[os.path.relpath(p, base)] = hashlib.sha256(open(p, 'rb').read()).hexdigest()
print(json.dumps({'engine': {'python': platform.python_version(), 'rapidocr_onnxruntime': version('rapidocr-onnxruntime'), 'onnxruntime': version('onnxruntime'), 'pillow': version('pillow'), 'numpy': version('numpy')}, 'models': dict(sorted(models.items()))}))
`], { encoding: 'utf-8' });
    if (probe.status !== 0) throw new Error(`[ocr:catena] cannot probe the OCR environment (is uv installed?):\n${probe.stderr}`);
    return JSON.parse(probe.stdout) as { engine: Record<string, string>; models: Record<string, string> };
}

const env = environment();
for (const scan of CATENA_SCANS) {
    const bundle = path.join(textsDir, 'source', scanSourceFile(scan));
    if (!fs.existsSync(bundle)) throw new Error(`[ocr:catena] Missing ${bundle} - run fetch:catena`);
    const accepted = SOURCE_CHECKSUMS[scanSourceKey(scan)]?.sha256;
    const out = path.join(textsDir, scanOcrFile(scan));
    if (!FORCE && fs.existsSync(out)) {
        const doc = JSON.parse(fs.readFileSync(out, 'utf-8')) as RapidOcrDocument;
        const same = !rapidOcrProblem(doc, scan.item, accepted) && JSON.stringify(doc.engine) === JSON.stringify(env.engine) && JSON.stringify(doc.models) === JSON.stringify(env.models);
        if (same) { console.log(`[ocr:catena] ${scan.item}: current (${doc.pages.length} pages)`); continue; }
        console.log(`[ocr:catena] ${scan.item}: stale, regenerating`);
    }
    const run = spawnSync('uv', ['run', '--frozen', '--project', ocrProject, 'python', path.join(ocrProject, 'rapidocr_pages.py'), '--zip', bundle, '--out', out], { stdio: 'inherit' });
    if (run.status !== 0) throw new Error(`[ocr:catena] ${scan.item}: OCR failed`);
    const doc = JSON.parse(fs.readFileSync(out, 'utf-8')) as RapidOcrDocument;
    const problem = rapidOcrProblem(doc, scan.item, accepted);
    if (problem) throw new Error(`[ocr:catena] ${out}: ${problem}`);
}
