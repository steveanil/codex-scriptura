import { describe, it, expect } from 'vitest';
import { unreadableLines, lineStates, suggestionCounts, pageStatus, rankPages, unreadableProgress, type QueuePage } from './catena-review-queue.js';
import type { RapidOcrLine, RapidOcrPage } from './importers/rapidocr-json.js';

const ocrLine = (y1: number, text: string, score: number, o: Partial<RapidOcrLine> = {}): RapidOcrLine => ({ x1: 100, x2: 1300, y1, y2: y1 + 50, score, text, chars: [], ...o });
// Rendered 1600 wide from a 2000 wide scan: the reader's y is the OCR's times 1.25
const ocrPage = (...lines: RapidOcrLine[]): RapidOcrPage => ({ leaf: 138, width: 2000, height: 3000, rendered_width: 1600, rendered_height: 2400, lines });
const queued = (item: string, leaf: number, states: ('open' | 'unread' | 'corrected')[], suggestions: Partial<QueuePage['suggestions']> = {}): QueuePage => ({
    item, leaf,
    lines: states.map((state, i) => ({ y: 100 * i, y1: 80 * i, y2: 80 * i + 50, score: 0.5, text: 'a o p', state })),
    suggestions: { weighty: 0, other: 0, settled: 0, ...suggestions },
});

describe('Catena review queue (issue #85)', () => {
    describe('unreadable lines', () => {
        it('are column-wide lines the recogniser scored low, top to bottom', () => {
            const page = ocrPage(ocrLine(600, 'si o p os', 0.54), ocrLine(200, 'a readable line of the chain', 0.98), ocrLine(400, 'm shap au o', 0.55), ocrLine(800, 'Hom.', 0.4, { x1: 1350, x2: 1450 }));
            expect(unreadableLines(page).map((l) => l.text)).toEqual(['m shap au o', 'si o p os']);
        });

        it('leave out a box far taller than a line, which is a figure or a blank', () => {
            const page = ocrPage(ocrLine(200, 'one', 0.98), ocrLine(300, 'two', 0.98), ocrLine(400, 'three', 0.98), ocrLine(500, '日', 0.5, { y2: 950 }));
            expect(unreadableLines(page)).toEqual([]);
        });
    });

    describe('completion', () => {
        const page = ocrPage(ocrLine(200, 'titles, all of whom, he equally', 0.98), ocrLine(260, 'r', 0.5), ocrLine(320, 'selves from desiring', 0.98));
        const reader = [{ y: 250, main: 'titles, all of whom, he equally' }, { y: 325, main: 'r' }, { y: 400, main: 'selves from desiring' }];
        const fix = { item: 'item', leaf: 138, find: 'r', replace: 'forbids to practise deceit, that so by first keeping them-' };

        it('leaves a line open while no correction applies to the reader\'s line there', () => {
            expect(lineStates(page, reader, []).map((l) => l.state)).toEqual(['open']);
            expect(lineStates(page, reader, [{ ...fix, find: 'not on this leaf' }]).map((l) => l.state)).toEqual(['open']);
        });

        it('counts a line corrected by the correction the importer would apply to it', () => {
            expect(lineStates(page, reader, [{ ...fix, y: 325 }]).map((l) => l.state)).toEqual(['corrected']);
            // Placed by y, the correction is for another line: this one stays open
            expect(lineStates(page, reader, [{ ...fix, y: 400 }]).map((l) => l.state)).toEqual(['open']);
            expect(lineStates(ocrPage(ocrLine(260, 'o anq e o', 0.5)), [{ y: 325, main: 'o anq e o' }], [{ ...fix, find: 'anq e' }]).map((l) => l.state)).toEqual(['corrected']);
        });

        it('does not count a correction to another part of the reader\'s line', () => {
            const merged = [{ y: 325, main: 'continuing s a 1 1 s' }];
            const specks = ocrPage(ocrLine(260, 's a 1  1  s', 0.5));
            expect(lineStates(specks, merged, [{ item: 'item', leaf: 138, find: 'continuing', replace: 'continuing,' }]).map((l) => l.state)).toEqual(['open']);
            expect(lineStates(specks, merged, [{ item: 'item', leaf: 138, find: 'continuing s a 1 1 s', replace: 'continuing in sin. And the Lord forewarns us that He' }]).map((l) => l.state)).toEqual(['corrected']);
            // The reader read one of the specks as a word: the correction is of its whole line
            expect(lineStates(ocrPage(ocrLine(260, 'o anq e o nou yd', 0.5)), [{ y: 325, main: 'o anq e o now y d' }], [{ item: 'item', leaf: 138, find: 'o anq e o now y d', replace: 'hold out liberation' }]).map((l) => l.state)).toEqual(['corrected']);
            // The reading's first letters went to the margin: the correction holds the greater part of it
            const split = ocrPage(ocrLine(260, 'lo aqn e uedad u Adond', 0.6));
            expect(lineStates(split, [{ y: 325, main: 'n e u edad u A dond' }], [{ item: 'item', leaf: 138, find: 'n e u edad u A dond', replace: 'I am spending my own' }]).map((l) => l.state)).toEqual(['corrected']);
        });

        it('takes a line the reader dropped as restored only when a correction names it', () => {
            const dropped = reader.filter((l) => l.y !== 325);
            const longer = { item: 'item', leaf: 138, find: 'he equally', replace: 'he equally forbids to practise deceit, that so by first keeping them-' };
            expect(lineStates(page, dropped, []).map((l) => l.state)).toEqual(['unread']);
            // However much text a neighbour's correction adds, that proves nothing about this line
            expect(lineStates(page, dropped, [longer]).map((l) => l.state)).toEqual(['unread']);
            expect(lineStates(page, dropped, [{ ...longer, restores: 400 }]).map((l) => l.state)).toEqual(['unread']);
            expect(lineStates(page, dropped, [{ ...longer, restores: 325 }]).map((l) => l.state)).toEqual(['corrected']);
        });

        it('settles a suggestion by its verified record, whichever way it went', () => {
            const counts = suggestionCounts([
                { rule: 'dehyphen', from: 'a- b', to: 'ab', applied: true },
                { rule: 'lone-digit', from: 'x 1 y', to: 'x y', applied: true, verified: '2026-11-12' },
                { rule: 'one-as-I-by-pair', from: 'x 1 y', to: 'x I y', applied: false, verified: '2026-11-12' },
                { rule: 'lone-consonant', from: 'by y his', to: 'by his', applied: false },
                { rule: 'I-before-capital', from: 'I AUG.', to: 'AUG.', applied: false },
                { rule: 'lone-digit', from: 'x 2 y', to: 'x y', applied: false, span: '110@lemma13.18.1:130' },
            ]);
            expect(counts).toEqual({ weighty: 2, other: 1, settled: 2 });
        });

        it('calls a page done, partial or open from what is left on it', () => {
            expect(pageStatus(queued('a', 1, ['corrected'], { settled: 3 }))).toBe('done');
            expect(pageStatus(queued('a', 1, ['corrected', 'open']))).toBe('partial');
            expect(pageStatus(queued('a', 1, [], { other: 2, settled: 1 }))).toBe('partial');
            expect(pageStatus(queued('a', 1, ['unread'], { other: 2 }))).toBe('open');
        });

        it('never calls a page done while a question recorded against it is open', () => {
            expect(pageStatus({ ...queued('a', 1, ['corrected'], { settled: 3 }), questions: 1 })).toBe('partial');
            expect(pageStatus({ ...queued('a', 1, [], {}), questions: 1 })).toBe('partial');
            expect(pageStatus({ ...queued('a', 1, ['open'], {}), questions: 1 })).toBe('open');
            expect(pageStatus({ ...queued('a', 1, ['corrected'], { settled: 3 }), questions: 0 })).toBe('done');
            expect(rankPages([{ ...queued('a', 1, ['corrected'], {}), questions: 1 }]).map((p) => p.leaf)).toEqual([1]);
        });
    });

    describe('ordering', () => {
        const pages = [
            queued('b', 7, [], { other: 12 }),
            queued('a', 9, ['open'], {}),
            queued('a', 3, [], { weighty: 1 }),
            queued('a', 5, ['open', 'unread'], {}),
            queued('a', 2, ['corrected'], { settled: 4 }),
            queued('b', 4, ['corrected', 'open'], { other: 3 }),
            queued('a', 8, [], { other: 12 }),
        ];

        it('puts unreadable lines first, then scripture text and author tokens, then density, and drops finished pages', () => {
            expect(rankPages(pages).map((p) => `${p.item}${p.leaf}`)).toEqual(['a5', 'b4', 'a9', 'a3', 'a8', 'b7']);
        });

        it('gives the same order whatever order the pages come in', () => {
            expect(rankPages([...pages].reverse())).toEqual(rankPages(pages));
        });

        it('reports the unreadable-line pages still open, not the lines', () => {
            expect(unreadableProgress(pages)).toEqual({ pages: 4, pagesOpen: 3, lines: 6, linesOpen: 4, linesUnread: 1 });
        });
    });
});
