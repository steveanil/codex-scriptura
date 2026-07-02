/**
 * Graph neighborhood engine — Phase 3.
 *
 * Builds bounded BFS subgraphs centered on a verse node by combining:
 *   - Stored cross-reference edges from the Dexie `crossReferences` table
 *   - Synthesized entity-mention edges derived on demand from verseRefs
 *
 * Hard constraints (non-negotiable):
 *   - Default node cap: 120. Never returns more nodes than maxNodes.
 *   - Entity nodes are terminal leaves — they do not expand further.
 *     Only verse nodes propagate the BFS frontier to the next hop.
 *   - No DB writes. Pure read + in-memory synthesis.
 *
 * Phase 3 supports `verse:` as the starting node type.
 * Support for starting from person/place/event nodes is deferred to Phase 4.
 */

import {
    crossReferenceToGraphEdge,
    verseNodeId,
    personNodeId,
    placeNodeId,
    eventNodeId,
    makeVerseNode,
} from '@codex-scriptura/core';
import type { GraphNode, GraphEdge, GraphFilters, NeighborhoodResult, BookConnectionMatrix } from '@codex-scriptura/core';
import {
    getCrossReferencesForVerse,
    getPersonsByVerse,
    getPlacesByVerse,
    getEventsByVerse,
    getBookCrossReferenceMatrix as _getBookMatrix,
} from '@codex-scriptura/db';

// ─── Constants ────────────────────────────────────────────

export const DEFAULT_MAX_NODES = 120;

// ─── Internal helpers ─────────────────────────────────────

/**
 * Extract the OSIS verse ID from a namespaced verse node ID.
 * Returns null for non-verse node IDs (person:, place:, event:, book:, chapter:).
 * "verse:Gen.1.1" → "Gen.1.1"
 * "person:moses_1" → null
 */
function osisFromVerseNodeId(nodeId: string): string | null {
    if (!nodeId.startsWith('verse:')) return null;
    return nodeId.slice(6); // length of "verse:"
}

/**
 * Format a bare OSIS verse ID as a display label.
 * "Gen.1.1" → "Gen 1:1"   "Gen.1" → "Gen 1"
 */
function formatVerseLabel(osisId: string): string {
    const parts = osisId.split('.');
    if (parts.length === 3) return `${parts[0]} ${parts[1]}:${parts[2]}`;
    if (parts.length === 2) return `${parts[0]} ${parts[1]}`;
    return osisId;
}

/**
 * Build a deterministic entity-mention edge ID.
 * Uses the same unicode arrow convention as CrossReference IDs.
 * e.g. "em:Gen.1.1→person:moses_1"
 */
function entityMentionEdgeId(osisId: string, entityNId: string): string {
    return `em:${osisId}→${entityNId}`;
}

// ─── Expansion ────────────────────────────────────────────

/**
 * Expand one verse node: fetch all adjacent edges and accumulate new
 * nodes/edges into the caller's maps.
 *
 * Returns the set of newly-discovered verse node IDs that are eligible
 * for BFS expansion on the next hop. Entity nodes are NOT returned here —
 * they are terminal leaves and never expand further in Phase 3.
 *
 * The maps are mutated in place. The caller enforces the overall node cap;
 * this function also checks the cap before adding each new node so a single
 * high-degree verse does not blow past the limit.
 */
async function expandVerseNode(
    osisId: string,
    filters: GraphFilters,
    nodeMap: Map<string, GraphNode>,
    edgeMap: Map<string, GraphEdge>,
    maxNodes: number,
): Promise<{ newVerseNodes: Set<string>; wasTruncated: boolean }> {
    const edgeCategories = new Set(
        filters.edgeCategories ?? (['cross-reference', 'entity-mention'] as const)
    );
    const nodeTypes = new Set(
        filters.nodeTypes ?? (['verse', 'person', 'place', 'event', 'book', 'chapter'] as const)
    );
    const newVerseNodes = new Set<string>();
    let wasTruncated = false;

    // ── Cross-reference edges ──────────────────────────────
    if (edgeCategories.has('cross-reference') && nodeMap.size < maxNodes) {
        const refs = await getCrossReferencesForVerse(osisId);

        for (const ref of refs) {
            if (nodeMap.size >= maxNodes) { wasTruncated = true; break; }

            // Apply optional edge subtype filter (e.g. 'quotation' only)
            if (filters.edgeTypes && !filters.edgeTypes.includes(ref.type)) continue;

            const edge = crossReferenceToGraphEdge(ref);
            edgeMap.set(edge.id, edge); // idempotent — same edge from both endpoints

            for (const refOsisId of [ref.sourceVerse, ref.targetVerse]) {
                const nId = verseNodeId(refOsisId);
                if (!nodeMap.has(nId) && nodeTypes.has('verse')) {
                    nodeMap.set(nId, makeVerseNode(refOsisId, formatVerseLabel(refOsisId)));
                    newVerseNodes.add(nId);
                }
                if (nodeMap.size >= maxNodes) { wasTruncated = true; break; }
            }
        }
    }

    // ── Entity-mention edges (synthesized on demand) ───────
    if (edgeCategories.has('entity-mention') && nodeMap.size < maxNodes) {
        const wantPersons = nodeTypes.has('person');
        const wantPlaces  = nodeTypes.has('place');
        const wantEvents  = nodeTypes.has('event');

        const [persons, places, events] = await Promise.all([
            wantPersons ? getPersonsByVerse(osisId) : Promise.resolve([]),
            wantPlaces  ? getPlacesByVerse(osisId)  : Promise.resolve([]),
            wantEvents  ? getEventsByVerse(osisId)  : Promise.resolve([]),
        ]);

        const verseNId = verseNodeId(osisId);

        for (const person of persons) {
            if (nodeMap.size >= maxNodes) { wasTruncated = true; break; }
            const nId = personNodeId(person.id);
            edgeMap.set(entityMentionEdgeId(osisId, nId), {
                id: entityMentionEdgeId(osisId, nId),
                source: verseNId,
                target: nId,
                category: 'entity-mention',
                type: 'person',
                weight: 1,
            });
            if (!nodeMap.has(nId)) {
                nodeMap.set(nId, { id: nId, type: 'person', label: person.name, data: person });
            }
        }

        for (const place of places) {
            if (nodeMap.size >= maxNodes) { wasTruncated = true; break; }
            const nId = placeNodeId(place.id);
            edgeMap.set(entityMentionEdgeId(osisId, nId), {
                id: entityMentionEdgeId(osisId, nId),
                source: verseNId,
                target: nId,
                category: 'entity-mention',
                type: 'place',
                weight: 1,
            });
            if (!nodeMap.has(nId)) {
                nodeMap.set(nId, { id: nId, type: 'place', label: place.name, data: place });
            }
        }

        for (const event of events) {
            if (nodeMap.size >= maxNodes) { wasTruncated = true; break; }
            const nId = eventNodeId(event.id);
            edgeMap.set(entityMentionEdgeId(osisId, nId), {
                id: entityMentionEdgeId(osisId, nId),
                source: verseNId,
                target: nId,
                category: 'entity-mention',
                type: 'event',
                weight: 1,
            });
            if (!nodeMap.has(nId)) {
                nodeMap.set(nId, { id: nId, type: 'event', label: event.name, data: event });
            }
        }
    }

    // Entity nodes (persons/places/events) do NOT go into newVerseNodes —
    // they are terminal and will not be expanded on the next hop.
    return { newVerseNodes, wasTruncated };
}

// ─── Public API ───────────────────────────────────────────

/**
 * Build a bounded neighborhood subgraph centered on a verse node.
 *
 * Performs a BFS up to `hops` hops away from the seed node:
 *   - Hop 1: all verses/entities directly linked to the seed
 *   - Hop 2: all verses/entities linked to those verses (entity nodes don't expand)
 *   - etc.
 *
 * The engine enforces a hard node cap (default 120) and returns
 * `truncated: true` when the cap is reached. The seed node is always
 * included even if the cap is 0.
 *
 * @param nodeId   Namespaced verse node ID, e.g. "verse:Gen.1.1"
 * @param hops     BFS depth (1 = direct neighbours only; max useful is ~3)
 * @param filters  Optional: limit edge categories, edge subtypes, node types, or cap
 *
 * @returns Deduplicated nodes and edges; truncated flag; no UI assumptions.
 */
export async function getNeighborhood(
    nodeId: string,
    hops: number,
    filters: GraphFilters = {},
): Promise<NeighborhoodResult> {
    const maxNodes = filters.maxNodes ?? DEFAULT_MAX_NODES;

    const osisId = osisFromVerseNodeId(nodeId);
    if (!osisId) {
        // Phase 3 only supports verse: as the starting node.
        // Person/place/event starting nodes are deferred to Phase 4.
        return { nodes: [], edges: [], truncated: false };
    }

    const nodeMap = new Map<string, GraphNode>();
    const edgeMap = new Map<string, GraphEdge>();
    let wasTruncated = false;

    // Seed node is always included
    nodeMap.set(nodeId, makeVerseNode(osisId, formatVerseLabel(osisId)));

    let frontier = new Set<string>([nodeId]);

    for (let hop = 0; hop < hops; hop++) {
        if (frontier.size === 0) break;
        if (nodeMap.size >= maxNodes) { wasTruncated = true; break; }

        const nextFrontier = new Set<string>();

        for (const currentNodeId of frontier) {
            if (nodeMap.size >= maxNodes) { wasTruncated = true; break; }

            // Safety: only verse nodes ever reach the frontier, but guard explicitly
            const currentOsisId = osisFromVerseNodeId(currentNodeId);
            if (!currentOsisId) continue;

            const { newVerseNodes, wasTruncated: expanded } = await expandVerseNode(
                currentOsisId,
                filters,
                nodeMap,
                edgeMap,
                maxNodes,
            );

            if (expanded) wasTruncated = true;

            // Only verse nodes are eligible to expand further on the next hop
            for (const nId of newVerseNodes) {
                nextFrontier.add(nId);
            }
        }

        frontier = nextFrontier;
    }

    return {
        nodes: Array.from(nodeMap.values()),
        edges: Array.from(edgeMap.values()),
        truncated: wasTruncated,
    };
}

// ─── Book-level density matrix ────────────────────────────

/**
 * In-process cache for the book cross-reference density matrix.
 * The matrix is derived from static seeded data and only changes
 * after a full re-seed — safe to hold for the lifetime of the session.
 */
let _matrixCache: BookConnectionMatrix | null = null;

/**
 * Return the book-to-book cross-reference density matrix.
 *
 * On first call performs a full `crossReferences` table scan (~340K rows)
 * and caches the result. Subsequent calls return the cached value instantly.
 * Cache is invalidated by reloading the page (session-scoped).
 *
 * Access pattern: `matrix.get('Gen')?.get('John')` → edge count between books.
 *
 * @example
 * const matrix = await getBookCrossReferenceMatrix();
 * matrix.get('Matt')?.get('Isa'); // NT quotations of Isaiah from Matthew
 */
export async function getBookCrossReferenceMatrix(): Promise<BookConnectionMatrix> {
    if (_matrixCache) return _matrixCache;
    _matrixCache = await _getBookMatrix();
    return _matrixCache;
}
