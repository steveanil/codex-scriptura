/**
 * Merge Engine — domain-aware field-level merge with conflict detection.
 *
 * The merge engine applies domain-specific precedence rules to combine
 * data from multiple sources into a single canonical record, while
 * detecting and recording conflicts for fields where sources disagree.
 *
 * Phase A (current): Configuration and merge method signatures.
 * Phase B (future): Used by enrichment scripts to replace ad-hoc merge logic.
 *
 * See docs/data-architecture.md §3 for domain-specific merge rules.
 */

import type { SourceRef, DomainMergeConfig } from './types.js';
import type { ConflictStore } from './conflict-store.js';

// ─── Domain merge configurations ─────────────────────────
//
// These encode the merge rules from docs/data-architecture.md §3.
// They are static configuration, not runtime-computed.

export const DOMAIN_CONFIGS: Record<string, DomainMergeConfig> = {
    persons: {
        domain: 'persons',
        precedenceOrder: ['theographic', 'bibledata'],
        additiveFields: ['verseRefs'],
        exclusiveFields: {
            nameMeaning: 'bibledata',
            nameMeaningSource: 'bibledata',
        },
    },
    places: {
        domain: 'places',
        precedenceOrder: ['theographic', 'openbible-geo'],
        additiveFields: ['verseRefs'],
        exclusiveFields: {},
    },
    events: {
        domain: 'events',
        precedenceOrder: ['theographic'],
        additiveFields: ['verseRefs'],
        exclusiveFields: {},
    },
    relationships: {
        domain: 'relationships',
        precedenceOrder: ['bibledata', 'theographic'],
        additiveFields: [],
        exclusiveFields: {},
    },
    'cross-references': {
        domain: 'cross-references',
        precedenceOrder: ['openbible-xref'],
        additiveFields: [],
        exclusiveFields: {},
    },
    lexicon: {
        domain: 'lexicon',
        precedenceOrder: ['bibledata'],
        additiveFields: [],
        exclusiveFields: {},
    },
};

// ─── Merge Engine ────────────────────────────────────────

/**
 * Result of merging a field from multiple sources.
 */
export type FieldMergeResult = {
    /** The winning value (from the highest-precedence source) */
    value: unknown;
    /** Source that provided the winning value */
    winnerId: string;
    /** Whether a conflict was detected (multiple sources provided different values) */
    conflicted: boolean;
};

/**
 * Merges data from multiple sources into a canonical record according to
 * domain-specific precedence rules.
 *
 * Usage:
 * ```
 * const engine = new MergeEngine(conflictStore);
 * const merged = engine.mergeField('places', 'jerusalem_1', 'lat', [
 *     { sourceId: 'theographic', value: 31.7683 },
 *     { sourceId: 'openbible-geo', value: 31.7767 },
 * ]);
 * // merged.value = 31.7683 (Theographic wins for places)
 * // merged.conflicted = true (values differ)
 * ```
 */
export class MergeEngine {
    constructor(private conflicts: ConflictStore) {}

    /**
     * Get the domain configuration. Throws if domain is not registered.
     */
    getConfig(domain: string): DomainMergeConfig {
        const config = DOMAIN_CONFIGS[domain];
        if (!config) {
            throw new Error(`[MergeEngine] No merge configuration for domain: "${domain}"`);
        }
        return config;
    }

    /**
     * Merge a single field from multiple sources.
     *
     * Returns the winning value and records a conflict if sources disagree.
     * For additive fields (like verseRefs), returns a union of all values instead.
     */
    mergeField(
        domain: string,
        entityId: string,
        entityType: string,
        field: string,
        contributions: Array<{ sourceId: string; value: unknown }>,
    ): FieldMergeResult {
        const config = this.getConfig(domain);

        // Additive fields: union all values (no conflict possible)
        if (config.additiveFields.includes(field)) {
            const arrays = contributions
                .map(c => c.value)
                .filter(Array.isArray);
            const union = [...new Set(arrays.flat())];
            return {
                value: union,
                winnerId: contributions[0]?.sourceId ?? 'unknown',
                conflicted: false,
            };
        }

        // Exclusive fields: only one source provides this field
        const exclusiveSource = config.exclusiveFields[field];
        if (exclusiveSource) {
            const match = contributions.find(c => c.sourceId === exclusiveSource);
            return {
                value: match?.value ?? contributions[0]?.value,
                winnerId: exclusiveSource,
                conflicted: false,
            };
        }

        // Standard field: apply precedence
        if (contributions.length === 0) {
            return { value: undefined, winnerId: 'unknown', conflicted: false };
        }

        if (contributions.length === 1) {
            return {
                value: contributions[0].value,
                winnerId: contributions[0].sourceId,
                conflicted: false,
            };
        }

        // Sort by precedence (lower index in precedenceOrder = higher priority)
        const sorted = [...contributions].sort((a, b) => {
            const ai = config.precedenceOrder.indexOf(a.sourceId);
            const bi = config.precedenceOrder.indexOf(b.sourceId);
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        });

        const winner = sorted[0];

        // Check for actual conflict (different values from different sources)
        const conflicted = sorted.some(
            (c, i) => i > 0 && !deepEqual(c.value, winner.value)
        );

        if (conflicted) {
            this.conflicts.add({
                id: `${entityType}:${entityId}:${field}`,
                entityType,
                entityId,
                field,
                claims: sorted.map(c => ({
                    sourceId: c.sourceId,
                    value: c.value,
                })),
            });
        }

        return {
            value: winner.value,
            winnerId: winner.sourceId,
            conflicted,
        };
    }

    /**
     * Build a SourceRef array from the contributions that were merged into a record.
     * Groups contributions by sourceId and lists the fields each source provided.
     */
    buildSourceRefs(
        contributions: Array<{ sourceId: string; externalId?: string; field: string }>
    ): SourceRef[] {
        const bySource = new Map<string, { externalId?: string; fields: string[] }>();

        for (const c of contributions) {
            const existing = bySource.get(c.sourceId);
            if (existing) {
                if (!existing.fields.includes(c.field)) {
                    existing.fields.push(c.field);
                }
            } else {
                bySource.set(c.sourceId, {
                    externalId: c.externalId,
                    fields: [c.field],
                });
            }
        }

        return Array.from(bySource.entries()).map(([sourceId, data]) => ({
            sourceId,
            externalId: data.externalId,
            fields: data.fields,
        }));
    }
}

// ─── Utility ─────────────────────────────────────────────

/** Simple deep equality for JSON-serializable values. */
function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return false;

    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.every((v, i) => deepEqual(v, b[i]));
    }

    if (Array.isArray(a) !== Array.isArray(b)) return false;

    const keysA = Object.keys(a as Record<string, unknown>);
    const keysB = Object.keys(b as Record<string, unknown>);
    if (keysA.length !== keysB.length) return false;

    return keysA.every(k =>
        deepEqual(
            (a as Record<string, unknown>)[k],
            (b as Record<string, unknown>)[k],
        )
    );
}
