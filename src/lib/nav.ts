/**
 * The sidebar, as data (issue #245).
 *
 * Three groups and a placement rule, so the rail cannot grow one item at a
 * time into a twelve-entry list:
 *   Read   - the reader. New text corpora (manuscripts, Fathers, commentary)
 *            arrive as pane types inside it, never as nav items.
 *   Study  - tools that operate on scripture: search, graph, themes,
 *            annotations. A new study tool is a Study Rail tab first; it
 *            earns a nav entry only when it is a workspace of its own.
 *   System - the app about itself: settings, what's new, and later stats
 *            and plugins.
 * Only a new workspace earns nav. Everything else is a pane type, a rail
 * tab, or a Settings section.
 */
export type NavItem = {
    id: string;
    label: string;
    /** Route for links; absent for items that run an action instead. */
    href?: string;
    /** Non-route items: what pressing them does. */
    action?: 'annotate' | 'whats-new';
    /** SVG path data drawn in a 24x24 viewBox with the nav stroke style. */
    icon: string;
};

export type NavGroup = {
    id: 'read' | 'study' | 'system';
    label: string;
    items: NavItem[];
};

const ICON = {
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />',
    search: '<circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />',
    graph: '<circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M8.5 8.5l7 7" /><path d="M15.5 8.5l-7 7" /><path d="M8.5 6h7" /><path d="M6 8.5v7" />',
    tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" />',
    pen: '<path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />',
    sparkle: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z" /><path d="M19 15l.7 2.1L21.8 18l-2.1.7L19 20.8l-.7-2.1-2.1-.7 2.1-.9z" />',
    gear: '<circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />',
};

export const NAV_GROUPS: NavGroup[] = [
    {
        id: 'read',
        label: 'Read',
        items: [{ id: 'read', label: 'Read', href: '/read', icon: ICON.book }],
    },
    {
        id: 'study',
        label: 'Study',
        items: [
            { id: 'search', label: 'Search', href: '/search', icon: ICON.search },
            { id: 'graph', label: 'Graph', href: '/graph', icon: ICON.graph },
            { id: 'themes', label: 'Themes', href: '/themes', icon: ICON.tag },
            { id: 'annotate', label: 'Annotations', href: '/read', action: 'annotate', icon: ICON.pen },
        ],
    },
    {
        id: 'system',
        label: 'System',
        items: [
            { id: 'whats-new', label: "What's new", action: 'whats-new', icon: ICON.sparkle },
            { id: 'settings', label: 'Settings', href: '/settings', icon: ICON.gear },
        ],
    },
];

/** The phone tab bar has five slots and no groups; Annotations lives inside the reader there. */
export const MOBILE_NAV: NavItem[] = [
    NAV_GROUPS[0].items[0],
    ...NAV_GROUPS[1].items.filter((i) => i.id !== 'annotate'),
    NAV_GROUPS[2].items.find((i) => i.id === 'settings')!,
];
