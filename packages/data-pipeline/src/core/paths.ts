/**
 * Shared path anchors for pipeline scripts.
 *
 * Resolved from this file's location (import.meta.dirname) rather than
 * process.cwd(), so every script works regardless of the directory it is
 * invoked from (repo root, packages/data-pipeline, or a git worktree).
 */

import path from 'node:path';

/** Absolute path to the repository root. */
export const repoRoot = path.resolve(import.meta.dirname, '../../../..');

/** Absolute path to the raw/processed data directory (data/). */
export const dataDir = path.join(repoRoot, 'data');

/** Absolute path to the client-served data directory (static/data/). */
export const staticDataDir = path.join(repoRoot, 'static', 'data');
