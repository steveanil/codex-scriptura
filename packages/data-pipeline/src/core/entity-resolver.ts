/**
 * Entity Resolver — manages cross-dataset identity mappings.
 *
 * The resolver maintains a resolution map that links canonical internal
 * entity IDs to their identifiers in external source datasets.
 *
 * Phase A (current): Type definitions and load/save/query interface.
 * Phase B (future): Populated by importer migration; used in enrichment scripts.
 *
 * See docs/data-architecture.md §6 for the full specification.
 */

import fs from 'node:fs';
import type { ResolutionEntry, ResolutionMethod } from './types.js';

// ─── Name normalization (shared utility) ─────────────────

/**
 * Normalize a name for matching: lowercase, strip punctuation, collapse whitespace.
 * Intentionally conservative — no stemming or alias expansion.
 * Matches the logic in enrich-persons-bibledata.ts for consistency.
 */
export function normalizeName(name: string): string {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ─── Resolution Map ──────────────────────────────────────

/**
 * In-memory resolution map with persistence to a JSON file.
 *
 * Usage:
 * ```
 * const resolver = new ResolutionMap();
 * resolver.load('data/processed/_metadata/resolution-map.json');
 * const canonicalId = resolver.resolve('bibledata', 'Moses_1', 'person');
 * ```
 */
export class ResolutionMap {
    /** All resolution entries, keyed by canonical ID */
    private entries = new Map<string, ResolutionEntry>();

    /** Reverse index: `${sourceId}:${externalId}` → canonical ID */
    private reverseIndex = new Map<string, string>();

    /** Load entries from a JSON file. Merges with any existing entries. */
    load(filePath: string): void {
        if (!fs.existsSync(filePath)) return;

        const data: ResolutionEntry[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        for (const entry of data) {
            this.add(entry);
        }
    }

    /** Save all entries to a JSON file. */
    save(filePath: string): void {
        const entries = Array.from(this.entries.values())
            .sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));
        fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
    }

    /** Add or update a resolution entry. Rebuilds reverse index for the entry. */
    add(entry: ResolutionEntry): void {
        // Remove old reverse index entries if updating
        const existing = this.entries.get(entry.canonicalId);
        if (existing) {
            for (const [sourceId, extId] of Object.entries(existing.externalIds)) {
                this.reverseIndex.delete(`${sourceId}:${extId}`);
            }
        }

        this.entries.set(entry.canonicalId, entry);

        for (const [sourceId, extId] of Object.entries(entry.externalIds)) {
            this.reverseIndex.set(`${sourceId}:${extId}`, entry.canonicalId);
        }
    }

    /**
     * Resolve an external ID from a source dataset to the canonical internal ID.
     * Returns undefined if no mapping exists.
     */
    resolve(sourceId: string, externalId: string, _entityType?: string): string | undefined {
        return this.reverseIndex.get(`${sourceId}:${externalId}`);
    }

    /** Get the full resolution entry for a canonical ID. */
    getEntry(canonicalId: string): ResolutionEntry | undefined {
        return this.entries.get(canonicalId);
    }

    /** Get all entries. */
    all(): ResolutionEntry[] {
        return Array.from(this.entries.values());
    }

    /** Number of entries in the map. */
    get size(): number {
        return this.entries.size;
    }

    /**
     * Create a resolution entry from a direct ID match.
     * Convenience method for the common case where source IDs directly correspond.
     */
    static fromIdMatch(
        canonicalId: string,
        entityType: ResolutionEntry['entityType'],
        sourceId: string,
        externalId: string,
    ): ResolutionEntry {
        return {
            canonicalId,
            entityType,
            externalIds: { [sourceId]: externalId },
            method: 'id-pattern' as ResolutionMethod,
            confidence: 1.0,
        };
    }

    /**
     * Create a resolution entry from a name match.
     * Confidence depends on whether the match was exact or normalized.
     */
    static fromNameMatch(
        canonicalId: string,
        entityType: ResolutionEntry['entityType'],
        sourceId: string,
        externalId: string,
        exact: boolean,
    ): ResolutionEntry {
        return {
            canonicalId,
            entityType,
            externalIds: { [sourceId]: externalId },
            method: exact ? 'exact-name' : 'normalized-name',
            confidence: exact ? 0.95 : 0.8,
        };
    }
}
