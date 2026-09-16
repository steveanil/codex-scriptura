<script lang="ts">
    import { onMount } from 'svelte';
    import { preferences } from '$lib/stores/preferences.svelte';
    import { translationLibrary } from '$lib/stores/translationLibrary.svelte';
    import AppearanceSection from '$lib/components/settings/AppearanceSection.svelte';
    import ReaderSection from '$lib/components/settings/ReaderSection.svelte';
    import HighlightsSection from '$lib/components/settings/HighlightsSection.svelte';
    import LibrarySection from '$lib/components/settings/LibrarySection.svelte';
    import DataSection from '$lib/components/settings/DataSection.svelte';
    import ShortcutsSection from '$lib/components/settings/ShortcutsSection.svelte';
    import PluginsSection from '$lib/components/settings/PluginsSection.svelte';
    import StorageSection from '$lib/components/settings/StorageSection.svelte';
    import AboutSection from '$lib/components/settings/AboutSection.svelte';

    // Section rail: one entry per card, scroll-spied; Data carries a dot
    // while there are annotations and no backup has ever been written.
    const SECTIONS = [
        { id: 'appearance', label: 'Appearance' },
        { id: 'reader', label: 'Reader' },
        { id: 'highlights', label: 'Highlights' },
        { id: 'library', label: 'Library' },
        { id: 'data', label: 'Data' },
        { id: 'shortcuts', label: 'Shortcuts' },
        { id: 'plugins', label: 'Plugins' },
        { id: 'storage', label: 'Storage' },
        { id: 'about', label: 'About' },
    ];
    let current = $state('appearance');
    let needsBackup = $state(false);
    let mainEl: HTMLElement | undefined = $state();

    function jump(id: string, e?: Event) {
        e?.preventDefault();
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        history.replaceState(history.state, '', `#${id}`);
        current = id;
    }

    // ── Storage facts shared by Data and Storage ──
    let storagePersisted = $state<boolean | null>(null);
    let storageUsage = $state<{ usage: number; quota: number } | null>(null);
    async function refreshStorageInfo() {
        try {
            if (navigator.storage?.persisted) storagePersisted = await navigator.storage.persisted();
            if (navigator.storage?.estimate) {
                const est = await navigator.storage.estimate();
                storageUsage = { usage: est.usage ?? 0, quota: est.quota ?? 0 };
            }
        } catch {
            // API unavailable; the rows say Unknown
        }
    }
    async function requestPersistence() {
        try {
            if (navigator.storage?.persist) storagePersisted = await navigator.storage.persist();
        } catch {
            storagePersisted = false;
        }
    }

    onMount(() => {
        refreshStorageInfo();
        translationLibrary.refresh();
        // The legacy #translations anchor (harness, older links) lands on the Library
        const hash = location.hash.replace('#', '');
        const target = hash === 'translations' ? 'library' : hash;
        if (target && SECTIONS.some((s) => s.id === target)) {
            requestAnimationFrame(() => jump(target));
        }
        // Scroll spy: the topmost card crossing the upper third of the viewport wins
        const io = new IntersectionObserver(
            (entries) => {
                const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
                if (visible[0]) current = (visible[0].target as HTMLElement).id;
            },
            { root: null, rootMargin: '-10% 0px -65% 0px', threshold: 0 },
        );
        for (const s of SECTIONS) {
            const el = document.getElementById(s.id);
            if (el) io.observe(el);
        }
        return () => io.disconnect();
    });
</script>

<svelte:head>
    <title>Settings - Codex Scriptura</title>
</svelte:head>

<div class="settings-shell">
    <nav class="rail" aria-label="Settings sections">
        <div class="rail-h card-kicker">Settings</div>
        {#each SECTIONS as s (s.id)}
            <a href="#{s.id}" aria-current={current === s.id ? 'true' : undefined} onclick={(e) => jump(s.id, e)}>
                {s.label}
                {#if s.id === 'data' && needsBackup}<span class="dot" title="No backup yet" aria-label="No backup yet"></span>{/if}
            </a>
        {/each}
    </nav>

    <main class="settings-main" bind:this={mainEl}>
        <h1>Settings</h1>
        <p class="sub">Changes are saved automatically. Export a backup under Data.</p>

        {#if preferences.value}
            <AppearanceSection />
            <ReaderSection />
            <HighlightsSection />
            <LibrarySection onChanged={refreshStorageInfo} />
            <DataSection {storagePersisted} onRequestPersistence={requestPersistence} onBackupState={(v) => (needsBackup = v)} />
            <ShortcutsSection />
            <PluginsSection />
            <StorageSection usage={storageUsage} onChanged={refreshStorageInfo} />
            <AboutSection />
        {/if}
    </main>
</div>

<style>
    .settings-shell {
        display: grid;
        grid-template-columns: 168px minmax(0, 1fr);
        align-items: start;
        font-size: var(--font-size-sm);
    }
    .rail {
        position: sticky;
        top: 0;
        align-self: start;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: var(--space-8) var(--space-3) var(--space-4);
        border-right: 1px solid var(--color-border-subtle);
        min-height: 100vh;
    }
    .rail-h {
        padding: 0 var(--space-3) var(--space-2);
    }
    .rail a {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        height: var(--row-h-md);
        padding: 0 var(--space-3);
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
        font-size: var(--font-size-xs);
        transition: background var(--transition-fast), color var(--transition-fast);
    }
    .rail a:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-secondary);
    }
    .rail a[aria-current] {
        color: var(--color-text-primary);
        box-shadow: inset 2px 0 0 var(--color-accent);
        background: var(--color-bg-surface);
    }
    .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--color-warning);
        flex: none;
    }
    .settings-main {
        padding: var(--space-8) var(--space-10) var(--space-12);
        max-width: 860px;
        min-width: 0;
    }
    h1 {
        font-size: var(--font-size-2xl);
        font-weight: 700;
        letter-spacing: -0.01em;
        color: var(--color-text-primary);
    }
    .sub {
        color: var(--color-text-muted);
        font-size: var(--font-size-xs);
        margin: 2px 0 var(--space-6);
    }

    @media (max-width: 900px) {
        .settings-shell {
            grid-template-columns: 1fr;
        }
        /* The rail becomes a sticky chip row across the top */
        .rail {
            flex-direction: row;
            flex-wrap: nowrap;
            overflow-x: auto;
            scrollbar-width: none;
            min-height: 0;
            padding: var(--space-2) var(--space-3);
            border-right: none;
            border-bottom: 1px solid var(--color-border-subtle);
            background: var(--color-bg);
            z-index: 5;
        }
        .rail::-webkit-scrollbar { display: none; }
        .rail-h { display: none; }
        .rail a {
            flex: none;
            height: var(--row-h-sm);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-pill);
        }
        .rail a[aria-current] {
            box-shadow: none;
            border-color: var(--color-accent);
            background: var(--color-accent-subtle);
        }
        .settings-main {
            padding: var(--space-4);
        }
    }
</style>
