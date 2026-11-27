/**
 * Commentary in the Study Rail: tabs, the phone layout, and switching
 * between two commentaries (issue #366).
 *
 * Run with `pnpm test:e2e:commentary:rail` after static/data/ holds the
 * Catena. The first two parts use the shared profile. The third needs a
 * second commentary, which no build ships yet, so it serves a small
 * fixture resource through the manifest by request interception and uses a
 * throwaway profile, which the fixture never leaves.
 *
 * Pass a directory as the first argument to keep screenshots of the phone
 * layout there.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { BASE, ensureServer, launch, makeChecker, openReader } from './harness.mjs';

const shots = process.argv[2];
const server = await ensureServer();
const { check, finish } = makeChecker();
const pageErrors = [];
const watch = (page) => page.on('pageerror', (e) => pageErrors.push(String(e)));
const entryIds = (page) => page.locator('.commentary-panel .entry').evaluateAll((els) => els.map((e) => e.dataset.entry));
// At least one entry, and every one from the chapter, so a check cannot pass on an empty panel
const allFrom = (ids, prefix) => ids.length > 0 && ids.every((id) => id.startsWith(prefix));
const tabs = (page) => page.locator('.study-rail .rail-tab').evaluateAll((els) => els.map((e) => `${e.querySelector('.rail-tab-title').textContent}${e.getAttribute('aria-selected') === 'true' ? '*' : ''}`));

// ── Tabs ──
let ctx = await launch();
let page = await ctx.newPage();
watch(page);
await openReader(page);
await page.goto(`${BASE}/read?book=John&chapter=3`);
await page.waitForSelector('.verse[data-verse="1"]', { timeout: 60000 });
if (await page.locator('.study-rail').count() === 0) await page.click('.rail-toggle-btn');
await page.waitForSelector('.study-rail');
if (await page.locator('.rail-empty').count() === 0) {
    await page.click('[aria-label="Rail options"]');
    await page.getByRole('menuitem', { name: 'Close all tabs' }).click();
}
await page.waitForSelector('.rail-empty');
check('the empty rail offers the commentary beside its other sections', await page.locator('.rail-empty-item', { hasText: 'Commentary' }).count() === 1);
await page.locator('.rail-empty-item').first().click();
await page.waitForFunction(() => /Who's here/.test(document.querySelector('.study-rail .rail-header')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
check('another section opens first', /Who's here/.test(await page.locator('.study-rail .rail-header').innerText()));
await page.click('[aria-label="Rail options"]');
await page.getByRole('menuitem', { name: 'Open commentary' }).click();
await page.waitForSelector('.commentary-panel .entry', { timeout: 20000 });
check('the commentary opens as a second tab and becomes the active one', JSON.stringify(await tabs(page)) === JSON.stringify(["Who's here", 'Commentary*']), (await tabs(page)).join(' | '));
await page.click('[aria-label="Rail options"]');
check('the menu no longer offers to open a commentary that is open', await page.getByRole('menuitem', { name: 'Open commentary' }).count() === 0);
await page.keyboard.press('Escape');
await page.locator('.rail-menu-overlay').click().catch(() => {});
await page.locator('.study-rail .rail-tab', { hasText: "Who's here" }).click();
await page.waitForFunction(() => !document.querySelector('.commentary-panel'), null, { timeout: 5000 }).catch(() => {});
check('switching tabs shows the other section', await page.locator('.commentary-panel').count() === 0 && (await tabs(page))[0] === "Who's here*");
await page.click('#next-chapter');
await page.waitForFunction(() => /John\s+4/.test(document.querySelector('.reader-content')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
await page.locator('.study-rail .rail-tab', { hasText: 'Commentary' }).click();
await page.waitForFunction(() => document.querySelector('.commentary-panel .entry')?.dataset.entry?.startsWith('catena-john-4-'), null, { timeout: 20000 }).catch(() => {});
check('a commentary tab left in the background has followed the chapter when it is brought back', allFrom(await entryIds(page), 'catena-john-4-') && /John 4/.test(await page.locator('.study-rail .rail-header').innerText()), (await entryIds(page))[0]);
await page.locator('.study-rail .rail-tab[aria-selected="true"]').focus();
await page.keyboard.press('ArrowLeft');
check('the arrow keys move between tabs', (await tabs(page))[0] === "Who's here*", (await tabs(page)).join(' | '));
await page.keyboard.press('ArrowRight');
await page.click('.rail-close');
await page.waitForFunction(() => !document.querySelector('.commentary-panel'), null, { timeout: 5000 }).catch(() => {});
check('closing the commentary tab leaves the other tab open', await page.locator('.commentary-panel').count() === 0 && /Who's here/.test(await page.locator('.study-rail .rail-header').innerText()));
await page.click('[aria-label="Rail options"]');
await page.getByRole('menuitem', { name: 'Open commentary' }).click();
await page.waitForSelector('.commentary-panel .entry', { timeout: 20000 });
await page.click('[aria-label="Rail options"]');
await page.getByRole('menuitem', { name: 'Hide rail, keep tabs' }).click();
check('hiding the rail takes the section off the page', await page.locator('.study-rail').count() === 0);
await page.click('.rail-toggle-btn');
await page.waitForSelector('.commentary-panel .entry', { timeout: 20000 });
check('showing the rail again brings the commentary back as it was', allFrom(await entryIds(page), 'catena-john-4-'));

// ── Phone layout ──
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/read?book=Matt&chapter=5`);
await page.waitForSelector('.verse[data-verse="1"]', { timeout: 60000 });
const toggle = page.locator('.rail-toggle-btn');
check('the rail toggle is reachable on a phone', await toggle.isVisible());
if (await page.locator('.study-rail').count() === 0) await toggle.click();
await page.waitForSelector('.study-rail');
if (await page.locator('.commentary-panel').count() === 0) {
    const item = page.locator('.rail-empty-item', { hasText: 'Commentary' });
    if (await item.count()) await item.click();
    else if (await page.locator('.study-rail .rail-tab', { hasText: 'Commentary' }).count()) await page.locator('.study-rail .rail-tab', { hasText: 'Commentary' }).click();
    else {
        await page.click('[aria-label="Rail options"]');
        await page.getByRole('menuitem', { name: 'Open commentary' }).click();
    }
}
await page.waitForSelector('.commentary-panel .entry', { timeout: 20000 });
await page.waitForTimeout(600);
const box = await page.locator('.study-rail').boundingBox();
check('on a phone the rail is a sheet across the foot of the screen', box.x === 0 && Math.round(box.width) === 390 && box.y > 200 && box.y + box.height <= 844, JSON.stringify(box));
const overflow = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth, panel: document.querySelector('.commentary-panel').scrollWidth, panelBox: document.querySelector('.commentary-panel').clientWidth }));
check('nothing overflows sideways', overflow.doc <= overflow.win && overflow.panel <= overflow.panelBox, JSON.stringify(overflow));
const wide = await page.locator('.commentary-panel .excerpt-meta, .commentary-panel .page-link, .commentary-panel header.resource, .commentary-panel p').evaluateAll((els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.right > window.innerWidth + 1 || r.left < -1; }).length);
check('every status line, link and paragraph sits inside the screen', wide === 0, `${wide} outside`);
check('the header, the notice and the first entry can be read in the sheet', await page.locator('.commentary-panel header.resource h3').isVisible() && await page.locator('.commentary-panel .provenance-note').count() === 1);
const link = page.locator('.commentary-panel .page-link').first();
await link.scrollIntoViewIfNeeded();
const lb = await link.boundingBox();
check('a scanned-page link is big enough to tap and inside the sheet', lb.height >= 14 && lb.y >= box.y && lb.y + lb.height <= box.y + box.height + 1, JSON.stringify(lb));
check('the verses stay readable above the sheet', await page.locator('.verse[data-verse="1"]').isVisible());
if (shots) await page.screenshot({ path: path.join(shots, 'phone-sheet.png') });
await page.locator('.rail-scrim').click({ position: { x: 195, y: 80 } }).catch(() => {});
await page.waitForTimeout(400);
check('tapping outside the sheet puts it away', await page.locator('.study-rail').count() === 0);
await page.setViewportSize({ width: 1440, height: 900 });
await ctx.close();

// ── Two commentaries ──
const FIX = { resource: 'fixture-commentary', dataset: 'commentary:fixture', file: 'commentary-fixture.json' };
const entries = [
    { id: 'fx-john-3-16', startRef: 'John.3.16', endRef: 'John.3.17', content: '> For God so loved the world.\n\n**Fixture Father.** (*Fix. Hom. i.*) A second commentary speaks here, in its own words.' },
    { id: 'fx-matt-5-1', startRef: 'Matt.5.1', endRef: 'Matt.5.2', content: '**Fixture Father.** On the mount.' },
];
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-two-commentaries-'));
ctx = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
await ctx.route('**/data/manifest.json', async (route) => {
    const manifest = await (await route.fetch()).json();
    const catena = manifest.resources.find((r) => r.id === 'catena-aurea');
    const dataset = manifest.datasets.find((d) => d.id === 'commentary:catena-aurea');
    manifest.resources.push({ ...catena, id: FIX.resource, title: 'Fixture Commentary', author: 'Fixture Author', publisher: 'Fixture Press, 1900', description: 'A second commentary for the switcher test', provenance: [{ ...catena.provenance[0], sourceId: 'fixture-source', name: 'Fixture source', url: 'https://example.org/fixture' }] });
    manifest.datasets.push({ ...dataset, id: FIX.dataset, resourceId: FIX.resource, version: 'fixture00001', contentHash: 'f'.repeat(64), recordCount: entries.length, bytes: JSON.stringify(entries).length, files: [FIX.file] });
    await route.fulfill({ json: manifest });
});
await ctx.route(`**/data/${FIX.file}`, (route) => route.fulfill({ json: entries }));
page = await ctx.newPage();
watch(page);
await openReader(page);
const installed = () => page.evaluate(async (ids) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('codex-scriptura'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const got = await Promise.all(ids.map((id) => new Promise((res) => { const q = db.transaction('datasets').objectStore('datasets').get(id); q.onsuccess = () => res(!!q.result); q.onerror = () => res(false); })));
    db.close();
    return got.every(Boolean);
}, ['commentary:catena-aurea', FIX.dataset]);
let both = await installed();
for (let i = 0; i < 150 && !both; i++) { await page.waitForTimeout(2000); both = await installed(); }
check('two commentaries install side by side', both);
await page.goto(`${BASE}/read?book=John&chapter=3`);
await page.waitForSelector('.verse[data-verse="1"]', { timeout: 60000 });
await page.click('.rail-toggle-btn');
await page.locator('.rail-empty-item', { hasText: 'Commentary' }).click();
await page.waitForSelector('.commentary-panel .entry', { timeout: 20000 });
const pick = page.locator('.commentary-panel .resource-pick select');
check('with two installed the section offers a choice', await pick.count() === 1 && JSON.stringify(await pick.locator('option').allInnerTexts()) === JSON.stringify(['Catena Aurea', 'Fixture Commentary']));
check('it opens on the first, the Catena', allFrom(await entryIds(page), 'catena-john-3-') && /Thomas Aquinas/.test(await page.locator('.commentary-panel header.resource').innerText()));
await page.evaluate(() => { window.__sameDocument = true; });
await pick.selectOption(FIX.resource);
await page.waitForFunction(() => document.querySelector('.commentary-panel .entry')?.dataset.entry === 'fx-john-3-16', null, { timeout: 10000 }).catch(() => {});
let head = await page.locator('.commentary-panel header.resource').innerText();
check('choosing the other shows its entries and its own author, publisher and source', JSON.stringify(await entryIds(page)) === '["fx-john-3-16"]' && /Fixture Commentary/.test(head) && /Fixture Author/.test(head) && /Fixture Press, 1900/.test(head) && (await page.locator('.commentary-panel header.resource a').getAttribute('href')) === 'https://example.org/fixture', head.replace(/\s+/g, ' ').slice(0, 100));
check('nothing of the first commentary is left on show', !/Chrysostom|Augustine/.test(await page.locator('.commentary-panel').innerText()) && /A second commentary speaks here/.test(await page.locator('.commentary-panel').innerText()));
check('a commentary with no excerpt records shows no OCR notice or status lines', await page.locator('.commentary-panel .provenance-note').count() === 0 && await page.locator('.commentary-panel .excerpt-meta').count() === 0);
await page.click('#next-chapter');
await page.waitForFunction(() => /nothing on John 4/.test(document.querySelector('.commentary-panel')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
check('the choice holds across a chapter change, with its own empty state', /This commentary has nothing on John 4/.test(await page.locator('.commentary-panel').innerText()) && (await pick.inputValue()) === FIX.resource);
await pick.selectOption('catena-aurea');
await page.waitForFunction(() => document.querySelector('.commentary-panel .entry')?.dataset.entry?.startsWith('catena-john-4-'), null, { timeout: 10000 }).catch(() => {});
check('switching back shows the Catena on the chapter now open', (await entryIds(page)).length > 0 && (await entryIds(page)).every((id) => id.startsWith('catena-john-4-')));
check('all of it without a reload', await page.evaluate(() => window.__sameDocument === true));
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });

check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
if (server) process.kill(-server.pid);
finish();
