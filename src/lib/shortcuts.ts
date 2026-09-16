/**
 * The keyboard shortcuts that exist (Settings > Shortcuts lists them; the
 * feature inventory in docs/features.md mirrors this). Read-only until
 * remapping lands with the plugin runtime.
 */
export type Shortcut = {
    id: string;
    label: string;
    /** Keys as shown; `mod` renders as ⌘ on Mac and Ctrl elsewhere. */
    keys: string[];
    /** Where it works. */
    scope: 'global' | 'reader' | 'search' | 'palette';
};

export const SHORTCUTS: Shortcut[] = [
    { id: 'palette', label: 'Command palette', keys: ['mod', 'K'], scope: 'global' },
    { id: 'split', label: 'Toggle split view', keys: ['mod', '\\'], scope: 'reader' },
    { id: 'scratch', label: 'Toggle scratch pad', keys: ['mod', '⇧', 'P'], scope: 'reader' },
    { id: 'back', label: 'Back through chapter history', keys: ['Alt', '←'], scope: 'reader' },
    { id: 'range', label: 'Select a verse range', keys: ['⇧', 'click'], scope: 'reader' },
    { id: 'lookup', label: 'Look up a word', keys: ['double-click'], scope: 'reader' },
    { id: 'search-mode', label: 'Cycle the search mode', keys: ['Alt', 'M'], scope: 'search' },
    { id: 'segmented', label: 'Move a segmented choice', keys: ['←', '→'], scope: 'global' },
    { id: 'palette-nav', label: 'Move and open palette results', keys: ['↑', '↓', 'Enter'], scope: 'palette' },
    { id: 'escape', label: 'Close menus, pickers and popovers', keys: ['Esc'], scope: 'global' },
];

export function renderKey(key: string, isMac: boolean): string {
    if (key === 'mod') return isMac ? '⌘' : 'Ctrl';
    return key;
}
