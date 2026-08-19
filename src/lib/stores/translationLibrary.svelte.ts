// ─── Translation Library Store (issue #238) ────────────────
// Runtime install/remove state for the translation catalog. Fresh profiles
// seed only the default translation at boot; everything else downloads on
// demand from the Settings Translation Manager or a reader picker. This
// store is the single source of truth for "what is installed" and for
// per-translation download/remove progress.

import { getTranslations, getInstalledTranslationIds } from '@codex-scriptura/db';
import type { Translation } from '@codex-scriptura/core';
import { installTranslation, removeTranslation } from '../seed';

export type LibraryEntryState = {
    downloading?: boolean;
    /** 0-1 insert progress while downloading. */
    progress?: number;
    removing?: boolean;
    /** Last install/remove error for this translation, cleared on retry. */
    error?: string;
};

function createTranslationLibrary() {
    let catalog = $state<Translation[]>([]);
    let installedIds = $state<Set<string>>(new Set());
    let entryState = $state<Record<string, LibraryEntryState>>({});
    let loaded = $state(false);

    async function refresh(): Promise<void> {
        const [translations, installed] = await Promise.all([
            getTranslations(),
            getInstalledTranslationIds(),
        ]);
        catalog = translations;
        installedIds = new Set(installed);
        loaded = true;
    }

    function setEntry(id: string, next: LibraryEntryState): void {
        entryState = { ...entryState, [id]: next };
    }

    return {
        /** Full catalog (installed and downloadable), from the translations table. */
        get catalog() {
            return catalog;
        },
        get installedIds() {
            return installedIds;
        },
        get loaded() {
            return loaded;
        },
        state(id: string): LibraryEntryState {
            return entryState[id] ?? {};
        },
        isInstalled(id: string): boolean {
            return installedIds.has(id);
        },
        refresh,

        /**
         * Make sure a translation is installed, downloading it if needed.
         * Returns true when it is available (already installed, or the
         * download succeeded); false on failure (error kept in state()).
         * Concurrent calls for the same id share the in-flight download.
         */
        async ensureInstalled(id: string): Promise<boolean> {
            if (installedIds.has(id)) return true;
            if (entryState[id]?.downloading) {
                // Poll the in-flight download rather than starting another.
                while (this.state(id).downloading) {
                    await new Promise((r) => setTimeout(r, 200));
                }
                return installedIds.has(id);
            }

            setEntry(id, { downloading: true, progress: 0 });
            try {
                await installTranslation(id, (fraction) => {
                    setEntry(id, { downloading: true, progress: fraction });
                });
                await refresh();
                setEntry(id, {});
                return true;
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`[library] Download of ${id} failed:`, err);
                setEntry(id, { error: message });
                return false;
            }
        },

        /**
         * Remove an installed translation's data. UX guards (last installed,
         * active in the reader) are enforced by the caller, which has the
         * context to explain them.
         */
        async remove(id: string): Promise<boolean> {
            if (entryState[id]?.removing) return false;
            setEntry(id, { removing: true });
            try {
                await removeTranslation(id);
                await refresh();
                setEntry(id, {});
                return true;
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`[library] Removing ${id} failed:`, err);
                setEntry(id, { error: message });
                return false;
            }
        },
    };
}

export const translationLibrary = createTranslationLibrary();

/**
 * Switch a reader pane to a translation, downloading it first when it isn't
 * installed yet (issue #238). Shared by the solo picker and the split-pane
 * headers. No-op on download failure - the picker's status line shows the
 * error from state().
 */
export async function requestPaneTranslation(
    pane: { translation: string; switchTranslation(id: string): Promise<void> },
    id: string,
): Promise<void> {
    if (id === pane.translation) return;
    if (!translationLibrary.isInstalled(id)) {
        const ok = await translationLibrary.ensureInstalled(id);
        if (!ok) return;
    }
    await pane.switchTranslation(id);
}
