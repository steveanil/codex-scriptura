/**
 * Deep link into a book the active translation lacks (issue #400).
 *
 * Run with `pnpm test:e2e:coverage`. With OEB active (a partial canon with
 * no Pentateuch), follow the Covenant topic's Deuteronomy 7:9 reference:
 * the reader must say OEB does not include Deuteronomy and offer the
 * installed translations that do, and taking the offer must open Deut 7
 * there. Leaves the profile on KJV.
 */
import { ensureServer, ensureTranslationInstalled, launch, makeChecker, openReader } from './harness.mjs';

const server = await ensureServer();
const { check, finish } = makeChecker();

const ctx = await launch();
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await openReader(page);
await ensureTranslationInstalled(page, 'OEB');

// ── Switch the solo reader to OEB (it has no Genesis, so it lands on its first book) ──
await page.selectOption('#translation-picker', 'OEB');
await page.waitForFunction(() => document.querySelector('#translation-picker')?.value === 'OEB', { timeout: 30000 });
await page.waitForFunction(() => !document.querySelector('.reader-loading'), { timeout: 30000 });
// The preference write is debounced; the next page load reads it, so wait for the row itself
await page.waitForFunction(() => new Promise((resolve) => {
    const req = indexedDB.open('codex-scriptura');
    req.onsuccess = () => {
        const db = req.result;
        const get = db.transaction('settings').objectStore('settings').get('default');
        get.onsuccess = () => { resolve(get.result?.activeTranslation === 'OEB'); db.close(); };
        get.onerror = () => { resolve(false); db.close(); };
    };
    req.onerror = () => resolve(false);
}), { timeout: 10000 });
check('reader is on OEB', await page.locator('#translation-picker').inputValue() === 'OEB');

// ── Follow the topic reference ──
await page.goto(`${new URL(page.url()).origin}/search?topic=covenant`);
const ref = page.locator('.topic-ref[title="Deut.7.9"]').first();
await ref.waitFor({ timeout: 60000 });
await ref.click();
// A cold dev server compiles the reader route on this first navigation
await page.waitForURL(/\/read\?book=Deut&chapter=7/, { timeout: 60000 });
await page.waitForSelector('.reader-empty', { timeout: 60000 });
const emptyText = (await page.locator('.reader-empty').textContent()).replace(/\s+/g, ' ').trim();
check('empty state names the coverage gap', /OEB does not include Deuteronomy/.test(emptyText), emptyText.slice(0, 120));
check('empty state shows the coverage note', /partial translation/.test(emptyText));
check('the old generic line is gone', !/No verses found/.test(emptyText));
// The offers arrive after a per-translation book-list lookup
const offer = page.locator('.reader-empty-actions button', { hasText: 'Open in KJV' });
await offer.waitFor({ timeout: 10000 });
check('offers to open the chapter in KJV', await offer.count() === 1);
// OEB is the stored preference and ineligible, so KJV leads the offers (issue #404)
const firstOffer = (await page.locator('.reader-empty-actions button').first().textContent()).trim();
check('KJV leads the offers when the preference cannot render the book', firstOffer === 'Open in KJV', firstOffer);
check('does not offer OEB itself', await page.locator('.reader-empty-actions button', { hasText: 'Open in OEB' }).count() === 0);

// ── Take the offer ──
await offer.click();
await page.waitForSelector('.verse[data-verse="9"]', { timeout: 30000 });
check('picker follows the switch', await page.locator('#translation-picker').inputValue() === 'KJV');
const heading = (await page.locator('.chapter-heading').first().textContent()).trim();
check('same chapter opens in KJV', heading === 'Deuteronomy 7', heading);
check('empty state is gone', await page.locator('.reader-empty').count() === 0);

check('no page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));

await ctx.close();
if (server) server.kill();
finish();
