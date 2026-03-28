import { getSettings, saveSettings, resetUserPreferencesToDefaults } from '@codex-scriptura/db';
import type { UserPreferences } from '@codex-scriptura/core';

// ─── Preferences Store ─────────────────────────────────────
// Singleton Svelte 5 rune-based store wrapping IndexedDB settings.
// Writes are debounced 500ms to prevent IndexedDB thrashing.

function createPreferencesStore() {
    let prefs = $state<UserPreferences | null>(null);
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    async function load(): Promise<void> {
        prefs = await getSettings();
    }

    function update(partial: Partial<Omit<UserPreferences, 'id'>>): void {
        if (!prefs) return;
        prefs = { ...prefs, ...partial };
        scheduleSave();
    }

    function scheduleSave(): void {
        if (saveTimer !== null) clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
            if (prefs) await saveSettings(prefs);
            saveTimer = null;
        }, 500);
    }

    async function reset(): Promise<void> {
        prefs = await resetUserPreferencesToDefaults();
    }

    return {
        get value(): UserPreferences | null {
            return prefs;
        },
        load,
        update,
        reset,
    };
}

export const preferences = createPreferencesStore();
