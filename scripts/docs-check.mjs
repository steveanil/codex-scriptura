#!/usr/bin/env node
/**
 * Documentation truth check (issue #361).
 *
 * Compares the facts the docs state against the code and the pipeline
 * output, and fails when they disagree:
 *
 *   - the Dexie schema version (packages/db/src/schema.ts) against the
 *     "schema version N" phrase in docs/architecture.md
 *   - the package.json versions across the monorepo (all equal) against
 *     the release status in docs/roadmap.md
 *   - the shipped dataset table in docs/features.md against
 *     static/data/manifest.json, when the manifest exists (the pipeline
 *     writes it; CI runs the pipeline on release PRs and passes
 *     --require-manifest)
 *
 * `--update` rewrites the two generated facts (the schema phrase and the
 * dataset table) so a release-prep PR can regenerate them instead of
 * editing by hand. Prose is the reviewer's job; see the checklist in
 * docs/release-process.md.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const update = args.has('--update');
const requireManifest = args.has('--require-manifest');

const problems = [];
const warnings = [];
const notes = [];
const read = (rel) => readFileSync(join(root, rel), 'utf8');

// ── Facts from the code ────────────────────────────────

const schemaSource = read('packages/db/src/schema.ts');
const schemaVersion = Math.max(...[...schemaSource.matchAll(/\.version\((\d+)\)/g)].map((m) => Number(m[1])));

const packageFiles = ['package.json', ...readdirSync(join(root, 'packages')).map((p) => `packages/${p}/package.json`)]
    .filter((p) => existsSync(join(root, p)));
const versions = packageFiles.map((p) => ({ file: p, version: JSON.parse(read(p)).version }));
const version = versions[0].version;
for (const v of versions) {
    if (v.version !== version) problems.push(`${v.file} is at ${v.version}; package.json is at ${version}. Bump every package.json together.`);
}

const manifestPath = 'static/data/manifest.json';
const manifest = existsSync(join(root, manifestPath)) ? JSON.parse(read(manifestPath)) : null;
if (!manifest && requireManifest) {
    problems.push(`${manifestPath} is missing; run the data pipeline first (pnpm setup:data).`);
}

notes.push(`schema version ${schemaVersion}`);
notes.push(`package version ${version}`);

// ── docs/architecture.md: schema version ───────────────

{
    const file = 'docs/architecture.md';
    let text = read(file);
    const phrase = /\*\*schema version (\d+)\*\*/;
    const m = text.match(phrase);
    if (!m) {
        problems.push(`${file} does not state the schema version as "**schema version N**".`);
    } else if (Number(m[1]) !== schemaVersion) {
        if (update) {
            text = text.replace(phrase, `**schema version ${schemaVersion}**`);
            writeFileSync(join(root, file), text);
            notes.push(`${file}: schema version updated ${m[1]} -> ${schemaVersion}`);
        } else {
            problems.push(`${file} says schema version ${m[1]}; packages/db/src/schema.ts is at ${schemaVersion}.`);
        }
    }
}

// ── docs/roadmap.md: release status ────────────────────

{
    const file = 'docs/roadmap.md';
    const text = read(file);
    if (!text.includes(`The latest tagged release is [\`v${version}\`]`)) {
        problems.push(`${file} must say "The latest tagged release is [\`v${version}\`]" (package.json is at ${version}).`);
    }
    const row = text.split('\n').find((line) => line.startsWith(`| v${version} |`));
    if (!row) {
        problems.push(`${file} has no version-table row for v${version}.`);
    } else {
        const status = row.split('|').map((c) => c.trim()).filter(Boolean).at(-1) ?? '';
        if (!status.startsWith('Released')) {
            problems.push(`${file}: the v${version} row's status is "${status}", expected "Released <date>".`);
        }
    }
}

// ── src/lib/whats-new.ts: an entry for this version ────

{
    const file = 'src/lib/whats-new.ts';
    const text = read(file);
    const first = text.match(/title:\s*'([^']*)'/);
    const title = first?.[1] ?? '';
    if (!title.includes(`(v${version})`)) {
        warnings.push(`${file}: the newest What's New entry is "${title}", not one for v${version}. Fine only if this release has no user-visible changes.`);
    }
}

// ── docs/features.md: shipped dataset table ─────────────

function renderDatasetTable(m) {
    const fmt = new Intl.NumberFormat('en-US');
    const mb = (b) => `${(b / 1e6).toFixed(1)} MB`;
    const lines = ['| Dataset | Records | Size |', '|---|---|---|'];
    let total = 0;
    for (const d of m.datasets) {
        total += d.bytes ?? 0;
        lines.push(`| \`${d.id}\` | ${fmt.format(d.recordCount)} | ${mb(d.bytes ?? 0)} |`);
    }
    lines.push(`| **All datasets** | | **${mb(total)}** |`);
    return lines.join('\n');
}

{
    const file = 'docs/features.md';
    const start = '<!-- datasets:start -->';
    const end = '<!-- datasets:end -->';
    let text = read(file);
    const a = text.indexOf(start);
    const b = text.indexOf(end);
    if (a === -1 || b === -1 || b < a) {
        problems.push(`${file} has no ${start} ... ${end} block for the shipped dataset table.`);
    } else if (manifest) {
        const current = text.slice(a + start.length, b).trim();
        const expected = renderDatasetTable(manifest);
        if (current !== expected) {
            if (update) {
                text = text.slice(0, a + start.length) + '\n' + expected + '\n' + text.slice(b);
                writeFileSync(join(root, file), text);
                notes.push(`${file}: dataset table regenerated from ${manifestPath}`);
            } else {
                problems.push(`${file}: the shipped dataset table does not match ${manifestPath}. Run \`pnpm docs:check --update\`.`);
            }
        }
        const total = manifest.datasets.reduce((n, d) => n + (d.bytes ?? 0), 0);
        notes.push(`${manifest.datasets.length} datasets in the manifest, ${(total / 1e6).toFixed(1)} MB in all`);
    } else {
        notes.push(`${manifestPath} not present: dataset counts not checked (run the pipeline, or pass --require-manifest to fail here)`);
    }
}

// ── Report ─────────────────────────────────────────────

for (const n of notes) console.log(`  ${n}`);
for (const w of warnings) console.log(`WARN  ${w}`);
for (const p of problems) console.log(`FAIL  ${p}`);
if (problems.length === 0) {
    console.log(`docs:check passed${warnings.length ? ` with ${warnings.length} warning(s)` : ''}`);
} else {
    console.log(`docs:check failed: ${problems.length} problem(s)`);
    process.exit(1);
}
