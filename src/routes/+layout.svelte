<script lang="ts">
    import { onMount } from 'svelte';
    import { page } from '$app/state';
    import { seedAll, seedTheographic } from '$lib/seed';
    import { db, deleteKv, getKv, setKv } from '@codex-scriptura/db';
    import { preferences } from '$lib/stores/preferences.svelte';
    import { seedStatus } from '$lib/stores/seedStatus.svelte';
    import { ui } from '$lib/stores/ui.svelte';
    import { darken, lighten, withAlpha } from '$lib/utils/color';
    import { LATEST_UPDATE_ID } from '$lib/whats-new';
    import CommandPalette from '$lib/components/CommandPalette.svelte';
    import GenealogyTreeModal from '$lib/components/GenealogyTreeModal.svelte';
    import WhatsNewModal from '$lib/components/WhatsNewModal.svelte';
    import '../app.css';

    let { children } = $props();

    let ready = $state(false);
    let sidebarOpen = $state(true);
    let theme = $state<'light' | 'dark'>('dark');
    // Catastrophic boot failure (DB won't open, upgrade error) - shown in
    // place of the eternal spinner (known-issues #16).
    let bootError = $state<string | null>(null);
    // Another tab holds an older DB connection and blocks our upgrade.
    let upgradeBlocked = $state(false);

    onMount(async () => {
        // Dark-first design: start dark; loaded preferences may switch to light
        theme = 'dark';
        document.documentElement.dataset.theme = theme;

        // Ask the browser to protect IndexedDB from eviction under storage
        // pressure - essential for an offline-first library. Best-effort and
        // not awaited: Firefox may show a prompt, and seeding shouldn't block
        // on it. Status is surfaced in Settings → Storage.
        navigator.storage?.persist?.().catch(() => {});

        // Surface a blocked schema upgrade instead of hanging silently
        db.on('blocked', () => {
            upgradeBlocked = true;
        });

        try {
            // Seed the database on first launch
            await seedAll();
            // Seed Theographic enrichment data (no-op when CSVs not available
            // or already seeded); isolated like every seedAll() step
            try {
                await seedTheographic();
            } catch (err) {
                console.error('[seed] Theographic failed:', err);
                seedStatus.fail('People, places & events', err);
            }

            // Load persisted preferences
            await preferences.load();

            // Update awareness (whats-new.ts): on the very first run there is
            // no "before" to compare against, so mark the current entry seen
            // silently. On later runs a changed id lights the sidebar badge
            // and opens the modal once.
            const seenUpdateId = await getKv<string>('whatsNewSeen');
            if (seenUpdateId === undefined) {
                await setKv('whatsNewSeen', LATEST_UPDATE_ID);
            } else if (seenUpdateId !== LATEST_UPDATE_ID) {
                ui.hasUnseenUpdates = true;
                ui.whatsNewOpen = true;
            }

            ready = true;
        } catch (err) {
            // The app cannot function (DB won't open, preferences unreadable) -
            // show the error instead of spinning forever.
            console.error('[boot] Fatal boot error:', err);
            bootError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        }

        // Clear nav history on tab close (session-only data)
        window.addEventListener('beforeunload', () => {
            deleteKv('navHistory').catch(() => {});
        });
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

        // The accent is a family, not one variable: hover, subtle wash, search
        // highlight, and glow are all derived from it (verse numbers and the
        // active nav tab chain off these via app.css). Setting only
        // --color-accent left the rest factory sky blue.
        const dark = resolvedTheme === 'dark';
        root.style.setProperty('--color-accent', prefs.accentColor);
        root.style.setProperty(
            '--color-accent-hover',
            dark ? lighten(prefs.accentColor, 0.35) : darken(prefs.accentColor, 0.12),
        );
        root.style.setProperty('--color-accent-subtle', withAlpha(prefs.accentColor, dark ? 0.14 : 0.08));
        root.style.setProperty('--color-search-highlight', withAlpha(prefs.accentColor, dark ? 0.25 : 0.15));
        root.style.setProperty('--shadow-glow', `0 0 20px ${withAlpha(prefs.accentColor, dark ? 0.15 : 0.08)}`);
        // --font-ui drives html { font-family } via app.css. Append a generic
        // fallback so an unavailable font degrades instead of hitting the UA
        // default. No quotes: they'd turn keywords like system-ui into
        // (nonexistent) family names, and unquoted multi-word names are valid.
        const uiStack = `${prefs.fonts.ui}, sans-serif`;
        const readerStack = `${prefs.fonts.reader}, serif`;
        root.style.setProperty('--font-ui', uiStack);
        // --font-scripture is what .verse-flow actually uses; keep --font-reader as alias
        root.style.setProperty('--font-scripture', readerStack);
        root.style.setProperty('--font-reader', readerStack);
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

    function isActive(href: string): boolean {
        return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
    }
</script>

<svelte:head>
    <title>Codex Scriptura</title>
    <meta name="description" content="A plugin-extensible, offline-first Bible study platform" />
</svelte:head>

{#if !ready}
    <div class="loading-screen">
        {#if bootError}
            <div class="boot-error">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
                </svg>
                <p class="boot-error-title">Something went wrong while starting up</p>
                <p class="boot-error-detail">{bootError}</p>
                <button class="boot-error-retry" onclick={() => location.reload()}>Try again</button>
            </div>
        {:else}
            <div class="loading-spinner"></div>
            <p class="loading-text">Preparing your library…</p>
            {#if upgradeBlocked}
                <p class="loading-step">Waiting for another Codex Scriptura tab to close (it is blocking a database upgrade)…</p>
            {:else if seedStatus.currentStep}
                <p class="loading-step">{seedStatus.currentStep}</p>
                {#if seedStatus.progress !== null}
                    <div
                        class="loading-progress"
                        role="progressbar"
                        aria-label="Preparing your library"
                        aria-valuemin="0"
                        aria-valuemax="100"
                        aria-valuenow={Math.round(seedStatus.progress * 100)}
                    >
                        <div class="loading-progress-fill" style:width="{seedStatus.progress * 100}%"></div>
                    </div>
                    <p class="loading-percent">{Math.round(seedStatus.progress * 100)}%</p>
                {/if}
                <p class="loading-hint">First launch prepares the full library for offline use. This can take a minute or two.</p>
            {/if}
        {/if}
    </div>
{:else}
    <div class="app-shell" class:sidebar-collapsed={!sidebarOpen}>
        <!-- Sidebar -->
        <aside class="sidebar">
            <div class="sidebar-header">
                <div class="logo">
                    <span class="logo-icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                        </svg>
                    </span>
                    <span class="logo-text">Codex Scriptura</span>
                </div>
                <button class="sidebar-toggle" onclick={toggleSidebar} aria-label="Toggle sidebar">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M15 18l-6-6 6-6" />
                    </svg>
                </button>
            </div>

            <nav class="sidebar-nav">
                <a href="/read" class="nav-item" id="nav-read" class:active={isActive('/read')}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                    </svg>
                    <span>Read</span>
                </a>
                <a href="/search" class="nav-item" id="nav-search" class:active={isActive('/search')}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                    </svg>
                    <span>Search</span>
                </a>
                <a href="/graph" class="nav-item" id="nav-graph" class:active={isActive('/graph')}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
                        <path d="M8.5 8.5l7 7" /><path d="M15.5 8.5l-7 7" /><path d="M8.5 6h7" /><path d="M6 8.5v7" />
                    </svg>
                    <span>Graph</span>
                </a>
                <a href="/themes" class="nav-item" id="nav-themes" class:active={isActive('/themes')}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                        <line x1="7" y1="7" x2="7.01" y2="7" />
                    </svg>
                    <span>Themes</span>
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
                <button class="nav-item whats-new-btn" id="nav-whats-new" onclick={() => { ui.whatsNewOpen = true; }}>
                    <span class="whats-new-icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z" />
                            <path d="M19 15l.7 2.1L21.8 18l-2.1.7L19 20.8l-.7-2.1-2.1-.7 2.1-.9z" />
                        </svg>
                        {#if ui.hasUnseenUpdates}<span class="whats-new-dot"></span>{/if}
                    </span>
                    <span>What's new</span>
                </button>
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
            {#if seedStatus.failures.length > 0 && !seedStatus.dismissed}
                <div class="seed-error-banner" role="alert">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4" /><path d="M12 17h.01" />
                    </svg>
                    <div class="seed-error-text">
                        <strong>Some data failed to load:</strong>
                        {seedStatus.failures.map((f) => f.dataset).join(', ')}.
                        Affected features may be missing or incomplete.
                        <span class="seed-error-detail">{seedStatus.failures[0].message}{seedStatus.failures.length > 1 ? ` (+${seedStatus.failures.length - 1} more in console)` : ''}</span>
                    </div>
                    <button class="seed-error-btn" onclick={() => location.reload()}>Retry</button>
                    <button class="seed-error-btn seed-error-dismiss" onclick={() => seedStatus.dismiss()} aria-label="Dismiss">✕</button>
                </div>
            {/if}
            {@render children()}
        </main>

        <!-- Phone-width navigation: the sidebar is display:none below 768px
             (as a fixed overlay it left the grid and collapsed the content
             column to 0, known-issues "blank shell"). A bottom tab bar
             replaces it. -->
        <nav class="mobile-nav">
            <a href="/read" class="mobile-nav-item" class:active={isActive('/read')} aria-label="Read">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
                <span>Read</span>
            </a>
            <a href="/search" class="mobile-nav-item" class:active={isActive('/search')} aria-label="Search">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                </svg>
                <span>Search</span>
            </a>
            <a href="/graph" class="mobile-nav-item" class:active={isActive('/graph')} aria-label="Graph">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
                    <path d="M8.5 8.5l7 7" /><path d="M15.5 8.5l-7 7" /><path d="M8.5 6h7" /><path d="M6 8.5v7" />
                </svg>
                <span>Graph</span>
            </a>
            <a href="/read" class="mobile-nav-item" onclick={() => { ui.annotationSidebarOpen = true; }} aria-label="Annotate">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                <span>Annotate</span>
            </a>
            <a href="/settings" class="mobile-nav-item" class:active={isActive('/settings')} aria-label="Settings">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                <span>Settings</span>
            </a>
        </nav>
    </div>

    <CommandPalette />
    <WhatsNewModal />

    {#if ui.genealogyTree.isOpen}
        <GenealogyTreeModal
            rootId={ui.genealogyTree.rootId}
            onClose={() => ui.closeGenealogyTree()}
        />
    {/if}
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
    .loading-step {
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
        font-weight: 500;
    }
    .loading-progress {
        width: min(280px, 70vw);
        height: 6px;
        background: var(--color-border);
        border-radius: 999px;
        overflow: hidden;
    }
    .loading-progress-fill {
        height: 100%;
        background: var(--color-accent);
        border-radius: inherit;
        transition: width var(--transition-fast);
    }
    .loading-percent {
        color: var(--color-text-muted);
        font-size: var(--font-size-xs);
        font-variant-numeric: tabular-nums;
    }
    .loading-hint {
        color: var(--color-text-muted);
        font-size: var(--font-size-xs);
        max-width: 340px;
        text-align: center;
    }

    /* ─── Boot error ────────────────────────────────── */
    .boot-error {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-3);
        max-width: 420px;
        text-align: center;
        color: var(--color-error, #ef4444);
    }
    .boot-error-title {
        color: var(--color-text-primary);
        font-size: var(--font-size-md);
        font-weight: 600;
    }
    .boot-error-detail {
        color: var(--color-text-secondary);
        font-size: var(--font-size-xs);
        font-family: var(--font-mono);
        word-break: break-word;
    }
    .boot-error-retry {
        padding: var(--space-2) var(--space-4);
        background: var(--color-bg-control);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        font-weight: 600;
        cursor: pointer;
        transition: border-color var(--transition-fast);
    }
    .boot-error-retry:hover {
        border-color: var(--color-accent);
    }

    /* ─── Seed error banner ─────────────────────────── */
    .seed-error-banner {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-2) var(--space-4);
        background: color-mix(in srgb, var(--color-error, #ef4444) 12%, var(--color-bg-elevated));
        border-bottom: 1px solid color-mix(in srgb, var(--color-error, #ef4444) 40%, transparent);
        color: var(--color-text-primary);
        font-size: var(--font-size-xs);
    }
    .seed-error-banner svg {
        flex-shrink: 0;
        color: var(--color-error, #ef4444);
    }
    .seed-error-text {
        flex: 1;
        min-width: 0;
    }
    .seed-error-detail {
        display: block;
        color: var(--color-text-muted);
        font-family: var(--font-mono);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .seed-error-btn {
        flex-shrink: 0;
        padding: var(--space-1) var(--space-3);
        background: none;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 600;
        cursor: pointer;
        transition: border-color var(--transition-fast);
    }
    .seed-error-btn:hover {
        border-color: var(--color-error, #ef4444);
    }
    .seed-error-dismiss {
        border: none;
        color: var(--color-text-muted);
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
        gap: 9px;
    }
    .logo-icon {
        width: 26px;
        height: 26px;
        flex: none;
        border-radius: 7px;
        background: linear-gradient(150deg, #5e9ed6, #3f6fbf);
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
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
    .nav-item.active {
        background: color-mix(in srgb, var(--color-accent) 16%, transparent);
        color: var(--color-accent-hover);
        font-weight: 600;
    }

    /* ─── Sidebar Footer ────────────────────────────── */
    .sidebar-footer {
        padding: var(--space-3);
        border-top: 1px solid var(--color-border-subtle);
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
    }
    .whats-new-btn {
        background: none;
        border: none;
        cursor: pointer;
        font-family: var(--font-ui);
        width: 100%;
        text-align: left;
    }
    .whats-new-icon {
        position: relative;
        display: flex;
    }
    .whats-new-dot {
        position: absolute;
        top: -2px;
        right: -2px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--color-accent);
        border: 2px solid var(--color-bg-elevated);
    }
    .sidebar-collapsed .sidebar .sidebar-footer {
        flex-direction: column;
        align-items: center;
    }
    /* The collapsed sidebar hides nav-item spans (labels); the icon wrapper
       span must stay visible so the badge dot survives collapse. */
    .sidebar-collapsed .sidebar .whats-new-btn .whats-new-icon {
        display: flex;
    }

    /* ─── Main Content ──────────────────────────────── */
    .main-content {
        overflow-y: auto;
        height: 100vh;
        min-width: 0;
    }

    /* ─── Mobile bottom nav ─────────────────────────── */
    .mobile-nav {
        display: none;
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        height: var(--mobile-nav-height);
        z-index: 90;
        background: var(--color-bg-elevated);
        border-top: 1px solid var(--color-border);
        padding-bottom: env(safe-area-inset-bottom);
    }
    .mobile-nav-item {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        color: var(--color-text-muted);
        font-size: 0.65rem;
        font-weight: 500;
        text-decoration: none;
        transition: color var(--transition-fast);
    }
    .mobile-nav-item.active {
        color: var(--color-accent-hover);
    }

    /* ─── Mobile ────────────────────────────────────── */
    @media (max-width: 768px) {
        /* A fixed-position sidebar leaves the grid flow, so the content
           auto-placed into the 0px sidebar column and rendered blank.
           Single column + bottom tab bar instead. */
        .app-shell,
        .app-shell.sidebar-collapsed {
            display: block;
        }
        .sidebar {
            display: none;
        }
        .mobile-nav {
            display: flex;
        }
        .main-content {
            height: calc(100dvh - var(--mobile-nav-height));
        }
    }
</style>
