import type { UserPreferences } from '@codex-scriptura/core';
import { db } from './database.js';

// ─── Default Preferences ──────────────────────────────────

const DEFAULT_PREFERENCES: Omit<UserPreferences, 'id'> = {
    activeTranslation: 'KJV',
    theme: 'dark',
    accentColor: '#5e9ed6',
    fonts: {
        ui: 'Instrument Sans',
        reader: 'Newsreader',
        greek: 'SBL Greek',
        hebrew: 'SBL Hebrew',
        size: 19,
    },
    reader: {
        lineHeight: 1.95,
        columnWidth: 'medium',
        density: 'normal',
        showVerseNumbers: true,
        showRedLetters: true,
        paragraphMode: true,
    },
    highlightPresets: [
        { id: 'yellow', name: 'Yellow', color: '#f59e0b' },
        { id: 'green',  name: 'Green',  color: '#22c55e' },
        { id: 'blue',   name: 'Blue',   color: '#3b82f6' },
        { id: 'pink',   name: 'Pink',   color: '#ec4899' },
    ],
    readingSpeed: 200,
    startup: { mode: 'last', book: 'Gen', chapter: 1 },
    lastBook: 'Gen',
    lastChapter: 1,
};

/** Get user preferences (singleton). */
export async function getSettings(): Promise<UserPreferences> {
    const prefs = await db.settings.get('default');
    return prefs ?? { id: 'default', ...DEFAULT_PREFERENCES };
}

/** Save user preferences. */
export async function saveSettings(prefs: UserPreferences): Promise<void> {
    await db.settings.put(prefs);
}

// ─── v0.3.0 Preferences API ───────────────────────────────

/** Reset user preferences to factory defaults and return them. */
export async function resetUserPreferencesToDefaults(): Promise<UserPreferences> {
    const defaults: UserPreferences = { id: 'default', ...DEFAULT_PREFERENCES };
    await db.settings.put(defaults);
    return defaults;
}

// ─── Key-Value Store ──────────────────────────────────────

/** Read an app-state value from the kv table. */
export async function getKv<T>(id: string): Promise<T | undefined> {
    const rec = await db.kv.get(id);
    return rec?.value as T | undefined;
}

/** Write an app-state value to the kv table. Values must be structured-cloneable (no reactive proxies - snapshot first). */
export async function setKv(id: string, value: unknown): Promise<void> {
    await db.kv.put({ id, value });
}

/** Delete an app-state value from the kv table. */
export async function deleteKv(id: string): Promise<void> {
    await db.kv.delete(id);
}
