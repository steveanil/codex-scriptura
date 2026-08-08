/**
 * Derives Strong's tagging for the WEB from original-language texts
 * (issue #134) and patches data/processed/web-verses.json in place.
 *
 * Must run AFTER import-web-usfx.ts (it patches that importer's output)
 * and after fetch-original-language.ts (it reads data/texts/morphhb and
 * data/texts/byzantine). Wired into `pnpm run import:all`.
 *
 * Existing lemmas are never overwritten - if a tagged WEB source ever
 * appears upstream, its word-level tagging wins over this derivation.
 *
 * Run from repo root:
 *   cd packages/data-pipeline && pnpm run derive:strongs
 */

import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './core/paths.js';
import { recordImportRun } from './core/import-runs.js';
import {
    MORPHHB_BOOKS,
    BYZANTINE_FILES,
    parseMorphhbBook,
    parseVerseMap,
    mapWlcToEnglish,
    parseByzantineBook,
    type WlcVerse,
} from './importers/derive-strongs.js';

type RawVerse = {
    translation: string;
    book: string;
    chapter: number;
    verse: number;
    verseEnd?: number;
    osisId: string;
    text: string;
    lemmas?: string;
    align?: string;
    wj?: string;
};

const NT_BOOKS = new Set(BYZANTINE_FILES.map(f => f.book));
const OT_BOOKS = new Set<string>(MORPHHB_BOOKS);

function loadDerivedTokens(): { derived: Map<string, string[]>; inputFiles: string[] } {
    const morphhbDir = path.join(dataDir, 'texts', 'morphhb');
    const byzantineDir = path.join(dataDir, 'texts', 'byzantine');
    const inputFiles: string[] = [];

    // OT: parse every morphhb book (WLC versification), then re-key to
    // English versification via VerseMap.xml + inline KJV boundary notes.
    const wlcVerses: WlcVerse[] = [];
    for (const book of MORPHHB_BOOKS) {
        const file = path.join(morphhbDir, `${book}.xml`);
        if (!fs.existsSync(file)) {
            throw new Error(`[derive-strongs] Missing ${file}. Run: pnpm run fetch:originals`);
        }
        inputFiles.push(file);
        wlcVerses.push(...parseMorphhbBook(fs.readFileSync(file, 'utf-8')));
    }
    const verseMapFile = path.join(morphhbDir, 'VerseMap.xml');
    inputFiles.push(verseMapFile);
    const verseMap = parseVerseMap(fs.readFileSync(verseMapFile, 'utf-8'));
    const { verses: derived, droppedTitles } = mapWlcToEnglish(wlcVerses, verseMap);

    console.log(`[derive-strongs] OT: ${wlcVerses.length} WLC verses -> ${derived.size} English refs (${droppedTitles.length} Psalm superscriptions excluded)`);

    // NT: Byzantine versification matches the WEB directly - no mapping.
    let ntCount = 0;
    for (const { file, book } of BYZANTINE_FILES) {
        const filePath = path.join(byzantineDir, file);
        if (!fs.existsSync(filePath)) {
            throw new Error(`[derive-strongs] Missing ${filePath}. Run: pnpm run fetch:originals`);
        }
        inputFiles.push(filePath);
        for (const [osisId, tokens] of parseByzantineBook(fs.readFileSync(filePath, 'utf-8'), book)) {
            derived.set(osisId, tokens);
            ntCount++;
        }
    }
    console.log(`[derive-strongs] NT: ${ntCount} Byzantine verses parsed`);

    return { derived, inputFiles };
}

function main(): void {
    const versesPath = path.join(dataDir, 'processed', 'web-verses.json');
    if (!fs.existsSync(versesPath)) {
        throw new Error(`[derive-strongs] Missing ${versesPath}. Run: pnpm run import:web`);
    }

    const { derived, inputFiles } = loadDerivedTokens();
    const verses: RawVerse[] = JSON.parse(fs.readFileSync(versesPath, 'utf-8'));

    let tagged = 0;
    let alreadyTagged = 0;
    const untagged: string[] = [];
    const matchedRefs = new Set<string>();
    const stats = { OT: { tagged: 0, total: 0 }, NT: { tagged: 0, total: 0 } };

    for (const v of verses) {
        const testament = OT_BOOKS.has(v.book) ? 'OT' : NT_BOOKS.has(v.book) ? 'NT' : null;
        if (!testament) continue; // Apocrypha etc. - nothing to derive from
        stats[testament].total++;

        // Bridged records (<v id="15-16"/>) union tokens across the range.
        const seen = new Set<string>();
        for (let n = v.verse; n <= (v.verseEnd ?? v.verse); n++) {
            const ref = `${v.book}.${v.chapter}.${n}`;
            for (const token of derived.get(ref) ?? []) seen.add(token);
            if (derived.has(ref)) matchedRefs.add(ref);
        }

        if (v.lemmas) {
            alreadyTagged++;
            stats[testament].tagged++;
            continue;
        }

        if (seen.size > 0) {
            v.lemmas = [...seen].join(' ');
            tagged++;
            stats[testament].tagged++;
        } else {
            untagged.push(v.osisId);
        }
    }

    const unusedRefs = [...derived.keys()].filter(r => !matchedRefs.has(r));

    for (const t of ['OT', 'NT'] as const) {
        const { tagged: got, total } = stats[t];
        const pct = total > 0 ? ((got / total) * 100).toFixed(2) : 'n/a';
        console.log(`[derive-strongs] WEB ${t}: ${got}/${total} verses tagged (${pct}%)`);
    }
    if (alreadyTagged > 0) {
        console.log(`[derive-strongs] ${alreadyTagged} verses already carried lemmas - left untouched`);
    }
    if (untagged.length > 0) {
        console.warn(`[derive-strongs] ${untagged.length} WEB verses got no tokens, e.g.: ${untagged.slice(0, 15).join(', ')}`);
    }
    if (unusedRefs.length > 0) {
        console.warn(`[derive-strongs] ${unusedRefs.length} derived refs matched no WEB verse, e.g.: ${unusedRefs.slice(0, 15).join(', ')}`);
    }

    // Guard BEFORE writing - a broken derivation must not leave a
    // half-tagged web-verses.json on disk for later steps to ship.
    for (const t of ['OT', 'NT'] as const) {
        const { tagged: got, total } = stats[t];
        if (total > 0 && got / total < 0.98) {
            throw new Error(`[derive-strongs] WEB ${t} coverage ${got}/${total} is below 98% - derivation looks broken, refusing to ship`);
        }
    }

    fs.writeFileSync(versesPath, JSON.stringify(verses), 'utf-8');

    recordImportRun(path.join(dataDir, 'processed', '_metadata'), {
        sourceIds: ['oshb-morphhb', 'byzantine-majority-text'],
        inputFiles,
        stats: { created: 0, updated: tagged, skipped: untagged.length, conflicts: 0 },
    });
    console.log(`[derive-strongs] Patched ${tagged} verses in ${versesPath}`);
}

main();
