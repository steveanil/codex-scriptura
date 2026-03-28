<script lang="ts">
    import { onMount } from 'svelte';
    import { seedAll, seedTheographic } from '$lib/seed';
    import { preferences } from '$lib/stores/preferences.svelte';
    import { ui } from '$lib/stores/ui.svelte';
    import CommandPalette from '$lib/components/CommandPalette.svelte';
    import '../app.css';

    let { children } = $props();

    let ready = $state(false);
    let sidebarOpen = $state(true);
    let theme = $state<'light' | 'dark'>('dark');

    onMount(async () => {
        // Detect system preference
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        theme = prefersDark ? 'dark' : 'light';
        document.documentElement.dataset.theme = theme;

        // Seed the database on first launch
        await seedAll();
        // Seed Theographic enrichment data (no-op when CSVs not available or already seeded)
        await seedTheographic();

        // Load persisted preferences
        await preferences.load();
        ready = true;
    });

    // Sync preferences to CSS custom properties whenever they change
    $effect(() => {
        const prefs = preferences.value;
        if (!prefs) return;

        const root = document.documentElement;

        // Resolve theme (system → actual light/dark)
        const resolvedTheme =
            prefs.theme === 'system'
                ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
                : prefs.theme;
        root.dataset.theme = resolvedTheme;
        theme = resolvedTheme;

        root.style.setProperty('--color-accent', prefs.accentColor);
        // --font-ui drives html { font-family } via app.css
        root.style.setProperty('--font-ui', prefs.fonts.ui);
        // --font-scripture is what .verse-flow actually uses; keep --font-reader as alias
        root.style.setProperty('--font-scripture', prefs.fonts.reader);
        root.style.setProperty('--font-reader', prefs.fonts.reader);
        root.style.setProperty('--font-greek', prefs.fonts.greek);
        root.style.setProperty('--font-hebrew', prefs.fonts.hebrew);
        root.style.setProperty('--font-reader-size', `${prefs.fonts.size}px`);
        root.style.setProperty('--reader-line-height', String(prefs.reader.lineHeight));

        const columnWidthMap = { narrow: '560px', medium: '720px', wide: '900px' };
        root.style.setProperty('--content-max-width', columnWidthMap[prefs.reader.columnWidth] ?? '720px');

        const densityPadding = { compact: '1rem', normal: '2rem', relaxed: '3.5rem' }[prefs.reader.density] ?? '2rem';
        root.style.setProperty('--reader-content-padding', densityPadding);
    });

    function toggleTheme() {
        const next = theme === 'dark' ? 'light' : 'dark';
        theme = next;
        document.documentElement.dataset.theme = next;
        preferences.update({ theme: next });
    }

    function toggleSidebar() {
        sidebarOpen = !sidebarOpen;
    }
</script>

<svelte:head>
    <title>Codex Scriptura</title>
    <meta name="description" content="A plugin-extensible, offline-first Bible study platform" />
</svelte:head>

{#if !ready}
    <div class="loading-screen">
        <div class="loading-spinner"></div>
        <p class="loading-text">Preparing your library…</p>
    </div>
{:else}
    <div class="app-shell" class:sidebar-collapsed={!sidebarOpen}>
        <!-- Sidebar -->
        <aside class="sidebar">
            <div class="sidebar-header">
                <div class="logo">
                    <span class="logo-icon">📜</span>
                    <span class="logo-text">Codex Scriptura</span>
                </div>
                <button class="sidebar-toggle" onclick={toggleSidebar} aria-label="Toggle sidebar">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M15 18l-6-6 6-6" />
                    </svg>
                </button>
            </div>

            <nav class="sidebar-nav">
                <a href="/read" class="nav-item" id="nav-read">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                    </svg>
                    <span>Read</span>
                </a>
                <a href="/search" class="nav-item" id="nav-search">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                    </svg>
                    <span>Search</span>
                </a>
                <!-- Move Annotate over from the top bar -->
                <a href="/read" class="nav-item" id="nav-annotate" onclick={() => { ui.annotationSidebarOpen = true; }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                    <span>Annotate</span>
                </a>
            </nav>

            <div class="sidebar-footer">
                <a href="/settings" class="nav-item" id="nav-settings" style="width: 100%;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    <span>Settings</span>
                </a>
            </div>
        </aside>

        <!-- Main Content -->
        <main class="main-content">
            {@render children()}
        </main>
    </div>

    <CommandPalette />
{/if}

<style>
    /* ─── Loading Screen ────────────────────────────── */
    .loading-screen {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100vh;
        gap: var(--space-4);
    }
    .loading-spinner {
        width: 40px;
        height: 40px;
        border: 3px solid var(--color-border);
        border-top-color: var(--color-accent);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
        to { transform: rotate(360deg); }
    }
    .loading-text {
        color: var(--color-text-secondary);
        font-size: var(--font-size-sm);
    }

    /* ─── App Shell ─────────────────────────────────── */
    .app-shell {
        display: grid;
        grid-template-columns: var(--sidebar-width) 1fr;
        min-height: 100vh;
        transition: grid-template-columns var(--transition-base);
    }
    .app-shell.sidebar-collapsed {
        grid-template-columns: 48px 1fr;
    }

    /* ─── Sidebar ───────────────────────────────────── */
    .sidebar {
        background: var(--color-bg-elevated);
        border-right: 1px solid var(--color-border);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transition: all var(--transition-base);
    }

    /* When collapsed, hide text labels but keep icons visible */
    .sidebar-collapsed .sidebar .logo-text,
    .sidebar-collapsed .sidebar .nav-item span {
        display: none;
    }
    .sidebar-collapsed .sidebar .sidebar-header {
        justify-content: center;
        padding: var(--space-4) var(--space-2) var(--space-3);
    }
    .sidebar-collapsed .sidebar .logo {
        display: none;
    }
    .sidebar-collapsed .sidebar .nav-item {
        justify-content: center;
        padding: var(--space-2);
    }
    .sidebar-collapsed .sidebar .sidebar-nav {
        align-items: center;
    }
    .sidebar-collapsed .sidebar .sidebar-footer {
        display: flex;
        justify-content: center;
    }

    .sidebar-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-4) var(--space-4) var(--space-3);
        border-bottom: 1px solid var(--color-border-subtle);
    }

    .logo {
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }
    .logo-icon {
        font-size: var(--font-size-xl);
    }
    .logo-text {
        font-weight: 600;
        font-size: var(--font-size-sm);
        letter-spacing: 0.02em;
        white-space: nowrap;
    }

    .sidebar-toggle {
        background: none;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        padding: var(--space-1);
        border-radius: var(--radius-sm);
        display: flex;
        transition: all var(--transition-fast);
    }
    .sidebar-toggle:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
    }
    .sidebar-collapsed .sidebar-toggle {
        transform: rotate(180deg);
    }

    /* ─── Navigation ────────────────────────────────── */
    .sidebar-nav {
        flex: 1;
        padding: var(--space-3);
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
    }

    .nav-item {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-sm);
        color: var(--color-text-secondary);
        font-size: var(--font-size-sm);
        font-weight: 500;
        transition: all var(--transition-fast);
        text-decoration: none;
        white-space: nowrap;
    }
    .nav-item:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
    }

    /* ─── Sidebar Footer ────────────────────────────── */
    .sidebar-footer {
        padding: var(--space-3);
        border-top: 1px solid var(--color-border-subtle);
    }

    /* ─── Main Content ──────────────────────────────── */
    .main-content {
        overflow-y: auto;
        height: 100vh;
    }

    /* ─── Mobile ────────────────────────────────────── */
    @media (max-width: 768px) {
        .app-shell {
            grid-template-columns: 0px 1fr;
        }
        .sidebar {
            position: fixed;
            z-index: 100;
            width: var(--sidebar-width);
            height: 100vh;
            transform: translateX(-100%);
            transition: transform var(--transition-base);
        }
        .app-shell:not(.sidebar-collapsed) .sidebar {
            transform: translateX(0);
            opacity: 1;
            pointer-events: all;
        }
    }
</style>
