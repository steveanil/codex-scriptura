/**
 * Import-run audit trail.
 *
 * Every import/enrich execution appends an ImportRun record to
 * data/processed/_metadata/import-runs.json so the processed outputs can be
 * traced back to their inputs and the pipeline commit that produced them.
 * Build-time only — never shipped to the client.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { repoRoot } from './paths.js';
import type { ImportRun } from './types.js';

let cachedVersion: string | null = null;

/** Git commit of the pipeline code, or 'unknown' outside a git checkout. */
export function pipelineVersion(): string {
    if (cachedVersion === null) {
        try {
            cachedVersion = execSync('git rev-parse HEAD', {
                cwd: repoRoot,
                stdio: ['ignore', 'pipe', 'ignore'],
            }).toString().trim();
        } catch {
            cachedVersion = 'unknown';
        }
    }
    return cachedVersion;
}

export type ImportRunInput = {
    /** Source dataset ID (see core/source-registry.ts where applicable) */
    sourceId: string;
    /** Source file paths consumed — stored repo-relative */
    inputFiles: string[];
    stats: ImportRun['stats'];
};

/**
 * Append a run record to `<metadataDir>/import-runs.json`.
 * Never throws — a failed audit write must not fail the import itself.
 */
export function recordImportRun(metadataDir: string, input: ImportRunInput): void {
    try {
        const file = path.join(metadataDir, 'import-runs.json');

        let runs: ImportRun[] = [];
        if (fs.existsSync(file)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
                if (Array.isArray(parsed)) runs = parsed;
            } catch {
                // corrupt audit file — start fresh rather than fail the import
            }
        }

        runs.push({
            id: randomUUID(),
            sourceId: input.sourceId,
            timestamp: new Date().toISOString(),
            pipelineVersion: pipelineVersion(),
            inputFiles: input.inputFiles.map(f => path.relative(repoRoot, path.resolve(f))),
            stats: input.stats,
        });

        fs.mkdirSync(metadataDir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(runs, null, 2), 'utf-8');
    } catch (err) {
        console.warn(`[import-runs] WARNING: could not record import run: ${err}`);
    }
}
