import fs from 'node:fs';
import path from 'node:path';
import { ResolutionMap } from '../core/entity-resolver.js';
import { ConflictStore } from '../core/conflict-store.js';
import { recordImportRun } from '../core/import-runs.js';
import type { SourceRef } from '../core/types.js';

/**
 * Place enrichment - OpenBible geocoding coordinates for Theographic places.
 *
 * MERGE POLICY (confidence is a 0–1 float; Theographic uses "precision", OpenBible uses score/1000):
 *   - No existing coords                          → apply OpenBible coords (source = 'openbible')
 *   - Existing coords, confidence < 0.8           → replace if coordinate drift ≤ 100 km (source = 'merged')
 *   - Existing coords, confidence ≥ 0.8           → protected; skip
 *   - Existing coords, confidence absent          → protected; skip (unknown is not permission)
 *   - Coordinate shift > 100 km                   → drift-skipped; skip
 *
 * MATCHING (in order):
 *   A. Exact name match (friendly_id vs place.name, case-sensitive)
 *   B. Normalized name match (lowercase, stripped punctuation, Mount→Mt normalizations)
 *   C. Disambiguation: if multiple candidates share a name, use verse-ref overlap (osises field)
 *      to pick the single best match. If still ambiguous or no overlap, skip.
 */

// ─── Confidence thresholds ──────────────────────────────────

/**
 * OpenBible scores are in the range ~ -1000 to +1000, representing community
 * vote and time-series confidence. We normalize to 0–1 via: max(0, score/1000).
 * Theographic "precision" is already 0–1.
 *
 * HIGH_CONFIDENCE (0.8): places at or above this threshold are considered
 * well-attested; their existing coordinates are protected from replacement.
 */
export const HIGH_CONFIDENCE = 0.8;

/**
 * Maximum allowable coordinate shift (km) when replacing existing coordinates.
 * A larger shift likely indicates a different place sharing the same name.
 */
export const DRIFT_THRESHOLD_KM = 100;

// ─── Types ──────────────────────────────────────────────────

// Mirrors packages/core/src/types.ts Place - local copy to avoid module resolution issues.
export type Place = {
    id: string;
    name: string;
    lat?: number;
    lng?: number;
    confidence?: number;
    verseRefs: string[];
    description?: string;
    /** @deprecated Use sources[] instead. Kept for backward compatibility. */
    source?: 'theographic' | 'openbible' | 'merged';
    openBibleId?: string;
    /** Field-level provenance. See docs/data-architecture.md §4.2. */
    sources?: SourceRef[];
};

export type OpenBibleRow = {
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
export function parseOpenBibleRecord(line: string): OpenBibleRow | null {
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
            // extra is malformed - ignore verse refs for this record
        }
    }

    return { id, urlSlug, name, lat, lng, confidence, verseRefs };
}

export function parseOpenBibleJsonl(content: string): OpenBibleRow[] {
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
 * Conservative place-name normalization for fuzzy matching.
 * Only handles well-known, high-frequency variations. Deliberately different
 * from the generic core normalizeName - places need Mount/Mt handling.
 */
export function normalizePlaceName(name: string): string {
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

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Enrichment orchestrator (pure w.r.t. the filesystem) ───

export type EnrichPlacesStats = {
    exactMatches: number;
    normalizedMatches: number;
    ambiguousSkipped: number;
    noMatchSkipped: number;
    addedCoords: number;
    replacedCoords: number;
    protectedHighConf: number;
    keptUnknownConf: number;
    driftSkipped: number;
};

/**
 * Apply OpenBible coordinates to `places` (mutated in place) under the merge
 * policy documented above, recording mappings in `resolver` and ambiguities /
 * superseded values in `conflicts`.
 */
export function enrichPlacesData(
    places: Place[],
    obRows: OpenBibleRow[],
    resolver: ResolutionMap,
    conflicts: ConflictStore,
): EnrichPlacesStats {
    // ── Build name indexes ──
    const exactIndex = new Map<string, Place[]>();  // place.name → Place[]
    const normIndex  = new Map<string, Place[]>();  // normalizePlaceName(name) → Place[]

    for (const place of places) {
        const ek = place.name;
        if (!exactIndex.has(ek)) exactIndex.set(ek, []);
        exactIndex.get(ek)!.push(place);

        const nk = normalizePlaceName(place.name);
        if (!normIndex.has(nk)) normIndex.set(nk, []);
        normIndex.get(nk)!.push(place);
    }

    const stats: EnrichPlacesStats = {
        exactMatches: 0,
        normalizedMatches: 0,
        ambiguousSkipped: 0,
        noMatchSkipped: 0,
        addedCoords: 0,
        replacedCoords: 0,
        protectedHighConf: 0,
        keptUnknownConf: 0,
        driftSkipped: 0,
    };

    for (const ob of obRows) {
        // ── Step A: exact name match ──
        let candidates = exactIndex.get(ob.name);
        let matchType: 'exact' | 'normalized' | null = candidates?.length ? 'exact' : null;

        // ── Step B: normalized name match ──
        if (!matchType) {
            const nk = normalizePlaceName(ob.name);
            candidates = normIndex.get(nk);
            if (candidates?.length) matchType = 'normalized';
        }

        if (!matchType || !candidates || candidates.length === 0) {
            stats.noMatchSkipped++;
            continue;
        }

        // ── Step C: candidate resolution ──
        let target: Place | null = null;

        if (candidates.length === 1) {
            // Unique name - no disambiguation needed
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
                    target = scored[0].place;
                } else if (scored.length > 1 && scored[0].overlap > scored[1].overlap) {
                    target = scored[0].place;
                } else {
                    // Still ambiguous after verse-ref scoring - record and skip
                    const topCandidates = scored.length > 0 ? scored : candidates.map(p => ({ place: p, overlap: 0 }));
                    conflicts.add({
                        id: `place:${ob.urlSlug}:openbible-match`,
                        entityType: 'place',
                        entityId: ob.urlSlug,
                        field: 'openbible-match',
                        claims: topCandidates.slice(0, 5).map(s => ({
                            sourceId: 'theographic',
                            value: s.place.id,
                            note: `Ambiguous: "${ob.name}" matches multiple Theographic places (overlap=${s.overlap})`,
                        })),
                    });
                    stats.ambiguousSkipped++;
                    continue;
                }
            } else {
                // No verse refs - cannot disambiguate; record the ambiguity
                conflicts.add({
                    id: `place:${ob.urlSlug}:openbible-match`,
                    entityType: 'place',
                    entityId: ob.urlSlug,
                    field: 'openbible-match',
                    claims: candidates.slice(0, 5).map(p => ({
                        sourceId: 'theographic',
                        value: p.id,
                        note: `Ambiguous: "${ob.name}" matches multiple Theographic places, no verse refs to disambiguate`,
                    })),
                });
                stats.ambiguousSkipped++;
                continue;
            }
        }

        if (matchType === 'exact') stats.exactMatches++;
        else stats.normalizedMatches++;

        // ── Record entity resolution mapping ──────────────────
        resolver.add(ResolutionMap.fromNameMatch(
            target.id,
            'place',
            'openbible-geo',
            ob.urlSlug,
            matchType === 'exact',
        ));

        // ── Step D: merge rules ──
        const hasCoords = target.lat !== undefined && target.lng !== undefined;

        // Helper: build updated sources array with openbible-geo entry for given fields
        const withOpenBibleSource = (existing: SourceRef[] | undefined, fields: string[]): SourceRef[] => {
            const filtered = (existing ?? []).filter(s => s.sourceId !== 'openbible-geo');
            return [...filtered, { sourceId: 'openbible-geo', externalId: ob.urlSlug, fields }];
        };

        if (!hasCoords) {
            // No existing coordinates - apply OpenBible
            target.lat         = ob.lat;
            target.lng         = ob.lng;
            target.confidence  = ob.confidence;
            target.source      = 'openbible'; // backward compat
            target.openBibleId = ob.urlSlug;
            target.sources     = withOpenBibleSource(target.sources, ['lat', 'lng', 'confidence', 'openBibleId']);
            stats.addedCoords++;
            continue;
        }

        // Has existing coordinates
        const existingConf = target.confidence;

        // HIGH_CONFIDENCE guard: do not overwrite well-attested geocodes.
        // Record the competing coordinates as a conflict so the UI can surface the alternative.
        if (existingConf !== undefined && existingConf >= HIGH_CONFIDENCE) {
            conflicts.add({
                id: `place:${target.id}:lat`,
                entityType: 'place',
                entityId: target.id,
                field: 'lat',
                claims: [
                    { sourceId: 'theographic', value: target.lat, note: `confidence=${existingConf} (protected)` },
                    { sourceId: 'openbible-geo', value: ob.lat, note: `confidence=${ob.confidence}` },
                ],
            });
            stats.protectedHighConf++;
            continue;
        }

        // UNKNOWN CONFIDENCE guard: undefined is not permission to overwrite.
        if (existingConf === undefined) {
            stats.keptUnknownConf++;
            continue;
        }

        // Drift check: large coordinate shift likely indicates a name collision
        const distKm = haversineKm(target.lat!, target.lng!, ob.lat, ob.lng);
        if (distKm > DRIFT_THRESHOLD_KM) {
            stats.driftSkipped++;
            continue;
        }

        // Replace coordinates - record the superseded Theographic value as a conflict
        conflicts.add({
            id: `place:${target.id}:lat`,
            entityType: 'place',
            entityId: target.id,
            field: 'lat',
            claims: [
                { sourceId: 'openbible-geo', value: ob.lat, note: `confidence=${ob.confidence} (winner, replaced low-confidence Theographic)` },
                { sourceId: 'theographic', value: target.lat, note: `confidence=${existingConf} (superseded)` },
            ],
        });

        target.lat         = ob.lat;
        target.lng         = ob.lng;
        target.confidence  = ob.confidence;
        target.source      = 'merged'; // backward compat
        target.openBibleId = ob.urlSlug;
        target.sources     = withOpenBibleSource(target.sources, ['lat', 'lng', 'confidence', 'openBibleId']);
        stats.replacedCoords++;
    }

    return stats;
}

// ─── File-based runner ──────────────────────────────────────

export type EnrichPlacesPaths = {
    placesJson: string;
    openBibleJsonl: string;
    metadataDir: string;
};

export function runEnrichPlaces(paths: EnrichPlacesPaths): void {
    if (!fs.existsSync(paths.placesJson)) {
        console.error(`[enrich-places] ERROR: ${paths.placesJson} not found.`);
        console.error('  Run: cd packages/data-pipeline && pnpm run import:theographic');
        process.exit(1);
    }
    if (!fs.existsSync(paths.openBibleJsonl)) {
        console.error(`[enrich-places] ERROR: ${paths.openBibleJsonl} not found.`);
        console.error('  Run: cd packages/data-pipeline && pnpm run fetch:openbible');
        process.exit(1);
    }

    const places: Place[] = JSON.parse(fs.readFileSync(paths.placesJson, 'utf-8'));
    const obRows = parseOpenBibleJsonl(fs.readFileSync(paths.openBibleJsonl, 'utf-8'));

    console.log(`[enrich-places] Loaded ${places.length} Theographic places`);
    console.log(`[enrich-places] Loaded ${obRows.length} OpenBible records from ancient.jsonl`);

    const resolutionMapPath = path.join(paths.metadataDir, 'resolution-map.json');
    const conflictsPath     = path.join(paths.metadataDir, 'conflicts.json');

    const resolver = new ResolutionMap();
    resolver.load(resolutionMapPath); // merge with existing mappings (e.g. from enrich-persons)

    const conflicts = new ConflictStore();
    conflicts.load(conflictsPath); // preserve existing conflict records

    const stats = enrichPlacesData(places, obRows, resolver, conflicts);

    fs.writeFileSync(paths.placesJson, JSON.stringify(places), 'utf-8');
    fs.mkdirSync(paths.metadataDir, { recursive: true });
    resolver.save(resolutionMapPath);
    conflicts.save(conflictsPath);

    recordImportRun(paths.metadataDir, {
        sourceIds: ['openbible-geo'],
        inputFiles: [paths.placesJson, paths.openBibleJsonl],
        stats: {
            created: 0,
            updated: stats.addedCoords + stats.replacedCoords,
            skipped: stats.noMatchSkipped + stats.ambiguousSkipped + stats.keptUnknownConf
                + stats.protectedHighConf + stats.driftSkipped,
            conflicts: stats.ambiguousSkipped + stats.protectedHighConf + stats.replacedCoords,
        },
    });

    // ── Summary ──
    const matched = stats.exactMatches + stats.normalizedMatches;
    console.log('\n[enrich-places] ── Summary ──────────────────────────────────');
    console.log(`  OpenBible records total:          ${obRows.length}`);
    console.log(`  Exact name matches:               ${stats.exactMatches}`);
    console.log(`  Normalized name matches:          ${stats.normalizedMatches}`);
    console.log(`  Ambiguous (multi-candidate):      ${stats.ambiguousSkipped} - conflict recorded`);
    console.log(`  No Theographic match:             ${stats.noMatchSkipped} - skipped`);
    console.log(`  ──  (matched: ${matched})`);
    console.log(`  Coordinates added (no prior):     ${stats.addedCoords}`);
    console.log(`  Coordinates replaced (explicit low confidence): ${stats.replacedCoords}`);
    console.log(`  Kept - confidence unknown/absent: ${stats.keptUnknownConf}`);
    console.log(`  Kept - high confidence (≥ ${HIGH_CONFIDENCE}):   ${stats.protectedHighConf}`);
    console.log(`  Drift-skipped (> ${DRIFT_THRESHOLD_KM} km shift):    ${stats.driftSkipped}`);
    console.log(`  Resolution mappings written:      ${resolver.size}`);
    conflicts.printSummary();
    console.log(`[enrich-places] Written: ${paths.placesJson}`);
    console.log(`[enrich-places] Written: ${resolutionMapPath}`);
    console.log(`[enrich-places] Written: ${conflictsPath}`);
}
