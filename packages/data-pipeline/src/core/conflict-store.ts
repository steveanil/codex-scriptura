/**
 * Conflict Store — accumulates and serializes conflict records during
 * pipeline enrichment passes.
 *
 * When the merge engine detects that two sources disagree on a field
 * value, it delegates to the ConflictStore to record the competing claims.
 *
 * Phase A (current): In-memory accumulation with JSON serialization.
 * Phase B (future): Conflicts shipped as static JSON asset for client-side display.
 *
 * See docs/data-architecture.md §5 for the full specification.
 */

import fs from 'node:fs';
import type { ConflictRecord } from './types.js';

export class ConflictStore {
    private records = new Map<string, ConflictRecord>();

    /**
     * Add a conflict record. If a record with the same ID already exists,
     * it is replaced (last write wins — the pipeline should produce
     * deterministic results so this is safe).
     */
    add(record: ConflictRecord): void {
        this.records.set(record.id, record);
    }

    /** Get a conflict record by ID. */
    get(id: string): ConflictRecord | undefined {
        return this.records.get(id);
    }

    /** Get all conflicts for a specific entity. */
    getForEntity(entityType: string, entityId: string): ConflictRecord[] {
        const prefix = `${entityType}:${entityId}:`;
        return Array.from(this.records.values())
            .filter(r => r.id.startsWith(prefix));
    }

    /** Total number of recorded conflicts. */
    get size(): number {
        return this.records.size;
    }

    /** Check if any conflicts exist for a given entity type. */
    hasConflictsForType(entityType: string): boolean {
        for (const r of this.records.values()) {
            if (r.entityType === entityType) return true;
        }
        return false;
    }

    /** Get all conflict records as an array, sorted by ID for deterministic output. */
    all(): ConflictRecord[] {
        return Array.from(this.records.values())
            .sort((a, b) => a.id.localeCompare(b.id));
    }

    /** Load conflicts from a JSON file. Merges with existing records. */
    load(filePath: string): void {
        if (!fs.existsSync(filePath)) return;

        const data: ConflictRecord[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        for (const record of data) {
            this.records.set(record.id, record);
        }
    }

    /** Save all conflicts to a JSON file. */
    save(filePath: string): void {
        const dir = filePath.substring(0, filePath.lastIndexOf('/'));
        if (dir && !fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(this.all(), null, 2), 'utf-8');
    }

    /** Print a summary to the console. */
    printSummary(): void {
        if (this.records.size === 0) {
            console.log('[ConflictStore] No conflicts detected.');
            return;
        }

        // Group by entity type
        const byType = new Map<string, number>();
        for (const r of this.records.values()) {
            byType.set(r.entityType, (byType.get(r.entityType) ?? 0) + 1);
        }

        console.log(`[ConflictStore] ${this.records.size} conflict(s) detected:`);
        for (const [type, count] of byType.entries()) {
            console.log(`  ${type}: ${count}`);
        }
    }

    /** Clear all records. */
    clear(): void {
        this.records.clear();
    }
}
