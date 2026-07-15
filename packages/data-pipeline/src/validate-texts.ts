/**
 * CLI: validate imported translation texts against canonical versification.
 *
 *   pnpm run validate:texts
 *
 * Runs after the text importers (wired into `import:all`). Loads every
 * processed *-verses.json, checks structure (duplicates, unknown books,
 * empty text, verse gaps, bridge overlaps, chapter counts), prints a
 * summary, and writes the full report to
 * data/processed/_metadata/text-validation.json.
 *
 * Exit code 1 on hard errors; warnings (expected for partial translations)
 * are non-fatal but printed for review.
 */

import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './core/paths.js';
import { validateTranslation, type ValidationVerse, type ValidationReport } from './core/validate-texts.js';

const processedDir = path.join(dataDir, 'processed');

const files = fs.existsSync(processedDir)
    ? fs.readdirSync(processedDir).filter((f) => f.endsWith('-verses.json'))
    : [];

if (files.length === 0) {
    console.error(`[validate] No *-verses.json found in ${processedDir} — run the importers first.`);
    process.exit(1);
}

const reports: ValidationReport[] = [];

for (const file of files.sort()) {
    const verses: ValidationVerse[] = JSON.parse(
        fs.readFileSync(path.join(processedDir, file), 'utf-8'),
    );
    const translation = verses[0]?.book ? file.replace('-verses.json', '').toUpperCase() : file;
    const report = validateTranslation(translation, verses);
    reports.push(report);

    const status = report.errors.length > 0 ? 'FAIL' : 'ok';
    console.log(
        `[validate] ${report.translation}: ${status} — ${report.verseCount} verses, ` +
        `${report.bookCount} books, ${report.errors.length} errors, ` +
        `${report.warnings.length} warnings, ${report.expectedOmissions.length} expected omissions`,
    );
    for (const e of report.errors) console.error(`  ERROR   ${e}`);
    for (const w of report.warnings) console.warn(`  warning ${w}`);
}

const metadataDir = path.join(processedDir, '_metadata');
fs.mkdirSync(metadataDir, { recursive: true });
fs.writeFileSync(
    path.join(metadataDir, 'text-validation.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2),
    'utf-8',
);

const totalErrors = reports.reduce((n, r) => n + r.errors.length, 0);
if (totalErrors > 0) {
    console.error(`[validate] ${totalErrors} hard error(s) — failing.`);
    process.exit(1);
}
console.log(`[validate] All translations structurally valid. Report: _metadata/text-validation.json`);
