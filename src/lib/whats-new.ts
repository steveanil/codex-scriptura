/**
 * In-app "What's New" feed (pilot-testing.md update loop).
 *
 * Newest entry first. The `id` must be unique per entry (date-based by
 * convention) - it is what the seen-tracker in the kv store compares
 * against, independent of the release-tag cadence, so a mid-version
 * deploy can still announce itself.
 *
 * Release process: append an entry here whenever a deploy ships
 * user-visible changes (see docs/release-process.md). Write for the
 * reader of the app, not the reader of the commit log.
 */

export type WhatsNewEntry = {
    /** Unique, newest-first sortable id, e.g. "2026-07-19" */
    id: string;
    /** Human date shown in the header, e.g. "July 19, 2026" */
    date: string;
    title: string;
    highlights: string[];
};

export const WHATS_NEW: WhatsNewEntry[] = [
    {
        id: '2026-08-08',
        date: 'August 8, 2026',
        title: 'Deep Study complete',
        highlights: [
            'Scratch pad: a persistent notepad that floats over the reader (Cmd/Ctrl+Shift+P). Quote verses into it from the selection toolbar or by dragging a verse number, and promote a jotting into a proper anchored note when it matures.',
            'Split view, finished: scroll panes together, drag the divider to resize, toggle with Cmd/Ctrl+\\. Showing the same chapter in two translations shades the wording that differs, and the Divergence Map lists every verse where they disagree.',
            'Topical search: type a subject like "faith" or "prayer" and get the passages Nave\'s Topical Bible files under it, right alongside word results.',
            'The Scripture Graph now opens a neighborhood view for any verse or person - see everything connected one or two hops out.',
            'Notes and highlights update live everywhere - every pane, every tab - the moment you save them.',
            'Fixed roughly 950 ASV verses that had punctuation floating away from words ("said she , God").',
        ],
    },
    {
        id: '2026-07-19',
        date: 'July 19, 2026',
        title: 'Deep study tools',
        highlights: [
            'Word Study understands Strong\'s numbers: type H430 or G26 (or tap a lexicon entry) to see every occurrence of the underlying Hebrew or Greek word.',
            'Lexicon cards now show how to say each word - "elohiym (el-o-heem\')" - beside the transliteration.',
            'Places open with a map right in the reader, and coordinate badges now reflect how certain the location really is.',
            'Six translations to compare: KJV, WEB, ASV, BSB, Darby, and Young\'s Literal.',
            'Split view: read up to three passages or translations side by side.',
        ],
    },
];

/** The id the seen-tracker stores; a mismatch means there is news to show. */
export const LATEST_UPDATE_ID = WHATS_NEW[0].id;
