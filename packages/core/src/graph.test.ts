import { describe, expect, it } from 'vitest';
import {
    verseNodeId,
    bookNodeId,
    chapterNodeId,
    personNodeId,
    placeNodeId,
    eventNodeId,
    crossReferenceToGraphEdge,
    makeVerseNode,
} from './graph.js';
import type { CrossReference } from './types.js';

describe('node ID constructors', () => {
    it('namespace IDs by type to prevent cross-domain collisions', () => {
        expect(verseNodeId('Gen.1.1')).toBe('verse:Gen.1.1');
        expect(bookNodeId('Mark')).toBe('book:Mark');
        expect(chapterNodeId('Gen', 1)).toBe('chapter:Gen.1');
        expect(personNodeId('mark_1')).toBe('person:mark_1');
        expect(placeNodeId('jerusalem_1')).toBe('place:jerusalem_1');
        expect(eventNodeId('exodus_1')).toBe('event:exodus_1');
        // The book "Mark" and a person named Mark must never share a node ID
        expect(bookNodeId('Mark')).not.toBe(personNodeId('Mark'));
    });
});

describe('crossReferenceToGraphEdge', () => {
    it('maps a stored CrossReference onto a GraphEdge, preserving the deterministic ID', () => {
        const ref: CrossReference = {
            id: 'Matt.4.4→Deut.8.3',
            sourceVerse: 'Matt.4.4',
            targetVerse: 'Deut.8.3',
            type: 'quotation',
            votes: 42,
        };
        expect(crossReferenceToGraphEdge(ref)).toEqual({
            id: 'Matt.4.4→Deut.8.3',
            source: 'verse:Matt.4.4',
            target: 'verse:Deut.8.3',
            category: 'cross-reference',
            type: 'quotation',
            weight: 42,
        });
    });
});

describe('makeVerseNode', () => {
    it('builds a typed verse node with the supplied label', () => {
        expect(makeVerseNode('Gen.1.1', 'Gen 1:1')).toEqual({
            id: 'verse:Gen.1.1',
            type: 'verse',
            label: 'Gen 1:1',
            data: undefined,
        });
    });
});
