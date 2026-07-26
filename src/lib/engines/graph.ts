/**
 * Graph neighborhood engine - Phase 3.
 *
 * Builds bounded BFS subgraphs centered on a verse node by combining:
 *   - Stored cross-reference edges from the Dexie `crossReferences` table
 *   - Synthesized entity-mention edges derived on demand from verseRefs
 *
 * Hard constraints (non-negotiable):
 *   - Default node cap: 120. Never returns more nodes than maxNodes.
 *   - Entity nodes are terminal leaves - they do not expand further.
 *     Only verse nodes propagate the BFS frontier to the next hop.
 *   - No DB writes. Pure read + in-memory synthesis.
 *
 * Starting nodes (issue #21): `verse:` seeds expand along cross-references
 * and entity mentions; `person:`/`place:`/`event:` seeds expand to the
 * entity's verses on hop 1 (the one exception to entities-are-terminal),
 * and those verses continue the BFS normally.
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
    getCrossReferencesFromBook,
    getCrossReferencesToBook,
    getPersonsByVerse,
    getPlacesByVerse,
    getEventsByVerse,
    getPersonById,
    getPlaceById,
    getEventById,
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

type EntitySeed = { type: 'person' | 'place' | 'event'; id: string };

/**
 * Parse an entity node ID into its type and bare record ID.
 * "person:moses_1" → { type: 'person', id: 'moses_1' }; null for others.
 */
function parseEntityNodeId(nodeId: string): EntitySeed | null {
    const sep = nodeId.indexOf(':');
    if (sep === -1) return null;
    const type = nodeId.slice(0, sep);
    if (type !== 'person' && type !== 'place' && type !== 'event') return null;
    const id = nodeId.slice(sep + 1);
    return id ? { type, id } : null;
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
 * for BFS expansion on the next hop. Entity nodes are NOT returned here -
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

            // Resolve both endpoint nodes BEFORE committing the edge, so the
            // result never contains an edge pointing at a node that isn't in
            // the node set (consumers must not need a dangling-edge filter).
            const endpoints = [ref.sourceVerse, ref.targetVerse].map((refOsisId) => ({
                osisId: refOsisId,
                nId: verseNodeId(refOsisId),
            }));
            const missing = endpoints.filter(({ nId }) => !nodeMap.has(nId));

            if (missing.length > 0) {
                // Endpoints excluded by the node-type filter → edge unrepresentable
                if (!nodeTypes.has('verse')) continue;
                // Not enough capacity for every missing endpoint → skip edge, flag cap
                if (nodeMap.size + missing.length > maxNodes) {
                    wasTruncated = true;
                    continue;
                }
                for (const { osisId: missingOsisId, nId } of missing) {
                    nodeMap.set(nId, makeVerseNode(missingOsisId, formatVerseLabel(missingOsisId)));
                    newVerseNodes.add(nId);
                }
            }

            const edge = crossReferenceToGraphEdge(ref);
            edgeMap.set(edge.id, edge); // idempotent - same edge from both endpoints
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

    // Entity nodes (persons/places/events) do NOT go into newVerseNodes -
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
 * @param nodeId   Namespaced node ID: "verse:Gen.1.1", "person:moses_1",
 *                 "place:jerusalem_1", or "event:exodus_1"
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
    const entitySeed = osisId ? null : parseEntityNodeId(nodeId);
    if (!osisId && !entitySeed) {
        // book:/chapter: (and malformed) starting nodes are not supported.
        return { nodes: [], edges: [], truncated: false };
    }

    const nodeMap = new Map<string, GraphNode>();
    const edgeMap = new Map<string, GraphEdge>();
    let wasTruncated = false;
    let frontier = new Set<string>();
    let verseHops = hops;

    if (osisId) {
        // Seed node is always included
        nodeMap.set(nodeId, makeVerseNode(osisId, formatVerseLabel(osisId)));
        frontier.add(nodeId);
    } else if (entitySeed) {
        const record =
            entitySeed.type === 'person' ? await getPersonById(entitySeed.id)
            : entitySeed.type === 'place' ? await getPlaceById(entitySeed.id)
            : await getEventById(entitySeed.id);
        // Unlike verses (constructible from their OSIS ID alone), an entity
        // seed needs its stored record - without it there is nothing to show.
        if (!record) return { nodes: [], edges: [], truncated: false };
        nodeMap.set(nodeId, { id: nodeId, type: entitySeed.type, label: record.name, data: record });

        // Hop 1: the seed's verses - the one exception to entities-are-
        // terminal (issue #21). Obeys the same filters as synthesized
        // entity-mention edges; the surviving verses carry the BFS on.
        const edgeCategories = new Set(
            filters.edgeCategories ?? (['cross-reference', 'entity-mention'] as const)
        );
        const nodeTypes = new Set(
            filters.nodeTypes ?? (['verse', 'person', 'place', 'event', 'book', 'chapter'] as const)
        );
        if (hops > 0 && edgeCategories.has('entity-mention') && nodeTypes.has('verse')) {
            for (const refOsisId of record.verseRefs ?? []) {
                if (nodeMap.size >= maxNodes) { wasTruncated = true; break; }
                const verseNId = verseNodeId(refOsisId);
                if (!nodeMap.has(verseNId)) {
                    nodeMap.set(verseNId, makeVerseNode(refOsisId, formatVerseLabel(refOsisId)));
                    frontier.add(verseNId);
                }
                // Same direction convention as expandVerseNode: verse → entity
                edgeMap.set(entityMentionEdgeId(refOsisId, nodeId), {
                    id: entityMentionEdgeId(refOsisId, nodeId),
                    source: verseNId,
                    target: nodeId,
                    category: 'entity-mention',
                    type: entitySeed.type,
                    weight: 1,
                });
            }
        }
        verseHops = hops - 1;
    }

    for (let hop = 0; hop < verseHops; hop++) {
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

// ─── Chapter-level connections (mid zoom) ─────────────────

/**
 * Connections for each chapter of a focused book.
 *
 * Keyed by chapter number. Each value maps a namespaced neighbor node ID
 * to the number of cross-reference links between that chapter and the
 * neighbor:
 *   - `chapter:Gen.2`  - another chapter of the SAME book
 *   - `book:Isa`       - a different book, aggregated to book level
 *
 * This is the data model for the graph's mid zoom level: the focused
 * book explodes into chapter nodes while everything external stays
 * collapsed at book granularity.
 */
export type ChapterConnections = Map<number, Map<string, number>>;

/** Parse "Gen.12.3" → { book: 'Gen', chapter: 12 }; null when malformed. */
function bookChapterOf(osisId: string): { book: string; chapter: number } | null {
    const parts = osisId.split('.');
    if (parts.length < 2) return null;
    const chapter = parseInt(parts[1], 10);
    if (!Number.isFinite(chapter)) return null;
    return { book: parts[0], chapter };
}

/**
 * Aggregate all cross-references touching `book` into per-chapter
 * connection counts. Same-book links produce `chapter:` neighbors on
 * both chapters; cross-book links produce `book:` neighbors.
 */
export async function getChapterConnections(book: string): Promise<ChapterConnections> {
    const [outbound, inbound] = await Promise.all([
        getCrossReferencesFromBook(book),
        getCrossReferencesToBook(book),
    ]);

    const result: ChapterConnections = new Map();

    const add = (chapter: number, neighborId: string, weight: number) => {
        let row = result.get(chapter);
        if (!row) { row = new Map(); result.set(chapter, row); }
        row.set(neighborId, (row.get(neighborId) ?? 0) + weight);
    };

    const record = (localOsis: string, remoteOsis: string) => {
        const local = bookChapterOf(localOsis);
        const remote = bookChapterOf(remoteOsis);
        if (!local || !remote) return;
        if (remote.book === book) {
            if (remote.chapter === local.chapter) return; // intra-chapter link - invisible at this zoom
            add(local.chapter, `chapter:${book}.${remote.chapter}`, 1);
        } else {
            add(local.chapter, `book:${remote.book}`, 1);
        }
    };

    for (const ref of outbound) {
        record(ref.sourceVerse, ref.targetVerse);
        // Same-book refs connect two focused chapters - record both sides
        if (ref.targetVerse.startsWith(`${book}.`)) {
            record(ref.targetVerse, ref.sourceVerse);
        }
    }
    for (const ref of inbound) {
        // Same-book refs already handled in the outbound pass (both endpoints
        // match the book prefix) - skip them here to avoid double counting.
        if (ref.sourceVerse.startsWith(`${book}.`)) continue;
        record(ref.targetVerse, ref.sourceVerse);
    }

    return result;
}

// ─── Book-level density matrix ────────────────────────────

/**
 * In-process cache for the book cross-reference density matrix.
 * The matrix is derived from static seeded data and only changes
 * after a full re-seed - safe to hold for the lifetime of the session.
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
