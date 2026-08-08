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

/** One bullet: `lead` renders bold as the feature name, `text` is the plain-language description. */
export type WhatsNewItem = {
    lead?: string;
    text: string;
};

/** A grouped block within an entry, e.g. "New features" or "Fixes and improvements". */
export type WhatsNewSection = {
    heading: string;
    items: WhatsNewItem[];
};

export type WhatsNewEntry = {
    /** Unique, newest-first sortable id, e.g. "2026-07-19" */
    id: string;
    /** Human date shown in the header, e.g. "July 19, 2026" */
    date: string;
    title: string;
    sections: WhatsNewSection[];
};

export const WHATS_NEW: WhatsNewEntry[] = [
    {
        id: '2026-08-08',
        date: 'August 8, 2026',
        title: 'Deep Study complete (v0.4.0)',
        sections: [
            {
                heading: 'New features',
                items: [
                    {
                        lead: 'Scratch pad',
                        text: 'A notepad that floats over the reader and follows you across books and chapters (Cmd/Ctrl+Shift+P). Quote verses into it with the Scratch button or by dragging a verse number in, and when a jotting matures, promote it into a real note anchored to its verses.',
                    },
                    {
                        lead: 'Split view, finished',
                        text: 'Scroll panes together, drag the divider to resize, toggle with Cmd/Ctrl+\\. Put the same chapter in two translations and the wording that differs is shaded - the Divergence Map lists every verse where they disagree.',
                    },
                    {
                        lead: 'Topical search',
                        text: 'Type a subject like "faith" or "prayer" and get the passages Nave\'s Topical Bible files under it, right alongside your word results.',
                    },
                    {
                        lead: 'Neighborhood view',
                        text: 'Pick any verse or person in the Scripture Graph and see everything connected to it, one or two hops out.',
                    },
                ],
            },
            {
                heading: 'Fixes and improvements',
                items: [
                    {
                        text: 'Notes and highlights now appear everywhere the moment you save them - every pane, every tab.',
                    },
                    {
                        text: 'Word Study now works in the World English Bible: its words are matched back to the Hebrew and Greek originals.',
                    },
                    {
                        text: 'Fixed about 950 ASV verses where punctuation had drifted away from its word ("said she , God").',
                    },
                    {
                        text: 'Updates now reach you reliably - a caching bug could leave the app stuck on an old version after a deploy.',
                    },
                ],
            },
        ],
    },
    {
        id: '2026-07-19',
        date: 'July 19, 2026',
        title: 'Deep study tools',
        sections: [
            {
                heading: 'Highlights',
                items: [
                    { text: 'Word Study understands Strong\'s numbers: type H430 or G26 (or tap a lexicon entry) to see every occurrence of the underlying Hebrew or Greek word.' },
                    { text: 'Lexicon cards now show how to say each word - "elohiym (el-o-heem\')" - beside the transliteration.' },
                    { text: 'Places open with a map right in the reader, and coordinate badges now reflect how certain the location really is.' },
                    { text: 'Six translations to compare: KJV, WEB, ASV, BSB, Darby, and Young\'s Literal.' },
                    { text: 'Split view: read up to three passages or translations side by side.' },
                ],
            },
        ],
    },
];

/** The id the seen-tracker stores; a mismatch means there is news to show. */
export const LATEST_UPDATE_ID = WHATS_NEW[0].id;
