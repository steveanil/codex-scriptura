import { describe, it, expect } from 'vitest';
import { commentaryBlockKeys, commentaryEntryProblem } from '@codex-scriptura/core';
import { excerptProvenance, type ProvenanceRecords, type TracedEntry } from './catena-provenance.js';
import type { PageReview } from './catena-review-queue.js';

const content = '> And the Word was with God.\n\n**Chrysostom.** (*Chrys. Hom. iv.*) Because it is an especial attribute.\n\n**Bede.** As if to say.\n\n**Augustine.** (*Aug. Tr. i.*) Or thus.\n\n**Theophylact.** (*ixoAou- Dicy*) Observe the order.';
const entry: TracedEntry = { id: 'catena-john-1-1', startRef: 'John.1.1', endRef: 'John.1.1', content, source: { item: 'scan', leafStart: 14, leafEnd: 16 }, item: 'scan', excerptLeaves: [14, 14, 15, 16] };
const review = (leaf: number, scope: PageReview['scope'], reviewer = 'Claude (AI model) reading the page image', reviewed = '2026-11-14'): PageReview =>
    ({ item: 'scan', leaf, scope, reviewer, reviewed, image: { bundle: 'b', sha256: 'a'.repeat(64), file: 'f' }, ocr: { document: 'd', sha256: 'b'.repeat(64) }, revision: 'abc1234', corrections: [], verdicts: [], questions: [], outcome: 'read', blockers: [] });
const none: ProvenanceRecords = { reviews: [], citationCorrections: [], questions: [] };
const of = (records: Partial<ProvenanceRecords>) => excerptProvenance([entry], { ...none, ...records }).get(entry.id)!;

describe('Catena excerpt provenance (issue #85)', () => {
    it('gives every excerpt a record bound to its own text and leaf, and no citation status where none is printed', () => {
        const got = of({});
        expect(got.map((x) => x.leaf)).toEqual([14, 14, 15, 16]);
        expect(got.map((x) => x.key)).toEqual(commentaryBlockKeys(content).slice(1));
        expect(got.map((x) => x.citation)).toEqual(['unverified', undefined, 'unverified', 'unverified']);
        expect(commentaryEntryProblem({ ...entry, excerpts: got })).toBeNull();
    });

    it('marks a citation checked only when the margin of every leaf the excerpt stands on was read', () => {
        // The Chrysostom excerpt begins on leaf 14 and the next begins there too; the Augustine one runs from 15 on to 16
        expect(of({ reviews: [review(14, 'margin citations')] }).map((x) => x.citation)).toEqual(['checked', undefined, 'unverified', 'unverified']);
        expect(of({ reviews: [review(15, 'whole page')] })[2].citation).toBe('unverified');
        const both = of({ reviews: [review(15, 'whole page', undefined, '2026-11-13'), review(16, 'margin citations')] })[2];
        expect(both).toMatchObject({ citation: 'checked', reviewed: '2026-11-14', reviewer: 'ai' });
        // A reading by strips is not a reading of the margin
        expect(of({ reviews: [review(14, 'strips')] })[0].citation).toBe('unverified');
    });

    it('keeps who read the page: a person only when a person read every leaf', () => {
        expect(of({ reviews: [review(14, 'whole page', 'S. A. John')] })[0]).toMatchObject({ citation: 'checked', reviewer: 'human' });
        expect(of({ reviews: [review(15, 'whole page', 'S. A. John'), review(16, 'whole page')] })[2].reviewer).toBe('ai');
    });

    it('takes a citation corrected from the page image as checked, by an AI model unless the record says a person', () => {
        const fix = { item: 'scan', chapter: 1, verseStart: 1, verseEnd: 1, occurrence: 1, excerpt: 3, citation: 'Aug. Tr. i.', leaf: 15, note: 'Margin read on the page image, leaf 15, 2026-09-28.' };
        expect(of({ citationCorrections: [fix] })[2]).toEqual({ key: commentaryBlockKeys(content)[3], leaf: 15, citation: 'checked', reviewed: '2026-09-28', reviewer: 'ai' });
        expect(of({ citationCorrections: [{ ...fix, reviewer: 'human' }] })[2].reviewer).toBe('human');
        // A correction of the excerpt's text, with no citation, says nothing of the citation
        expect(of({ citationCorrections: [{ ...fix, citation: undefined }] })[2].citation).toBe('unverified');
    });

    it('lets an open question override a check, and shows a question about the text without touching the citation', () => {
        const q = { kind: 'source fidelity', status: 'open', issue: 429, item: 'scan', leaf: 16, entry: entry.id, question: 'What Greek does the margin print?', excerpt: 'ixoAou- Dicy', concerns: 'citation' as const };
        const reviews = [review(16, 'whole page')];
        expect(of({ reviews })[3].citation).toBe('checked');
        expect(of({ reviews, questions: [q] })[3]).toEqual({ key: commentaryBlockKeys(content)[4], leaf: 16, citation: 'unresolved', question: q.question, issue: 429 });
        expect(of({ reviews, questions: [{ ...q, concerns: 'text' as const }] })[3]).toMatchObject({ citation: 'checked', question: q.question });
        // A question that is closed, or bound to no excerpt, marks nothing
        expect(of({ reviews, questions: [{ ...q, status: 'resolved' }] })[3].citation).toBe('checked');
        expect(of({ reviews, questions: [{ ...q, excerpt: undefined }] })[3].question).toBeUndefined();
    });

    it('marks an excerpt possibly incomplete, with every leaf it runs over, when its question stands for a gate finding', () => {
        const q = { kind: 'source fidelity', status: 'open', item: 'scan', leaf: 15, entry: entry.id, question: 'Is a line missing?', excerpt: 'Or thus', concerns: 'text' as const, finding: `${entry.id}#3` };
        const got = of({ questions: [q] });
        // The Augustine excerpt begins on leaf 15 and the next begins on 16
        expect(got[2]).toEqual({ key: commentaryBlockKeys(content)[3], leaf: 15, citation: 'unverified', question: q.question, text: 'possibly-incomplete', leafEnd: 16 });
        expect(got.filter((x) => x.text)).toHaveLength(1);
        expect(commentaryEntryProblem({ ...entry, excerpts: got })).toBeNull();
        // A question about the text that defers no finding does not claim words are missing
        expect(of({ questions: [{ ...q, finding: undefined }] })[2].text).toBeUndefined();
    });

    it('refuses a question whose excerpt is not found once, so a question never lapses silently', () => {
        const q = { kind: 'attribution', status: 'open', item: 'scan', leaf: 14, entry: entry.id, question: 'Whose?', excerpt: 'not in the text' };
        expect(() => of({ questions: [q] })).toThrow(/is in 0 excerpts/);
        expect(() => of({ questions: [{ ...q, excerpt: 'Or thus' }, { ...q, excerpt: '.' }] })).toThrow(/is in 4 excerpts/);
        expect(() => of({ questions: [{ ...q, entry: 'catena-gone' }] })).toThrow(/not an entry of the corpus/);
    });
});
