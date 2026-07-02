/**
 * Pipeline-internal types for the data platform infrastructure.
 *
 * These types are used only at build time (Node.js pipeline scripts).
 * Client-side types live in @codex-scriptura/core.
 *
 * Note: This package does not import from @codex-scriptura/core due to
 * moduleResolution constraints. Types that mirror core are re-declared
 * here, following the same pattern as existing importers.
 *
 * See docs/data-architecture.md for the full specification.
 */

// ─── Mirrored from @codex-scriptura/core ─────────────────

/** Data domains recognized by the source registry. Mirrors core SourceDomain. */
export type SourceDomain =
    | 'persons'
    | 'places'
    | 'events'
    | 'dictionary'
    | 'relationships'
    | 'cross-references'
    | 'lexicon'
    | 'morphology'
    | 'text';

/** Mirrors core SourceRef. */
export type SourceRef = {
    sourceId: string;
    externalId?: string;
    fields: string[];
};

/** Mirrors core ConflictClaim. */
export type ConflictClaim = {
    sourceId: string;
    value: unknown;
    note?: string;
};

/** Mirrors core ConflictRecord. */
export type ConflictRecord = {
    id: string;
    entityType: string;
    entityId: string;
    field: string;
    claims: ConflictClaim[];
};

// ─── Source Registry ─────────────────────────────────────

/**
 * A registered dataset in the Codex Scriptura pipeline.
 * Every dataset integrated into the platform must have an entry here.
 */
export type SourceDataset = {
    /** Machine identifier, e.g. 'theographic', 'openbible-geo', 'bibledata' */
    id: string;
    /** Human-readable name */
    name: string;
    /** SPDX license identifier or 'public-domain' */
    license: string;
    /** Whether derived data may be redistributed in app bundles */
    redistributable: boolean;
    /** Canonical URL (repo or download) */
    url: string;
    /** Domains this source is authoritative for */
    domains: SourceDomain[];
    /**
     * Precedence tier within each domain (lower number = higher priority).
     * Only domains listed here are eligible for merge operations.
     */
    precedence: Partial<Record<SourceDomain, number>>;
    /** Version string or commit hash of the dataset as imported */
    version?: string;
};

// ─── Import Tracking ─────────────────────────────────────

/**
 * Metadata for a single import execution.
 * Written to data/processed/_metadata/import-runs.json.
 * NOT shipped to the client — build-time audit trail only.
 */
export type ImportRun = {
    /** UUID for this import execution */
    id: string;
    /** Source dataset ID from the registry */
    sourceId: string;
    /** ISO 8601 timestamp */
    timestamp: string;
    /** Git commit hash of the data-pipeline code (if available) */
    pipelineVersion: string;
    /** Source file paths or URLs consumed */
    inputFiles: string[];
    /** Record counts */
    stats: {
        created: number;
        updated: number;
        skipped: number;
        conflicts: number;
    };
};

// ─── Entity Resolution ──────────────────────────────────

/** How a cross-dataset entity mapping was established. */
export type ResolutionMethod = 'exact-name' | 'normalized-name' | 'manual' | 'id-pattern';

/**
 * A mapping between a canonical internal entity and its identifiers
 * across external source datasets.
 */
export type ResolutionEntry = {
    /** Canonical internal ID (always the Theographic ID when available) */
    canonicalId: string;
    /** Entity type */
    entityType: 'person' | 'place' | 'event' | 'lexicon';
    /** Map of source dataset ID → external ID in that dataset */
    externalIds: Record<string, string>;
    /** How this mapping was established */
    method: ResolutionMethod;
    /**
     * Confidence that these external records refer to the same real-world entity.
     * 1.0 = certain, 0.8 = high, 0.5 = probable, <0.5 = uncertain.
     *
     * Thresholds:
     * - >= 0.8: Auto-merge
     * - 0.5–0.79: Tentative merge (generates ConflictRecord for review)
     * - < 0.5: No merge (stored separately with tentativeMatch pointer)
     */
    confidence: number;
};

// ─── Merge Engine ────────────────────────────────────────

/**
 * Configuration for how a specific domain resolves field-level conflicts
 * when multiple sources provide data for the same entity.
 */
export type DomainMergeConfig = {
    /** The domain this config applies to */
    domain: SourceDomain;
    /** Source IDs in precedence order (index 0 = highest priority) */
    precedenceOrder: string[];
    /**
     * Fields that are additive (union of all sources, no conflict possible).
     * e.g., 'verseRefs' — all sources' verse references are merged.
     */
    additiveFields: string[];
    /**
     * Fields where only one source ever provides data (no conflict possible).
     * e.g., 'nameMeaning' is only provided by BibleData.
     */
    exclusiveFields: Record<string, string>; // field name → sole source ID
};
