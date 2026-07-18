import type { CrossReference, GraphEdge, GraphNode } from './types.js';

// ─── Canonical node ID constructors ───────────────────────
//
// All graph node IDs are namespaced with a type prefix so that verse IDs,
// person IDs, and book IDs from different namespaces can coexist without
// collision (e.g. a person named "Mark" vs the book "Mark").
//
// Format: "${type}:${domain-key}"
//   verse:Gen.1.1
//   book:Gen
//   chapter:Gen.1
//   person:moses_1
//   place:jerusalem_1
//   event:exodus_1

export function verseNodeId(osisId: string): string {
    return `verse:${osisId}`;
}

export function bookNodeId(osisBookId: string): string {
    return `book:${osisBookId}`;
}

/** osisBookId + chapter number, e.g. chapterNodeId("Gen", 1) → "chapter:Gen.1" */
export function chapterNodeId(osisBookId: string, chapter: number): string {
    return `chapter:${osisBookId}.${chapter}`;
}

export function personNodeId(id: string): string {
    return `person:${id}`;
}

export function placeNodeId(id: string): string {
    return `place:${id}`;
}

export function eventNodeId(id: string): string {
    return `event:${id}`;
}

// ─── Adapters ─────────────────────────────────────────────
//
// Adapters convert stored records into the generic GraphEdge/GraphNode shapes.
// They are pure functions - no DB access, no side effects.

/**
 * Normalize a stored CrossReference into a generic GraphEdge.
 *
 * - id:       reuses the existing deterministic CrossReference id
 * - source:   namespaced verse node id for the source passage
 * - target:   namespaced verse node id for the target passage
 * - category: 'cross-reference'
 * - type:     the CrossReferenceType (e.g. 'unclassified', 'quotation')
 * - weight:   community vote count - higher = stronger signal
 */
export function crossReferenceToGraphEdge(ref: CrossReference): GraphEdge {
    return {
        id: ref.id,
        source: verseNodeId(ref.sourceVerse),
        target: verseNodeId(ref.targetVerse),
        category: 'cross-reference',
        type: ref.type,
        weight: ref.votes,
    };
}

/**
 * Build a minimal verse GraphNode from its OSIS ID.
 * The caller supplies a label (formatted reference) since formatting
 * requires book metadata not available in this package.
 */
export function makeVerseNode(osisId: string, label: string, data?: unknown): GraphNode {
    return {
        id: verseNodeId(osisId),
        type: 'verse',
        label,
        data,
    };
}
