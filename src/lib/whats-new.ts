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
        id: '2026-09-22',
        date: 'September 22, 2026',
        title: 'Data Lifecycle & Performance (v0.4.3)',
        sections: [
            {
                heading: 'A faster first start',
                items: [
                    {
                        lead: 'Reader first',
                        text: 'On a new device the reader opens as soon as the King James text is in. Cross-references, people and places, the lexicon and the topical index arrive behind it, a small strip shows what is still on its way, and each feature lights up the moment its data lands. No reload needed.',
                    },
                    {
                        lead: 'Install progress you can see',
                        text: 'The first-run screen lists every dataset with its size and a progress bar. If one fails, you retry that one alone instead of starting over.',
                    },
                    {
                        lead: 'Only what changed',
                        text: 'Every dataset now carries its own version. When we correct one, the next start replaces just that dataset instead of re-downloading everything.',
                    },
                ],
            },
            {
                heading: 'Search that answers at once',
                items: [
                    {
                        lead: 'Word Study',
                        text: 'Finding every occurrence of a word across five translations took over a second. It now takes a few milliseconds for most words, and the counts and lemma groups are the same as before.',
                    },
                    {
                        lead: 'Strong\'s numbers',
                        text: 'Strong\'s searches read a prebuilt index that installs with each tagged translation. Search right after installing one and the page says the index is still installing, then runs the search when it lands.',
                    },
                    {
                        lead: 'Lighter search caches',
                        text: 'Search indexes no longer keep a second copy of the scripture text, so they take less storage and load faster.',
                    },
                ],
            },
            {
                heading: 'Under the hood',
                items: [
                    {
                        text: 'The book-to-book link map behind the graph overview is computed once when the data is built, not on every visit.',
                    },
                    {
                        text: 'Every translation passes a corpus check before it ships: no missing verses, no leaked footnotes, no Strong\'s number attached to the wrong word.',
                    },
                ],
            },
        ],
    },
    {
        id: '2026-09-16',
        date: 'September 16, 2026',
        title: 'Design Foundations (v0.4.2)',
        sections: [
            {
                heading: 'A redesigned reading workspace',
                items: [
                    {
                        lead: 'Study Rail',
                        text: 'Who\'s here, word lookups, people and places, and lineage now share one tabbed panel on the right instead of four that kept replacing each other. Up to four tabs stay open as you move between chapters, the rail resizes by dragging its edge, and when it is empty it tells you what it can show. On a phone it slides up as a sheet.',
                    },
                    {
                        lead: 'Passage bar',
                        text: 'The top of the reader is now two zones. On the left: previous, next, and one book-and-chapter button that opens a picker you can type into (try "Ps 23" and Enter). Chapter pills stay for short books and fold into the button for long ones. On the right: what you see and how.',
                    },
                    {
                        lead: 'Layers',
                        text: 'Everything the reader can draw over the text lives in one menu: people and places, red letter, cross-references, verse numbers. The eye icon is gone; it is the Entities layer. Cross-reference badges start off on a fresh install and switch on here.',
                    },
                    {
                        lead: 'Navigation that scales',
                        text: 'The sidebar is grouped into Read, Study and System, folds to an icon rail with tooltips when a split needs the room, and the phone tab bar keeps five tabs.',
                    },
                    {
                        lead: 'Settings, rebuilt',
                        text: 'A section rail on the left, a live preview of your reading setup, an accent picker that checks contrast against both themes (and fixes it for the light one), a Library for every corpus, a Data card that exports and imports a backup, a storage breakdown, and the keyboard shortcuts.',
                    },
                ],
            },
            {
                heading: 'One interaction system',
                items: [
                    {
                        text: 'The accent colour now means one thing: something you can click or have selected. Attention (search hits, the verse you jumped to) is amber, people, places and events keep their own colours in both themes, and verse numbers step back onto the text ramp.',
                    },
                    {
                        text: 'Every choice-between-a-few control looks and works the same, with arrow keys, and the search page\'s mode switcher no longer shouts. Alt+M cycles search modes.',
                    },
                    {
                        text: 'Headings, row heights, spacing and type sizes come from one scale, and the Density setting now means what it says: the height of lists and panels, never the scripture column. Prose is the default layout; split view lines verses up.',
                    },
                    {
                        text: 'Accessibility: every icon-only control has a tooltip and a name for screen readers, keyboard focus is visible everywhere, control borders meet the contrast floor, and phone targets are 44px.',
                    },
                ],
            },
        ],
    },
    {
        id: '2026-09-14',
        date: 'September 14, 2026',
        title: 'Stability & Performance (v0.4.1)',
        sections: [
            {
                heading: 'New features',
                items: [
                    {
                        lead: 'Translation Manager',
                        text: 'The app now starts with just the KJV and downloads other translations only when you ask, from Settings. First load is far faster, and the translation pickers offer only what you actually have installed.',
                    },
                    {
                        lead: 'Undo and feedback',
                        text: 'Deleting a note, highlight, theme tag, or saved search now shows an Undo toast instead of destroying it outright. Copying, saving a note, and saving a search confirm themselves, and copied verses include their reference ("Genesis 1:1 (KJV)").',
                    },
                    {
                        lead: 'A real app icon',
                        text: 'Codex Scriptura finally has an icon in the browser tab, and it installs as a proper app on your phone or desktop home screen.',
                    },
                    {
                        lead: 'More settings',
                        text: 'Preferences that used to be buried or unreachable are now editable on the Settings page, and Reset to defaults asks before wiping them.',
                    },
                ],
            },
            {
                heading: 'Fixes and improvements',
                items: [
                    {
                        text: 'Word Study counts are honest again: "bless" now finds blessed, blessing, and blesseth; "glory" finds glories and gloried; apostrophe forms match too.',
                    },
                    {
                        text: 'Huge Word Study results (thousands of hits) no longer freeze the page - they load 50 at a time with a Show more button.',
                    },
                    {
                        text: 'Scripture data: Additions to Esther and 4 Maccabees are reachable again, 7 missing KJV Sirach verses are restored, and duplicate cross-references are cleaned up.',
                    },
                    {
                        text: 'In split view, a name like "Simon Peter" stays tappable even when the translations disagree on part of it, and the annotation sidebar now sticks to the pane that opened it.',
                    },
                    {
                        text: 'Note drafts survive closing and reopening the sidebar, and the Annotate page shows every annotation live.',
                    },
                    {
                        text: 'On mobile, Themes is back in the bottom tab bar, and the app no longer tries to cache its entire dataset up front.',
                    },
                ],
            },
        ],
    },
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
