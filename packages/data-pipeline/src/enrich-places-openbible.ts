/**
 * Enrich processed Theographic places with OpenBible geocoding coordinates.
 *
 * Input:
 *   data/processed/places.json              — Theographic place records (run import:theographic first)
 *   data/texts/openbible/ancient.jsonl      — OpenBible Bible Geocoding Data (JSONL format)
 *
 * Output:
 *   data/processed/places.json              — Overwritten in-place with enriched records
 *
 * HOW TO GET THE OPENBIBLE FILE:
 *   cd packages/data-pipeline && pnpm run fetch:openbible
 *   (or manually: curl -L -o data/texts/openbible/ancient.jsonl \
 *     https://raw.githubusercontent.com/openbibleinfo/Bible-Geocoding-Data/main/data/ancient.jsonl)
 *
 * MERGE POLICY (confidence is a 0–1 float; Theographic uses "precision", OpenBible uses score/1000):
 *   - No existing coords                          → apply OpenBible coords (source = 'openbible')
 *   - Existing coords, confidence < 0.8 or absent → replace if coordinate drift ≤ 100 km (source = 'merged')
 *   - Existing coords, confidence ≥ 0.8           → protected; skip
 *   - Coordinate shift > 100 km                   → drift-skipped; skip
 *
 * MATCHING (in order):
 *   A. Exact name match (friendly_id vs place.name, case-sensitive)
 *   B. Normalized name match (lowercase, stripped punctuation, Mount→Mt normalizations)
 *   C. Disambiguation: if multiple candidates share a name, use verse-ref overlap (osises field)
 *      to pick the single best match. If still ambiguous or no overlap, skip.
 *
 * Run from repo root:
 *   cd packages/data-pipeline && npx tsx src/enrich-places-openbible.ts
 */

import fs from 'node:fs';
import path from 'node:path';

// ─── Paths ──────────────────────────────────────────────────

const dataDir    = path.resolve(process.cwd(), '../../data');
const PLACES_JSON  = path.join(dataDir, 'processed', 'places.json');
const OPENBIBLE_JSONL = path.join(dataDir, 'texts', 'openbible', 'ancient.jsonl');

// ─── Confidence thresholds ──────────────────────────────────

/**
 * OpenBible scores are in the range ~ -1000 to +1000, representing community
 * vote and time-series confidence. We normalize to 0–1 via: max(0, score/1000).
 * Theographic "precision" is already 0–1.
 *
 * HIGH_CONFIDENCE (0.8): places at or above this threshold are considered
 * well-attested; their existing coordinates are protected from replacement.
 */
const HIGH_CONFIDENCE = 0.8;

/**
 * Maximum allowable coordinate shift (km) when replacing existing coordinates.
 * A larger shift likely indicates a different place sharing the same name.
 */
const DRIFT_THRESHOLD_KM = 100;

// ─── Types ──────────────────────────────────────────────────

// Mirrors packages/core/src/types.ts Place — local copy to avoid module resolution issues.
type Place = {
    id: string;
    name: string;
    lat?: number;
    lng?: number;
    confidence?: number;
    verseRefs: string[];
    description?: string;
    source?: 'theographic' | 'openbible' | 'merged';
    openBibleId?: string;
};

type OpenBibleRow = {
    id: string;         // OpenBible internal ID (e.g. "aea17b7")
    urlSlug: string;    // URL slug used as openBibleId (e.g. "abana")
    name: string;       // friendly_id (e.g. "Abana")
    lat: number;
    lng: number;
    confidence: number; // normalized 0–1 from identifications[0].score.time_total / 1000
    verseRefs: string[]; // OSIS verse IDs from extra.osises
};

// ─── OpenBible JSONL Parser ─────────────────────────────────

/**
 * Parse a single JSONL record from the OpenBible Bible Geocoding Data.
 *
 * Coordinate extraction:
 *   identifications[0].resolutions[0].lonlat is "longitude,latitude" (note order).
 *
 * Confidence extraction:
 *   identifications[0].score.time_total is a score in ~[-1000, 1000].
 *   We normalise to [0, 1] via max(0, score / 1000).
 *
 * Verse refs:
 *   The `extra` field is a JSON-encoded string containing an `osises` array.
 */
function parseOpenBibleRecord(line: string): OpenBibleRow | null {
    let record: Record<string, unknown>;
    try {
        record = JSON.parse(line);
    } catch {
        return null;
    }

    const name = (record['friendly_id'] as string | undefined)?.trim();
    if (!name) return null;

    const id      = (record['id'] as string | undefined)?.trim() ?? '';
    const urlSlug = (record['url_slug'] as string | undefined)?.trim() ?? id;

    // Extract best identification (first = highest score)
    const identifications = record['identifications'] as Array<Record<string, unknown>> | undefined;
    if (!identifications || identifications.length === 0) return null;

    const bestIdent = identifications[0];
    const resolutions = bestIdent['resolutions'] as Array<Record<string, unknown>> | undefined;
    if (!resolutions || resolutions.length === 0) return null;

    const bestResolution = resolutions[0];
    const lonlatStr = bestResolution['lonlat'] as string | undefined;
    if (!lonlatStr) return null;

    // lonlat format: "longitude,latitude"
    const [lngStr, latStr] = lonlatStr.split(',');
    const lng = parseFloat(lngStr);
    const lat = parseFloat(latStr);
    if (isNaN(lat) || isNaN(lng)) return null;

    // Normalize score to 0–1 confidence
    const scoreObj = bestIdent['score'] as Record<string, unknown> | undefined;
    const rawScore = typeof scoreObj?.['time_total'] === 'number' ? (scoreObj['time_total'] as number) : 0;
    const confidence = Math.max(0, Math.min(1, rawScore / 1000));

    // Extract verse refs from `extra` JSON string
    let verseRefs: string[] = [];
    const extraStr = record['extra'] as string | undefined;
    if (extraStr) {
        try {
            const extra = JSON.parse(extraStr) as Record<string, unknown>;
            const osises = extra['osises'];
            if (Array.isArray(osises)) {
                verseRefs = osises.filter((v): v is string => typeof v === 'string');
            }
        } catch {
            // extra is malformed — ignore verse refs for this record
        }
    }

    return { id, urlSlug, name, lat, lng, confidence, verseRefs };
}

function parseOpenBibleJsonl(content: string): OpenBibleRow[] {
    const results: OpenBibleRow[] = [];
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const row = parseOpenBibleRecord(trimmed);
        if (row) results.push(row);
    }
    return results;
}

// ─── Name Normalization ─────────────────────────────────────

/**
 * Conservative name normalization for fuzzy matching.
 * Only handles well-known, high-frequency variations.
 */
function normalizeName(name: string): string {
    return name
        .toLowerCase()
        .trim()
        .replace(/[.,;:'"!()\-]/g, ' ')   // punctuation → spaces
        .replace(/\s+/g, ' ')              // collapse whitespace
        .replace(/\bmount\b/g, 'mt')       // Mount Sinai → mt sinai
        .replace(/\bmt\.\s*/g, 'mt ')     // Mt. → mt
        .replace(/\bcity of\b/g, '')       // City of David → david
        .trim();
}

// ─── Haversine Distance ─────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Main Enrichment Pass ───────────────────────────────────

function enrich(): void {
    if (!fs.existsSync(PLACES_JSON)) {
        console.error(`[enrich-places] ERROR: ${PLACES_JSON} not found.`);
        console.error('  Run: cd packages/data-pipeline && pnpm run import:theographic');
        process.exit(1);
    }
    if (!fs.existsSync(OPENBIBLE_JSONL)) {
        console.error(`[enrich-places] ERROR: ${OPENBIBLE_JSONL} not found.`);
        console.error('  Run: cd packages/data-pipeline && pnpm run fetch:openbible');
        process.exit(1);
    }

    const places: Place[] = JSON.parse(fs.readFileSync(PLACES_JSON, 'utf-8'));
    const obRows = parseOpenBibleJsonl(fs.readFileSync(OPENBIBLE_JSONL, 'utf-8'));

    console.log(`[enrich-places] Loaded ${places.length} Theographic places`);
    console.log(`[enrich-places] Loaded ${obRows.length} OpenBible records from ancient.jsonl`);

    // ── Build name indexes ──
    const exactIndex = new Map<string, Place[]>();  // place.name → Place[]
    const normIndex  = new Map<string, Place[]>();  // normalizeName(name) → Place[]

    for (const place of places) {
        const ek = place.name;
        if (!exactIndex.has(ek)) exactIndex.set(ek, []);
        exactIndex.get(ek)!.push(place);

        const nk = normalizeName(place.name);
        if (!normIndex.has(nk)) normIndex.set(nk, []);
        normIndex.get(nk)!.push(place);
    }

    // ── Counters ──
    let exactMatches       = 0;
    let normalizedMatches  = 0;
    let ambiguousSkipped   = 0;
    let noMatchSkipped     = 0;
    let addedCoords        = 0;
    let replacedCoords     = 0;
    let protectedHighConf  = 0;
    let keptUnknownConf    = 0;  // has coords, confidence undefined → do not overwrite
    let driftSkipped       = 0;

    for (const ob of obRows) {
        // ── Step A: exact name match ──
        let candidates = exactIndex.get(ob.name);
        let matchType: 'exact' | 'normalized' | null = candidates?.length ? 'exact' : null;

        // ── Step B: normalized name match ──
        if (!matchType) {
            const nk = normalizeName(ob.name);
            candidates = normIndex.get(nk);
            if (candidates?.length) matchType = 'normalized';
        }

        if (!matchType || !candidates || candidates.length === 0) {
            noMatchSkipped++;
            continue;
        }

        // ── Step C: candidate resolution ──
        let target: Place | null = null;

        if (candidates.length === 1) {
            // Unique name — no disambiguation needed
            target = candidates[0];
        } else {
            // Multiple Theographic places share this name.
            // Use verseRefs overlap to disambiguate.
            if (ob.verseRefs.length > 0) {
                const obRefSet = new Set(ob.verseRefs);
                const scored = candidates
                    .map(c => ({
                        place: c,
                        overlap: c.verseRefs.filter(r => obRefSet.has(r)).length,
                    }))
                    .filter(x => x.overlap > 0)
                    .sort((a, b) => b.overlap - a.overlap);

                if (scored.length === 1) {
                    // Exactly one candidate has overlapping verses — unambiguous
                    target = scored[0].place;
                } else if (scored.length > 1 && scored[0].overlap > scored[1].overlap) {
                    // One candidate has a strictly higher overlap than all others
                    target = scored[0].place;
                } else {
                    // Still ambiguous
                    ambiguousSkipped++;
                    continue;
                }
            } else {
                // No verse refs available for overlap — cannot disambiguate
                ambiguousSkipped++;
                continue;
            }
        }

        if (matchType === 'exact') exactMatches++;
        else normalizedMatches++;

        // ── Step D: merge rules ──
        const hasCoords = target.lat !== undefined && target.lng !== undefined;

        if (!hasCoords) {
            // No existing coordinates — apply OpenBible
            target.lat         = ob.lat;
            target.lng         = ob.lng;
            target.confidence  = ob.confidence;
            target.source      = 'openbible';
            target.openBibleId = ob.urlSlug;
            addedCoords++;
            continue;
        }

        // Has existing coordinates
        const existingConf = target.confidence;

        // HIGH_CONFIDENCE guard: do not overwrite well-attested geocodes
        if (existingConf !== undefined && existingConf >= HIGH_CONFIDENCE) {
            protectedHighConf++;
            continue;
        }

        // UNKNOWN CONFIDENCE guard: undefined means the source didn't supply a
        // confidence signal. Treat as "keep" — unknown is not permission to overwrite.
        // Only an explicit low-confidence value (present and < HIGH_CONFIDENCE) allows replacement.
        if (existingConf === undefined) {
            keptUnknownConf++;
            continue;
        }

        // Drift check: large coordinate shift likely indicates a name collision
        const distKm = haversineKm(target.lat!, target.lng!, ob.lat, ob.lng);
        if (distKm > DRIFT_THRESHOLD_KM) {
            driftSkipped++;
            continue;
        }

        // Replace coordinates
        target.lat         = ob.lat;
        target.lng         = ob.lng;
        target.confidence  = ob.confidence;
        target.source      = 'merged';
        target.openBibleId = ob.urlSlug;
        replacedCoords++;
    }

    // ── Write output ──
    fs.writeFileSync(PLACES_JSON, JSON.stringify(places, null, 2), 'utf-8');

    // ── Summary ──
    const matched = exactMatches + normalizedMatches;
    console.log('\n[enrich-places] ── Summary ──────────────────────────────────');
    console.log(`  OpenBible records total:          ${obRows.length}`);
    console.log(`  Exact name matches:               ${exactMatches}`);
    console.log(`  Normalized name matches:          ${normalizedMatches}`);
    console.log(`  Ambiguous (multi-candidate):      ${ambiguousSkipped} — skipped`);
    console.log(`  No Theographic match:             ${noMatchSkipped} — skipped`);
    console.log(`  ──  (matched: ${matched})`);
    console.log(`  Coordinates added (no prior):     ${addedCoords}`);
    console.log(`  Coordinates replaced (explicit low confidence): ${replacedCoords}`);
    console.log(`  Kept — confidence unknown/absent: ${keptUnknownConf}`);
    console.log(`  Kept — high confidence (≥ ${HIGH_CONFIDENCE}):   ${protectedHighConf}`);
    console.log(`  Drift-skipped (> ${DRIFT_THRESHOLD_KM} km shift):    ${driftSkipped}`);
    console.log(`[enrich-places] Written: ${PLACES_JSON}`);
}

enrich();
