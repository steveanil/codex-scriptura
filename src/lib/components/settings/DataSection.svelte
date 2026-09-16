<script lang="ts">
    import { onMount } from 'svelte';
    import Button from '$lib/components/ui/Button.svelte';
    import SettingsCard from './SettingsCard.svelte';
    import SettingRow from './SettingRow.svelte';
    import { preferences } from '$lib/stores/preferences.svelte';
    import { toast } from '$lib/stores/toast.svelte';
    import { getAllAnnotations } from '@codex-scriptura/db';
    import { applyBackup, exportBackup, lastExportAt, readBackupFile } from '$lib/utils/backup';
    import type { Backup, BackupSummary } from '$lib/utils/backup-format';
    import { formatDate } from '$lib/utils/format';

    let {
        storagePersisted,
        onRequestPersistence,
        onBackupState,
    }: {
        storagePersisted: boolean | null;
        onRequestPersistence: () => void;
        /** Tells the rail whether the Data section deserves its attention dot. */
        onBackupState?: (needsAttention: boolean) => void;
    } = $props();

    let annotationCount = $state<number | null>(null);
    let lastExport = $state<number | null>(null);
    let exporting = $state(false);
    let fileInput: HTMLInputElement | undefined = $state();
    let pending = $state<{ backup: Backup; summary: BackupSummary; name: string } | null>(null);
    let importError = $state<string | null>(null);
    let importing = $state(false);

    async function refresh() {
        const [anns, last] = await Promise.all([getAllAnnotations(), lastExportAt()]);
        annotationCount = anns.length;
        lastExport = last;
        onBackupState?.(anns.length > 0 && last === null);
    }
    onMount(refresh);

    async function doExport() {
        exporting = true;
        try {
            const s = await exportBackup();
            toast.show(`Backup written: ${s.annotations} annotations, ${s.tags} tags`);
            await refresh();
        } catch (err) {
            toast.show(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            exporting = false;
        }
    }

    async function onFile(e: Event) {
        const file = (e.currentTarget as HTMLInputElement).files?.[0];
        if (!file) return;
        importError = null;
        pending = null;
        try {
            const { backup, summary } = await readBackupFile(file);
            pending = { backup, summary, name: file.name };
        } catch (err) {
            importError = err instanceof Error ? err.message : String(err);
        }
        if (fileInput) fileInput.value = '';
    }

    async function doImport(mode: 'merge' | 'replace') {
        if (!pending) return;
        if (mode === 'replace' && !confirm('Replace every annotation, tag, saved search and setting in this browser with the backup? This cannot be undone.')) return;
        importing = true;
        try {
            const r = await applyBackup(pending.backup, mode);
            if (r.settingsReplaced) await preferences.load();
            toast.show(mode === 'merge' ? `Merged ${r.written} records (${r.overwritten} updated)` : `Restored ${r.written} records from the backup`);
            pending = null;
            await refresh();
        } catch (err) {
            importError = err instanceof Error ? err.message : String(err);
        } finally {
            importing = false;
        }
    }

    async function resetSettings() {
        if (!confirm('Reset every setting to its default? Your annotations and downloaded translations are not affected.')) return;
        await preferences.reset();
        toast.show('Settings reset to defaults');
    }
</script>

<SettingsCard id="data" kicker="Data">
    <p class="note">Annotations, highlights, themes and reading position live in this browser. A backup file is the only thing that survives a cleared profile or a new machine.</p>

    <SettingRow label="Export backup" hint={`Annotations, tags, saved searches and settings as one file.${annotationCount !== null ? ` ${annotationCount.toLocaleString()} annotations · last export ${formatDate(lastExport)}.` : ''}`}>
        <Button variant="primary" onclick={doExport} loading={exporting}>Export…</Button>
    </SettingRow>

    <SettingRow label="Import backup" hint="Choose merge or replace after the file is read; a summary is shown before anything is written.">
        <!-- hidden, not visually-hidden: an absolutely positioned input with
             no positioned ancestor sits in the document flow far below the
             pane and makes the whole document scroll past its own end -->
        <input bind:this={fileInput} type="file" accept="application/json,.json" hidden id="backup-file" onchange={onFile} />
        <Button variant="secondary" onclick={() => fileInput?.click()}>Choose file…</Button>
        {#snippet below()}
            {#if importError}
                <p class="import-error" role="alert">{importError}</p>
            {/if}
            {#if pending}
                <div class="import-summary" role="region" aria-label="Backup summary">
                    <p class="import-title">{pending.name}</p>
                    <p class="import-line">Written {formatDate(pending.summary.exportedAt)} by build {pending.summary.app}: {pending.summary.notes} notes, {pending.summary.highlights} highlights, {pending.summary.themes} theme tags, {pending.summary.tags} tags, {pending.summary.savedSearches} saved searches.</p>
                    <div class="import-actions">
                        <Button variant="primary" size="sm" onclick={() => doImport('merge')} loading={importing}>Merge into this browser</Button>
                        <Button variant="danger" size="sm" onclick={() => doImport('replace')} disabled={importing}>Replace everything</Button>
                        <Button variant="ghost" size="sm" onclick={() => (pending = null)} disabled={importing}>Cancel</Button>
                    </div>
                    <p class="import-line">Merge keeps what is here and lets the backup win on the same record; replace clears annotations, tags, saved searches and settings first.</p>
                </div>
            {/if}
        {/snippet}
    </SettingRow>

    <SettingRow label="Persistent storage" hint="Protects your library and annotations from being evicted by the browser under storage pressure.">
        {#if storagePersisted === true}
            <span class="status ok">Persistent</span>
        {:else if storagePersisted === false}
            <Button variant="secondary" onclick={onRequestPersistence}>Request persistence</Button>
        {:else}
            <span class="status">Unknown</span>
        {/if}
    </SettingRow>

    <div class="danger-zone">
        <SettingRow label="Reset settings to defaults" hint="Appearance and reader preferences only. Annotations and downloaded corpora are untouched.">
            <Button variant="danger" onclick={resetSettings}>Reset settings</Button>
        </SettingRow>
    </div>
</SettingsCard>

<style>
    .note {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        padding: var(--space-3) 0 var(--space-1);
        max-width: 64ch;
    }
    .status {
        font-size: var(--font-size-xs);
        font-weight: 600;
        color: var(--color-text-muted);
        white-space: nowrap;
    }
    .status.ok {
        color: var(--color-success);
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }
    .status.ok::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--color-success);
    }
    .import-error {
        margin-top: var(--space-2);
        font-size: var(--font-size-xs);
        color: var(--color-danger);
    }
    .import-summary {
        margin-top: var(--space-2);
        padding: var(--space-3) var(--space-4);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg-surface);
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }
    .import-title { font-size: var(--font-size-sm); font-weight: 600; color: var(--color-text-primary); }
    .import-line { font-size: var(--font-size-xs); color: var(--color-text-muted); }
    .import-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .danger-zone {
        border-top: 1px solid var(--color-border);
        margin-top: var(--space-4);
        padding-top: var(--space-2);
    }
</style>
