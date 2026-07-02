/**
 * Genealogy subgraph engine — Phase 3 contract.
 *
 * STATUS: BFS traversal implemented. Bounded by:
 *   - Depth Cap: GENEALOGY_MAX_DEPTH (4 hops)
 *   - Node Cap: GENEALOGY_MAX_NODES (120 elements)
 *   - Warning Threshold: GENEALOGY_NODE_WARNING_THRESHOLD (80 elements)
 *
 * This engine traverses person-to-person relationships bidirectionally from `db.relationships`.
 * Truncation explicitly indicates the hard node cap was hit and traversal aborted, not merely
 * derived from final graph size. Edge IDs maintain deterministic uniqueness from the importer pipeline.
 */

import { personNodeId } from '@codex-scriptura/core';
import type { NeighborhoodResult, GraphNode, GraphEdge } from '@codex-scriptura/core';
import { db, getRelationshipsForPerson } from '@codex-scriptura/db';

// ─── Constants ────────────────────────────────────────────

/** Maximum BFS depth. Hard cap — ignored values are clamped. */
export const GENEALOGY_MAX_DEPTH = 4;

/** Node count threshold at which the engine emits a performance warning. */
export const GENEALOGY_NODE_WARNING_THRESHOLD = 80;

/** Hard node cap consistent with the neighborhood engine. */
export const GENEALOGY_MAX_NODES = 120;

// ─── Public API ───────────────────────────────────────────

/**
 * Build a genealogy subgraph centered on a person.
 *
 * Traverses person-to-person relationships via BFS up to `depth` hops,
 * returning normalized GraphNode[] and GraphEdge[].
 *
 * @param personId  Theographic person ID (e.g. "moses_1")
 * @param depth     BFS depth, capped at GENEALOGY_MAX_DEPTH (4)
 */
export async function buildPersonSubgraph(
    personId: string,
    depth: number,
): Promise<NeighborhoodResult> {
    const maxDepth = Math.min(depth, GENEALOGY_MAX_DEPTH);

    const seedPerson = await db.persons.get(personId);
    if (!seedPerson) {
        return { nodes: [], edges: [], truncated: false };
    }

    const nodeMap = new Map<string, GraphNode>();
    const edgeMap = new Map<string, GraphEdge>();
    let truncated = false;
    let warningFired = false;

    nodeMap.set(personId, {
        id: personNodeId(personId),
        type: 'person',
        label: seedPerson.name,
        data: seedPerson,
    });

    const queue: { id: string; d: number }[] = [{ id: personId, d: 0 }];

    while (queue.length > 0) {
        if (nodeMap.size > GENEALOGY_NODE_WARNING_THRESHOLD && !warningFired) {
            console.warn(`[genealogy] Node count exceeded warning threshold (${GENEALOGY_NODE_WARNING_THRESHOLD}) for subgraph seed ${personId}`);
            warningFired = true;
        }

        const { id: currentId, d: currentDepth } = queue.shift()!;

        // Fetch all direct relationships for the current person bidirectionally
        const relations = await getRelationshipsForPerson(currentId);

        // ONLY expand neighbors if we are below maxDepth
        if (currentDepth < maxDepth) {
            // Deduplicate new neighboring IDs needed from the DB
            const newIds = new Set<string>();
            for (const rel of relations) {
                const otherId = rel.personFrom === currentId ? rel.personTo : rel.personFrom;
                if (!nodeMap.has(otherId)) {
                    newIds.add(otherId);
                }
            }

            // Enforce the node cap prior to enqueuing
            const idsToFetch: string[] = [];
            for (const nid of newIds) {
                if (nodeMap.size + idsToFetch.length >= GENEALOGY_MAX_NODES) {
                    truncated = true;
                    break;
                }
                idsToFetch.push(nid);
            }

            // Load new persons
            if (idsToFetch.length > 0) {
                const persons = await db.persons.bulkGet(idsToFetch);
                for (let i = 0; i < idsToFetch.length; i++) {
                    const pid = idsToFetch[i];
                    const pData = persons[i];
                    nodeMap.set(pid, {
                        id: personNodeId(pid),
                        type: 'person',
                        // Fallback strategy: if person record is missing, replace underscores with spaces
                        label: pData ? pData.name : pid.replace(/_/g, ' '),
                        data: pData, // Will be undefined if missing, UI safely ignores
                    });

                    // ALWAYS push to queue so its edges are processed, 
                    // but its own neighbors will only be expanded if currentDepth + 1 < maxDepth
                    queue.push({ id: pid, d: currentDepth + 1 });
                }
            }
        }

        // Generate normalized graph edges for the relations
        for (const rel of relations) {
            const otherId = rel.personFrom === currentId ? rel.personTo : rel.personFrom;
            // Only add edge if its terminals were not truncated
            if (nodeMap.has(otherId) && !edgeMap.has(rel.id)) {
                edgeMap.set(rel.id, {
                    id: rel.id,
                    source: personNodeId(rel.personFrom),
                    target: personNodeId(rel.personTo),
                    category: 'genealogy',
                    type: rel.type
                });
            }
        }
    }

    return {
        nodes: Array.from(nodeMap.values()),
        edges: Array.from(edgeMap.values()),
        truncated,
    };
}
