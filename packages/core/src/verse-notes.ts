/**
 * Translator footnotes and cross-reference notes carried on a verse
 * (issue #39). The pipeline stores them as a JSON string in
 * `RawVerse.notes` / `VerseRecord.notes`, like `align` and `wj`: never
 * HTML, only runs of text the reader escapes itself.
 */

/** A piece of a note: plain text, a styled phrase, or a link to a passage. */
export type NoteRun =
    | string
    // catch = the words being annotated, alt = an alternative rendering
    | { t: string; s: 'catch' | 'alt' }
    // ref = canonical OSIS id, e.g. "Exod.30.12"
    | { t: string; ref: string };

export type VerseNote = {
    /** Offset into the verse `text` where the callout sits (0..text.length). */
    at: number;
    /** Absent for a translator's footnote; 'xref' for a cross-reference note. */
    kind?: 'xref';
    /**
     * The omitted verse this note stands for, when the source hung it on a
     * verse with no text and the importer carried it to the verse before.
     */
    verse?: number;
    runs: NoteRun[];
};

function isRun(run: unknown): run is NoteRun {
    if (typeof run === 'string') return run.length > 0;
    if (!run || typeof run !== 'object') return false;
    const r = run as Record<string, unknown>;
    if (typeof r.t !== 'string' || r.t.length === 0) return false;
    if ('s' in r) return !('ref' in r) && (r.s === 'catch' || r.s === 'alt');
    return typeof r.ref === 'string' && r.ref.length > 0;
}

function isNote(note: unknown): note is VerseNote {
    if (!note || typeof note !== 'object') return false;
    const n = note as Record<string, unknown>;
    return (
        Number.isInteger(n.at) && (n.at as number) >= 0 &&
        (n.kind === undefined || n.kind === 'xref') &&
        (n.verse === undefined || (Number.isInteger(n.verse) && (n.verse as number) > 0)) &&
        Array.isArray(n.runs) && n.runs.length > 0 && n.runs.every(isRun)
    );
}

/** Parse a verse's `notes` JSON. Bad input gives [], and a malformed note is skipped rather than failing the rest. */
export function parseVerseNotes(json?: string): VerseNote[] {
    if (!json) return [];
    try {
        const notes: unknown = JSON.parse(json);
        return Array.isArray(notes) ? notes.filter(isNote) : [];
    } catch {
        return [];
    }
}
