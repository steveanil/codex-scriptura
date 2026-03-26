<script lang="ts">
    import { onMount } from 'svelte';
    import { seedAll } from '$lib/seed';
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
        ready = true;
    });

    function toggleTheme() {
        theme = theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = theme;
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
            </nav>

            <div class="sidebar-footer">
                <button class="theme-toggle" onclick={toggleTheme} aria-label="Toggle theme" id="theme-toggle">
                    {#if theme === 'dark'}
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                        </svg>
                    {:else}
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                        </svg>
                    {/if}
                    <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
                </button>
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
    .sidebar-collapsed .sidebar .nav-item span,
    .sidebar-collapsed .sidebar .theme-toggle span {
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
    .sidebar-collapsed .sidebar .theme-toggle {
        justify-content: center;
        padding: var(--space-2);
        width: auto;
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
    .theme-toggle {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        width: 100%;
        padding: var(--space-2) var(--space-3);
        background: none;
        border: none;
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
        font-family: var(--font-ui);
        cursor: pointer;
        transition: all var(--transition-fast);
        white-space: nowrap;
    }
    .theme-toggle:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
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
