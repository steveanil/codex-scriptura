/**
 * Commentary e2e suite (issue #366), against the real Catena Aurea corpus.
 *
 * Run with `pnpm test:e2e:commentary` after the data pipeline has published
 * static/data/ (setup:catena and copy). Needs system Chrome. Covers: the
 * dataset installing with a receipt, the Study Rail's commentary section in
 * a book with no commentary and in the Gospels, its header, citation status
 * and scanned-page links, following the chapter, narrowing to selected
 * verses, surviving a reload without downloading again, and reading with
 * the network off.
 */
import { BASE, ensureServer, launch, makeChecker, openReader } from './harness.mjs';

const DATASET = 'commentary:catena-aurea';
const RESOURCE = 'catena-aurea';

const server = await ensureServer();
const { check, finish } = makeChecker();
const ctx = await launch();
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
const requested = [];
page.on('request', (r) => { if (r.url().includes('commentary-catena-aurea')) requested.push(r.url()); });

/** Read the app's IndexedDB directly: the receipt for the dataset and how many of its rows are stored. */
const stored = () => page.evaluate(async ([dataset, resource]) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('codex-scriptura'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const get = (store, run) => new Promise((res, rej) => { const q = run(db.transaction(store).objectStore(store)); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const receipt = await get('datasets', (s) => s.get(dataset));
    const rows = await get('commentaryEntries', (s) => s.index('resourceId').count(resource));
    db.close();
    return { receipt, rows };
}, [DATASET, RESOURCE]);

const manifest = await (await fetch(`${BASE}/data/manifest.json`)).json();
const entry = manifest.datasets.find((d) => d.id === DATASET);
check('the manifest carries the Catena dataset', !!entry, entry ? `${entry.recordCount} entries, version ${entry.version}` : 'missing: run setup:catena and copy');
if (!entry) finish();

async function openCommentary() {
    if (await page.locator('.study-rail').count() === 0) await page.click('.rail-toggle-btn');
    await page.waitForSelector('.study-rail');
    if (await page.locator('.commentary-panel').count() === 0) {
        const item = page.locator('.rail-empty-item', { hasText: 'Commentary' });
        if (await item.count()) await item.click();
        else {
            await page.click('[aria-label="Rail options"]');
            await page.getByRole('menuitem', { name: 'Open commentary' }).click();
        }
    }
    await page.waitForSelector('.commentary-panel');
}
const entryIds = () => page.locator('.commentary-panel .entry').evaluateAll((els) => els.map((e) => e.dataset.entry));
async function goto(book, chapter) {
    await page.goto(`${BASE}/read?book=${book}&chapter=${chapter}`);
    await page.waitForSelector('.verse[data-verse="1"]', { timeout: 60000 });
    await openCommentary();
}

// ── Installation ──
await openReader(page);
let state = await stored();
for (let i = 0; i < 150 && state.receipt?.version !== entry.version; i++) {
    await page.waitForTimeout(2000);
    state = await stored();
}
check('the dataset installs in the background and leaves a receipt', state.receipt?.version === entry.version, `receipt ${state.receipt?.version}`);
check('every entry is stored under its resource', state.rows === entry.recordCount, `${state.rows} of ${entry.recordCount}`);

// ── A book the commentary does not cover ──
await openCommentary();
check('the rail has a commentary section', await page.locator('.commentary-panel').count() === 1);
await page.waitForSelector('.commentary-panel header.resource');
const header = await page.locator('.commentary-panel header.resource').innerText();
check('the header names the work, its compiler and edition', /Catena Aurea/.test(header) && /Thomas Aquinas/.test(header) && /Oxford, 1841/.test(header), header.replace(/\s+/g, ' ').slice(0, 120));
check('the header gives the licence and a source link', /Public domain/.test(header) && (await page.locator('.commentary-panel header.resource a[href*="archive.org/details/"]').count()) === 1);
await page.waitForFunction(() => /nothing on Genesis 1/.test(document.querySelector('.commentary-panel')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
check('Genesis 1 shows the empty state, not an error', /This commentary has nothing on Genesis 1/.test(await page.locator('.commentary-panel').innerText()));

// ── The Gospels ──
await goto('Matt', 5);
await page.waitForSelector('.commentary-panel .entry', { timeout: 20000 });
let ids = await entryIds();
check('Matthew 5 shows its entries in order', ids.length > 5 && ids.every((id) => id.startsWith('catena-matt-5-')), `${ids.length} entries, first ${ids[0]}`);
check('one notice says the text is an OCR reading', await page.locator('.commentary-panel .provenance-note').count() === 1);
const first = page.locator('.commentary-panel .entry').first();
const firstText = await first.innerText();
check('an entry names its Fathers and reads as prose', /Chrysostom|Augustine|Jerome|Gloss|Hilary/.test(firstText) && firstText.length > 500);
check('no markup leaks into the text', !/\*\*|\(\*/.test(firstText));
const statuses = await page.locator('.commentary-panel .excerpt-meta').evaluateAll((els) => els.map((e) => e.dataset.citation));
const tally = statuses.reduce((t, s) => ({ ...t, [s]: (t[s] ?? 0) + 1 }), {});
check('every excerpt carries a provenance line', statuses.length > 20, JSON.stringify(tally));
check('unverified citations say so', (tally.unverified ?? 0) > 0 && /Citation unverified \(OCR reading\)/.test(await page.locator('.commentary-panel').innerText()));
const links = await page.locator('.commentary-panel .page-link').evaluateAll((els) => els.map((a) => ({ href: a.href, target: a.target, rel: a.rel })));
check('each excerpt links to its own scanned page', links.length === statuses.length && links.every((l) => /^https:\/\/archive\.org\/details\/catenaaureacomme00thomuoft\/page\/n\d+/.test(l.href) && l.target === '_blank' && /noopener/.test(l.rel)), links[0]?.href);
check('citations are not turned into links', await page.locator('.commentary-panel .commentary a').count() === links.length);
const leaf = await fetch(links[0].href, { redirect: 'follow' }).then((r) => r.status).catch((e) => String(e));
check('a scanned-page link resolves at the Internet Archive', leaf === 200, String(leaf));

// ── Following the passage ──
await page.click('#next-chapter');
await page.waitForFunction(() => document.querySelector('.commentary-panel .entry')?.dataset.entry?.startsWith('catena-matt-6-'), null, { timeout: 20000 }).catch(() => {});
ids = await entryIds();
check('the section follows the reader to the next chapter', ids.length > 0 && ids.every((id) => id.startsWith('catena-matt-6-')), ids[0]);
check('the tab names the chapter it shows', /Matthew 6/.test(await page.locator('.study-rail .rail-header').innerText()));
const all = ids.length;
await page.click('.verse[data-verse="13"]');
await page.waitForFunction((n) => document.querySelectorAll('.commentary-panel .entry').length < n, all, { timeout: 10000 }).catch(() => {});
ids = await entryIds();
check('selecting a verse narrows the section to the entries that cover it', ids.length >= 1 && ids.length < all && ids.includes('catena-matt-6-13'), ids.join(', '));
await page.click('.verse[data-verse="13"]');
await page.waitForFunction((n) => document.querySelectorAll('.commentary-panel .entry').length === n, all, { timeout: 10000 }).catch(() => {});
check('clearing the selection restores the chapter', (await entryIds()).length === all);

// ── Citation status ──
await goto('John', 17);
await page.waitForSelector('.commentary-panel .entry', { timeout: 20000 });
const checked = page.locator('.commentary-panel .excerpt-meta[data-citation="checked"]');
check('a checked citation is marked, and says an AI read it', (await checked.count()) > 0 && /by an AI reading, not yet read by a person/.test(await checked.first().innerText()), (await checked.first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 110));
await goto('John', 6);
await page.waitForSelector('.commentary-panel .entry', { timeout: 20000 });
const unresolved = page.locator('.commentary-panel .excerpt-meta[data-citation="unresolved"]');
check('an unresolved citation shows its open question', (await unresolved.count()) > 0 && /Open question/.test(await unresolved.first().innerText()), (await unresolved.first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 110));
await goto('Matt', 15);
await page.waitForSelector('.commentary-panel .entry', { timeout: 20000 });
const deferred = page.locator('.commentary-panel [data-entry="catena-matt-15-32-38"] .excerpt-meta', { has: page.locator('.status.incomplete') });
check('the excerpt under the gate exception is marked as possibly incomplete, with its question', (await deferred.count()) === 1 && /This excerpt may be incomplete/.test(await deferred.innerText()) && /Is a line of this excerpt missing\?/.test(await deferred.innerText()));
check('it links both scanned pages the excerpt runs over', JSON.stringify(await deferred.locator('.page-link').evaluateAll((els) => els.map((a) => a.href.split('/page/')[1]))) === '["n176","n177"]');

// ── Persistence ──
requested.length = 0;
await page.reload();
await page.waitForSelector('.verse[data-verse="1"]', { timeout: 60000 });
await page.waitForTimeout(4000);
state = await stored();
check('the receipt and rows survive a reload', state.receipt?.version === entry.version && state.rows === entry.recordCount);
check('a reload does not download the commentary again', requested.length === 0, requested.join(' '));

// ── Reading with the network off ──
await openCommentary();
await page.waitForSelector('.commentary-panel .entry', { timeout: 20000 });
await ctx.setOffline(true);
await page.click('#next-chapter');
await page.waitForFunction(() => document.querySelector('.commentary-panel .entry')?.dataset.entry?.startsWith('catena-matt-16-'), null, { timeout: 20000 }).catch(() => {});
ids = await entryIds();
check('with the network off, the next chapter and its commentary still load', ids.length > 0 && ids.every((id) => id.startsWith('catena-matt-16-')), ids[0]);
await ctx.setOffline(false);

// ── Beside the other rail sections ──
const options = page.locator('[aria-label="Rail options"]');
if (await options.count()) {
    await options.click();
    const who = page.getByRole('menuitem', { name: /who's here/i });
    if (await who.count()) {
        await who.click();
        await page.waitForTimeout(500);
        check('another section opens beside the commentary as its own tab', await page.locator('.study-rail .rail-tab').count() >= 2);
        await page.locator('.study-rail .rail-tab', { hasText: 'Commentary' }).click();
        await page.waitForSelector('.commentary-panel .entry', { timeout: 10000 });
        check('switching back to the commentary tab keeps its place', (await entryIds()).every((id) => id.startsWith('catena-matt-16-')));
    } else await page.keyboard.press('Escape');
}

check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await ctx.close();
if (server) process.kill(-server.pid);
finish();
