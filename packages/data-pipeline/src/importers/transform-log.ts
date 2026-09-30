/**
 * An automatic change the reader made to the recognised text (issue #85):
 * a cut, a join, a repaired word, a mark taken out. Every one is recorded
 * with where it was made, so the effect of a rule across the corpus can be
 * audited instead of trusted.
 */
export type Transform = { rule: string; from: string; to: string; item?: string; leaf?: number };
export type TransformLog = (t: Transform) => void;
/** A log already bound to the page it is reading. */
export type Note = (rule: string, from: string, to: string) => void;
