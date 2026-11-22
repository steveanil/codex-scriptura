<script lang="ts">
    import { onMount } from 'svelte';
    import Button from '$lib/components/ui/Button.svelte';
    import SettingsCard from './SettingsCard.svelte';
    import SettingRow from './SettingRow.svelte';
    import UserDataClears from './UserDataClears.svelte';
    import BackupImportPreview from './BackupImportPreview.svelte';
    import { preferences } from '$lib/stores/preferences.svelte';
    import { scratchPad } from '$lib/stores/scratchPad.svelte';
    import { toast } from '$lib/stores/toast.svelte';
    import { getAllAnnotations } from '@codex-scriptura/db';
    import { applyBackup, exportBackup, lastExportAt, readBackupFile, readLocalState } from '$lib/utils/backup';
    import { BackupValidationError, type Backup, type ImportPlan, type LocalState } from '$lib/utils/backup-format';
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
    // raw: a backup can hold thousands of records, and nothing edits them in place
    let pending = $state.raw<{ backup: Backup; local: LocalState; name: string } | null>(null);
    let importError = $state<string | null>(null);
    let importProblems = $state<string[]>([]);
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
        importProblems = [];
        pending = null;
        try {
            const [{ backup }, local] = await Promise.all([readBackupFile(file), readLocalState()]);
            pending = { backup, local, name: file.name };
        } catch (err) {
            importError = err instanceof Error ? err.message : String(err);
            if (err instanceof BackupValidationError && err.problems.length > 1) importProblems = err.problems;
        }
        if (fileInput) fileInput.value = '';
    }

    function importedMessage(p: ImportPlan): string {
        const types = [p.annotations, p.tags, p.savedSearches];
        const sum = (pick: (t: (typeof types)[number]) => unknown[]) => types.reduce((n, t) => n + pick(t).length, 0);
        if (p.mode === 'replace') return `Restored ${sum((t) => t.write)} records from the backup`;
        const kept = sum((t) => t.older);
        return `Merged: ${sum((t) => t.added)} new, ${sum((t) => t.newer)} updated${kept ? `, ${kept} kept because they are newer here` : ''}`;
    }

    async function doImport(mode: 'merge' | 'replace') {
        if (!pending) return;
        importing = true;
        try {
            const plan = await applyBackup(pending.backup, mode);
            if (plan.settings) await preferences.load();
            if (plan.scratchPad) await scratchPad.reload();
            toast.show(importedMessage(plan));
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

    <SettingRow label="Export backup" hint={`Annotations, tags, saved searches, settings and the scratch pad as one file.${annotationCount !== null ? ` ${annotationCount.toLocaleString()} annotations · last export ${formatDate(lastExport)}.` : ''}`}>
        <Button variant="primary" onclick={doExport} loading={exporting}>Export…</Button>
    </SettingRow>

    <SettingRow label="Import backup" hint="Shows what a merge would add, overwrite and keep before anything is written. Merge keeps whichever copy of a record is newer.">
        <!-- hidden, not visually-hidden: an absolutely positioned input with
             no positioned ancestor sits in the document flow far below the
             pane and makes the whole document scroll past its own end -->
        <input bind:this={fileInput} type="file" accept="application/json,.json" hidden id="backup-file" onchange={onFile} />
        <Button variant="secondary" onclick={() => fileInput?.click()}>Choose file…</Button>
        {#snippet below()}
            {#if importError}
                <p class="import-error" role="alert">{importError}</p>
                {#if importProblems.length > 0}
                    <ul class="import-problems">
                        {#each importProblems.slice(0, 8) as problem, i (i)}<li>{problem}</li>{/each}
                        {#if importProblems.length > 8}<li>and {importProblems.length - 8} more</li>{/if}
                    </ul>
                {/if}
            {/if}
            {#if pending}
                <BackupImportPreview
                    name={pending.name}
                    backup={pending.backup}
                    local={pending.local}
                    {importing}
                    onMerge={() => doImport('merge')}
                    onReplace={() => doImport('replace')}
                    onCancel={() => (pending = null)}
                />
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
        <UserDataClears onChange={refresh} />
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
    .import-problems {
        margin: var(--space-1) 0 0;
        padding-left: var(--space-4);
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        overflow-wrap: anywhere;
    }
    .danger-zone {
        border-top: 1px solid var(--color-border);
        margin-top: var(--space-4);
        padding-top: var(--space-2);
    }
</style>
