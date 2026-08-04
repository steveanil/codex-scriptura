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
