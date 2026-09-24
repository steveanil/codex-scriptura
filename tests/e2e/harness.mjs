/**
 * Shared harness for the headless e2e suites.
 *
 * Uses playwright-core with the system Chrome (no bundled browsers) and a
 * persistent profile in .e2e/chrome-profile so IndexedDB seeding (1-2 min
 * on first run) is paid once, not per run. The dev service worker serves
 * stale modules, so it is always blocked. Starts the dev server on :5199
 * itself if nothing is listening.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const PORT = 5199;
export const BASE = `http://localhost:${PORT}`;

const PROFILE_DIR = fileURLToPath(new URL('../../.e2e/chrome-profile', import.meta.url));

async function serverUp() {
    try {
        const res = await fetch(`${BASE}/read`);
        return res.ok;
    } catch {
        return false;
    }
}

/** Returns the spawned dev-server process, or null if one was already running. */
export async function ensureServer() {
    if (await serverUp()) return null;
    const proc = spawn('pnpm', ['dev', '--port', String(PORT), '--strictPort'], {
        stdio: 'ignore',
        detached: true,
    });
    proc.unref();
    for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await serverUp()) return proc;
    }
    throw new Error(`dev server did not come up on :${PORT}`);
}

export async function launch() {
    return chromium.launchPersistentContext(PROFILE_DIR, {
        executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
        headless: true,
        serviceWorkers: 'block',
        viewport: { width: 1440, height: 900 },
    });
}

/**
 * Open Genesis 1 in a solo reader on KJV. The persistent profile restores
 * whatever a previous run left behind (a crashed suite never reaches its
 * own cleanup): a split in kv.splitPanes, whose solo header controls are
 * hidden while it is up (issue #261), or a translation without Genesis
 * (OEB), which renders the empty state instead of verses (issue #400).
 */
export async function openReader(page) {
    await page.goto(`${BASE}/read?book=Gen&chapter=1`);
    await page.waitForSelector('.reader-content', { timeout: 200000 });
    await page.waitForSelector('.verse[data-verse="1"], .reader-empty', { timeout: 60000 });
    // A release entry opens the What's New modal once per profile; its
    // overlay would otherwise intercept every click below.
    if (await page.locator('.wn-got-it').count() > 0) {
        await page.click('.wn-got-it');
        await page.waitForSelector('.wn-overlay', { state: 'detached', timeout: 5000 }).catch(() => {});
    }
    if (await page.locator('.pane-extra').count() > 0) {
        await page.keyboard.press('Control+\\');
        await page.waitForSelector('.pane-extra', { state: 'detached', timeout: 10000 });
    }
    await page.waitForSelector('#book-selector-toggle', { timeout: 10000 });
    if (await page.locator('.reader-empty').count() > 0) {
        await page.selectOption('#translation-picker', 'KJV');
        await page.waitForSelector('.verse[data-verse="1"]', { timeout: 30000 });
    }
}

/**
 * Make sure a translation is installed. Fresh profiles seed only KJV since
 * on-demand seeding (#239), and the reader pickers list installed
 * translations only, so this drives the Settings Translation Manager's
 * Download button and then reopens the reader.
 */
export async function ensureTranslationInstalled(page, id) {
    await page.goto(`${BASE}/settings#library`);
    const row = page.locator('.translation-row', { hasText: `${id} - ` });
    await row.waitFor({ timeout: 60000 });
    const download = row.getByRole('button', { name: 'Download' });
    if (await download.count() > 0) {
        await download.click();
        // While downloading the row shows a progress bar (no button), then
        // the Installed label. Navigating away earlier aborts the install
        // mid-flight (issue #371), so wait for the label itself, and fail
        // fast if the row reports a download error instead.
        const installed = row.locator('.installed');
        const failed = row.locator('.failed');
        await Promise.race([
            installed.waitFor({ timeout: 200000 }),
            failed.waitFor({ timeout: 200000 }).then(async () => {
                throw new Error(`${id} download failed: ${await failed.textContent()}`);
            }),
        ]);
    }
    await openReader(page);
}

/** Tiny check collector: `check(name, ok, detail)`, then `finish()` exits 0/1. */
export function makeChecker() {
    const results = [];
    return {
        check(name, ok, detail = '') {
            results.push({ name, ok });
            console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
        },
        finish() {
            const fails = results.filter((r) => !r.ok).length;
            console.log(`\n${results.length - fails}/${results.length} checks passed${fails ? ' - FAILURES ABOVE' : ' - ALL PASS'}`);
            process.exit(fails ? 1 : 0);
        },
    };
}
