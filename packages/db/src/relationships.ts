import type { Relationship } from '@codex-scriptura/core';
import { db } from './database.js';

/**
 * Get all immediate relationships for a given person.
 * Used for BFS expansion in the genealogy engine.
 */
export async function getRelationshipsForPerson(personId: string): Promise<Relationship[]> {
    const [from, to] = await Promise.all([
        db.relationships.where('personFrom').equals(personId).toArray(),
        db.relationships.where('personTo').equals(personId).toArray(),
    ]);

    // Deduplicate by ID
    const seen = new Set<string>();
    const result: Relationship[] = [];
    for (const rel of [...from, ...to]) {
        if (!seen.has(rel.id)) {
            seen.add(rel.id);
            result.push(rel);
        }
    }
    return result;
}
