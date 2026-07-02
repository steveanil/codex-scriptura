import fs from 'node:fs';
import path from 'node:path';

/**
 * OpenScriptures Greek Strong's dictionary importer.
 *
 * Parses strongs-greek-dictionary.js from openscriptures/strongs and produces
 * a JSON array of LexiconEntry records for Dexie seeding.
 *
 * Input file format (JavaScript object literal):
 *   var defined = {"G18": { lemma, translit, kjv_def, strongs_def, derivation }, ...}
 *
 * Each entry is keyed by the Strong's number (e.g. "G18") and contains:
 *   - lemma:       Greek word (Unicode)
 *   - translit:    Romanised transliteration
 *   - kjv_def:     Short KJV-based gloss
 *   - strongs_def: Detailed Strong's definition
 *   - derivation:  Etymology / derivation note
 *
 * Output maps to the shared LexiconEntry type:
 *   id:              "G<number>"
 *   strongsNumber:   "G<number>"
 *   language:        "greek"
 *   lemma:           Greek word
 *   transliteration: Romanised form
 *   gloss:           Short definition (from kjv_def)
 *   description:     Full text (translit + derivation + strongs_def)
 *
 * Source: https://github.com/openscriptures/strongs
 * License: CC BY-SA 3.0 Unported
 */

// ── Inline type (mirrors @codex-scriptura/core LexiconEntry) ──

type LexiconEntry = {
    id: string;
    strongsNumber: string;
    language: 'hebrew' | 'greek';
    lemma: string;
    transliteration: string;
    gloss: string;
    description?: string;
};

// ── Raw entry shape from the JS file ──

type RawGreekEntry = {
    lemma?: string;
    translit?: string;
    kjv_def?: string;
    strongs_def?: string;
    derivation?: string;
};

// ── Parser ─────────────────────────────────────────────────

/**
 * Parse the OpenScriptures Greek Strong's dictionary JS object literal
 * into LexiconEntry records.
 *
 * The file is a valid JavaScript `var ... = { ... };` assignment.
 * We strip the `var ... =` prefix and trailing `;` then JSON.parse.
 */
export function parseGreekStrongs(content: string): LexiconEntry[] {
    // The file format is:
    //   /** ... block comment ... */
    //   var strongsGreekDictionary = {"G1615":{...}, ...}; module.exports = strongsGreekDictionary;
    //
    // Strategy: find the first '{' and the matching '}' to extract the JSON object.

    const firstBrace = content.indexOf('{', content.indexOf('='));
    if (firstBrace < 0) {
        throw new Error('[greek-strongs] Could not find opening brace in source file');
    }

    const lastBrace = content.lastIndexOf('}');
    if (lastBrace < 0 || lastBrace <= firstBrace) {
        throw new Error('[greek-strongs] Could not find closing brace in source file');
    }

    const json = content.substring(firstBrace, lastBrace + 1);

    const raw: Record<string, RawGreekEntry> = JSON.parse(json);

    const results: LexiconEntry[] = [];

    for (const [key, entry] of Object.entries(raw)) {
        // Expect keys like "G18", "G453", etc.
        if (!key.startsWith('G')) continue;

        const lemma = entry.lemma?.trim() ?? '';
        const transliteration = entry.translit?.trim() ?? '';
        const kjvDef = entry.kjv_def?.trim() ?? '';
        const strongsDef = entry.strongs_def?.trim() ?? '';
        const derivation = entry.derivation?.trim() ?? '';

        // Build gloss: prefer kjv_def, fall back to first clause of strongs_def
        let gloss = kjvDef;
        if (!gloss && strongsDef) {
            // Take up to the first semicolon or period
            const cutoff = strongsDef.search(/[;.]/);
            gloss = cutoff > 0
                ? strongsDef.substring(0, cutoff).trim()
                : strongsDef;
        }

        // Clean up leading articles/punctuation from gloss
        gloss = gloss.replace(/^[,;:\s]+/, '').trim();

        // Build full description like the Hebrew format:
        //   transliteration (translit) \n derivation \n strongs_def
        const descParts: string[] = [];
        if (transliteration) descParts.push(`${transliteration}`);
        if (derivation) descParts.push(derivation);
        if (strongsDef) descParts.push(strongsDef);
        if (kjvDef) descParts.push(`KJV: ${kjvDef}.`);
        const description = descParts.join('\n') || undefined;

        results.push({
            id: key,
            strongsNumber: key,
            language: 'greek',
            lemma,
            transliteration,
            gloss,
            description,
        });
    }

    // Sort by number for deterministic output
    results.sort((a, b) => {
        const numA = parseInt(a.id.slice(1), 10);
        const numB = parseInt(b.id.slice(1), 10);
        return numA - numB;
    });

    return results;
}

// ── File-based runner ──────────────────────────────────────

export function importGreekStrongs(inputFile: string, outputDir: string): void {
    if (!fs.existsSync(inputFile)) {
        console.error(`[greek-strongs] Missing: ${inputFile}`);
        console.error('[greek-strongs] Run: pnpm run fetch:greek-strongs');
        process.exit(1);
    }

    const content = fs.readFileSync(inputFile, 'utf-8');
    const records = parseGreekStrongs(content);

    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'lexicon-greek.json');
    fs.writeFileSync(outputPath, JSON.stringify(records), 'utf-8');

    const sizeKb = (fs.statSync(outputPath).size / 1024).toFixed(1);
    console.log(`[greek-strongs] Written: ${outputPath} (${records.length} entries, ${sizeKb} KB)`);

    // Sample log
    if (records.length > 0) {
        const sample = records.find(r => r.id === 'G26') ?? records[0];
        console.log(`[greek-strongs] Sample — ${sample.id}: "${sample.lemma}" (${sample.transliteration}) = "${sample.gloss}"`);
    }
}
