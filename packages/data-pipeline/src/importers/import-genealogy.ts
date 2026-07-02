import fs from 'node:fs';
import path from 'node:path';

// ── Inline types (mirrors @codex-scriptura/core Relationship) ──
type RelationshipType =
    | 'father-of'
    | 'mother-of'
    | 'spouse-of'
    | 'sibling-of'
    | 'half-sibling-same-father'
    | 'ancestor-of';

type Relationship = {
    id: string;
    personFrom: string;
    personTo: string;
    type: RelationshipType;
};

/**
 * Genealogy / Relationship Importer
 *
 * Parses a relationship CSV (e.g. BibleData-Relationship.csv or Theographic People_Relationships.csv)
 * and normalizes it into a strict set of Relationship edges for Dexie seeding.
 *
 * Expected Input CSV format (comma-separated, header row):
 *   Source,Target,Relationship
 *   moses_1,gershom,father
 *   adam,eve,spouse
 */

// Deterministic map of raw CSV labels to strictly allowed core types
const RELATIONSHIP_MAP: Record<string, RelationshipType> = {
    'father': 'father-of',
    'mother': 'mother-of',
    'spouse': 'spouse-of',
    'husband': 'spouse-of',
    'wife': 'spouse-of',
    'sibling': 'sibling-of',
    'brother': 'sibling-of',
    'sister': 'sibling-of',
    'half-sibling': 'half-sibling-same-father',
    'half_sibling': 'half-sibling-same-father',
    'half sibling': 'half-sibling-same-father',
    'half-brother': 'half-sibling-same-father',
    'half-sister': 'half-sibling-same-father',
    'ancestor': 'ancestor-of',
    // BibleData uses "bearer" for mother→child (e.g. Mary bearer of Jesus in MAT 1:16)
    'bearer': 'mother-of',
};

function normalizeLabel(label: string): string {
    return label.trim().toLowerCase();
}

export function parseGenealogyRelationships(content: string, idMap: Map<string, string>, fallbackMap: Map<string, string>): { records: Relationship[], skipped: number, unknownLabels: Set<string> } {
    const lines = content.split('\n');
    const records: Relationship[] = [];
    const seenIds = new Set<string>();
    const unknownLabels = new Set<string>();
    let skipped = 0;

    // Skip header
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(',');
        if (parts.length < 5) {
            skipped++;
            continue;
        }

        const source = normalizeLabel(parts[2]);
        const target = normalizeLabel(parts[4]);
        const rawType = normalizeLabel(parts[3]);

        if (!source || !target || !rawType) {
            skipped++;
            continue;
        }

        const mappedType = RELATIONSHIP_MAP[rawType];
        if (!mappedType) {
            unknownLabels.add(rawType);
            skipped++;
            continue;
        }

        // Map IDs if possible, else keep original (though practically, the frontend graph only queries by Theographic ID)
        // 1. Try exact mapping from bibleDataId (if it was unambiguous during enrichment)
        let translatedSource = idMap.get(source);
        let translatedTarget = idMap.get(target);

        // 2. Fallback: Strip numbers and find the most prominently referenced Theographic person with that name
        if (!translatedSource) {
            const baseSource = source.replace(/_\d+$/, '').replace(/_+$/, '');
            translatedSource = fallbackMap.get(baseSource) || source;
        }
        if (!translatedTarget) {
            const baseTarget = target.replace(/_\d+$/, '').replace(/_+$/, '');
            translatedTarget = fallbackMap.get(baseTarget) || target;
        }

        // Generate deterministic ID
        // For bidirectional relationships like spouse/sibling, alphabetize
        let id = '';
        if (mappedType === 'spouse-of' || mappedType === 'sibling-of' || mappedType === 'half-sibling-same-father') {
            const [a, b] = [translatedSource, translatedTarget].sort();
            id = `${a}→${mappedType}→${b}`;
        } else {
            id = `${translatedSource}→${mappedType}→${translatedTarget}`;
        }

        if (seenIds.has(id)) {
            skipped++;
            continue;
        }
        
        seenIds.add(id);
        records.push({
            id,
            personFrom: translatedSource,
            personTo: translatedTarget,
            type: mappedType
        });
    }

    return { records, skipped, unknownLabels };
}

export function importGenealogy(
    inputFile: string,
    outputDir: string
): void {
    if (!fs.existsSync(inputFile)) {
        console.warn(`[genealogy] Missing source file: ${inputFile}`);
        console.warn('[genealogy] Emitting empty relationship dataset to unblock pipeline. Proceeding gracefully.');
        
        fs.mkdirSync(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, 'genealogy.json');
        fs.writeFileSync(outputPath, JSON.stringify([]), 'utf-8');
        return;
    }

    // ── Build ID Map from persons.json ──
    const idMap = new Map<string, string>();
    const fallbackMap = new Map<string, string>();

    // Known BibleData → Theographic ID overrides where fallback picks the wrong person
    const MANUAL_OVERRIDES: Record<string, string> = {
        'yhvh_1': 'jesus_905',     // BibleData uses YHVH_1 for Jesus in genealogy context
        'mary_1': 'mary_1938',     // Mary, Mother of Jesus (not Mary Magdalene or others)
        'joseph_6': 'joseph_1715', // Joseph, Mary's Husband (not OT Joseph son of Jacob)
    };

    const personsFile = path.join(path.dirname(outputDir), 'processed', 'persons.json');
    if (fs.existsSync(personsFile)) {
        try {
            const personsData = JSON.parse(fs.readFileSync(personsFile, 'utf-8'));

            // Build fallback groups by BOTH base ID and base name
            const baseGroups = new Map<string, any[]>();

            function addToGroup(key: string, p: any) {
                if (!key) return;
                if (!baseGroups.has(key)) baseGroups.set(key, []);
                baseGroups.get(key)!.push(p);
            }

            for (const p of personsData) {
                // Exact mapping from enrichment
                if (p.bibleDataId) {
                    idMap.set(p.bibleDataId.toLowerCase(), p.id);
                }

                // Fallback by Theographic ID base (e.g. "mary_1938" → "mary")
                const idBase = p.id.replace(/_\d+$/, '');
                addToGroup(idBase, p);

                // Fallback by first word of name (e.g. "Mary (Mother of Jesus)" → "mary")
                const nameBase = normalizeLabel(p.name).split(/[\s(]/)[0];
                if (nameBase && nameBase !== idBase) {
                    addToGroup(nameBase, p);
                }
            }

            for (const [key, persons] of baseGroups) {
                // Sort by verse ref count descending — pick the most prominent person
                persons.sort((a: any, b: any) => (b.verseRefs?.length || 0) - (a.verseRefs?.length || 0));
                fallbackMap.set(key, persons[0].id);
            }

            // Apply manual overrides last (takes precedence)
            for (const [bdId, theoId] of Object.entries(MANUAL_OVERRIDES)) {
                idMap.set(bdId, theoId);
            }

            console.log(`[genealogy] Loaded exact ID map for ${idMap.size} persons, and fallback map for ${fallbackMap.size} base names.`);
        } catch (err) {
            console.warn(`[genealogy] Failed to parse persons.json for ID translation: ${err}`);
        }
    }

    const content = fs.readFileSync(inputFile, 'utf-8');
    const { records, skipped, unknownLabels } = parseGenealogyRelationships(content, idMap, fallbackMap);

    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'genealogy.json');
    fs.writeFileSync(outputPath, JSON.stringify(records, null, 2), 'utf-8');

    const sizeKb = (fs.statSync(outputPath).size / 1024).toFixed(1);
    
    console.log(`[genealogy] Processed relationships:`);
    console.log(`  - Emitted: ${records.length} valid rows (${sizeKb} KB)`);
    console.log(`  - Skipped: ${skipped} rows (malformed/duplicate/unmapped)`);
    
    if (unknownLabels.size > 0) {
        console.log(`  - Unmapped raw labels ignored: ${Array.from(unknownLabels).join(', ')}`);
    }

    // Print breakdown
    const byType = new Map<string, number>();
    for (const r of records) {
        byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
    }
    console.log('[genealogy] Type breakdown:');
    for (const [t, count] of byType) {
        console.log(`  ${t}: ${count}`);
    }
}
