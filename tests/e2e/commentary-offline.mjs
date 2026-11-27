/**
 * Offline commentary suite (issue #366), against a production build.
 *
 * Run with `pnpm build && pnpm test:e2e:commentary:offline`. The dev suites
 * block the service worker, so this one serves the built app with
 * `vite preview` on :5198 and uses a fresh browser profile each time: the
 * Catena must install without being asked for, and after a full page load
 * with the network off the reader and the commentary must still open.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:5198';
const up = () => fetch(`${BASE}/read`).then((r) => r.ok).catch(() => false);
let server = null;
if (!(await up())) {
    server = spawn('pnpm', ['preview', '--port', '5198', '--strictPort'], { stdio: 'ignore', detached: true });
    server.unref();
    for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 1000));
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-offline-'));
const ctx = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
let fails = 0;
const out = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  [' + d + ']' : ''}`); };
const stored = () => page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('codex-scriptura'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const get = (store, run) => new Promise((res, rej) => { const q = run(db.transaction(store).objectStore(store)); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const receipt = await get('datasets', (s) => s.get('commentary:catena-aurea'));
    const rows = await get('commentaryEntries', (s) => s.index('resourceId').count('catena-aurea'));
    db.close(); return { v: receipt?.version, rows };
});
const t0 = Date.now();
await page.goto(`${BASE}/read?book=John&chapter=1`);
await page.waitForSelector('.reader-content', { timeout: 300000 });
await page.waitForSelector('.verse[data-verse="1"]', { timeout: 120000 });
out('fresh profile: the reader opens', true, `${Math.round((Date.now() - t0) / 1000)} s`);
if (await page.locator('.wn-got-it').count() > 0) await page.click('.wn-got-it');
let s = await stored();
for (let i = 0; i < 240 && s.rows !== 822; i++) { await page.waitForTimeout(2000); s = await stored(); }
out('fresh profile: the Catena installs without being asked for', s.rows === 822 && !!s.v, `${s.rows} rows, receipt ${s.v}, ${Math.round((Date.now() - t0) / 1000)} s after first load`);
const sw = await page.evaluate(async () => !!(await navigator.serviceWorker?.getRegistration()));
out('the service worker is registered', sw);
await page.waitForTimeout(8000);
await ctx.setOffline(true);
let reloaded = true;
await page.goto(`${BASE}/read?book=John&chapter=3`).catch((e) => { reloaded = false; console.log(String(e).slice(0, 200)); });
if (reloaded) await page.waitForSelector('.verse[data-verse="1"]', { timeout: 60000 }).catch(() => { reloaded = false; });
out('offline: a full page load of the reader works', reloaded);
if (reloaded) {
    if (await page.locator('.study-rail').count() === 0) await page.click('.rail-toggle-btn');
    if (await page.locator('.commentary-panel').count() === 0) await page.locator('.rail-empty-item', { hasText: 'Commentary' }).click();
    const ok = await page.waitForSelector('.commentary-panel .entry', { timeout: 30000 }).then(() => true).catch(() => false);
    const ids = await page.locator('.commentary-panel .entry').evaluateAll((els) => els.map((e) => e.dataset.entry));
    out('offline: the commentary on John 3 is read from the device', ok && ids.every((i) => i.startsWith('catena-john-3-')), `${ids.length} entries`);
}
out('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
if (server) process.kill(-server.pid);
process.exit(fails ? 1 : 0);
