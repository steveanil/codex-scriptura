/**
 * Import-run audit trail.
 *
 * Every import/enrich execution appends an ImportRun record to
 * data/processed/_metadata/import-runs.json so the processed outputs can be
 * traced back to their inputs and the pipeline commit that produced them.
 * Build-time only - never shipped to the client.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { repoRoot } from './paths.js';
import { getSource } from './source-registry.js';
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
    /** Registered source dataset IDs (core/source-registry.ts) - every upstream this run consumed */
    sourceIds: string[];
    /** Source file paths consumed - stored repo-relative */
    inputFiles: string[];
    stats: ImportRun['stats'];
};

/**
 * Append a run record to `<metadataDir>/import-runs.json`.
 *
 * Every sourceId must exist in the source registry - an unknown ID throws,
 * because a misattributed audit trail is a pipeline bug worth failing on
 * (license audits read this file). Write failures, by contrast, never
 * throw: a failed audit write must not fail the import itself.
 */
export function recordImportRun(metadataDir: string, input: ImportRunInput): void {
    for (const id of input.sourceIds) getSource(id);

    try {
        const file = path.join(metadataDir, 'import-runs.json');

        let runs: ImportRun[] = [];
        if (fs.existsSync(file)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
                if (Array.isArray(parsed)) runs = parsed;
            } catch {
                // corrupt audit file - start fresh rather than fail the import
            }
        }

        runs.push({
            id: randomUUID(),
            sourceIds: input.sourceIds,
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
