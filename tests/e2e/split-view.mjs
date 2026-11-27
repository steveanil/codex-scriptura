/**
 * Split view + divergence e2e suite (issue #24 and follow-ups).
 *
 * Run with `pnpm test:e2e`. Needs system Chrome (CHROME_PATH to override)
 * and seeded app data; the first run on a fresh profile seeds IndexedDB
 * for 1-2 minutes. Covers: split open/close, toolbar toggles, divergence
 * shading + zero-re-render toggle, Divergence Map, comparison status,
 * translation-scoped highlights, verse-anchored sync scroll, cross-pane
 * hover linking, persistence across reload, the overflow contract, and the
 * 3 -> 2 -> 1 close sequence after a divider drag (issue #398).
 */
import { ensureServer, ensureTranslationInstalled, launch, makeChecker, openReader } from './harness.mjs';

const server = await ensureServer();
const { check, finish } = makeChecker();

const ctx = await launch();
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

const pane0 = () => page.locator('.pane-wrapper').first();
const pane1 = () => page.locator('.pane-extra');

await openReader(page);
// A fresh profile has only KJV; the split needs a second translation to compare
await ensureTranslationInstalled(page, 'WEB');

// ── Solo header: reading time lives in the passage picker (issue #246) ──
await page.click('#book-selector-toggle');
const chip = await page.locator('.passage-picker .reading-time').textContent();
check('reading-time chip is minutes only', /^~\d+ min$/.test(chip.trim()), chip.trim());
await page.keyboard.press('Escape');
await page.waitForSelector('.passage-picker', { state: 'detached' });

// ── Open split ──
await page.click('#split-pane-btn');
await page.waitForSelector('.pane-extra .reader-content', { timeout: 30000 });
await page.waitForFunction(() => !document.querySelector('.pane-extra .reader-loading'), { timeout: 30000 });
check('split opens with per-pane headers', await page.locator('.pane-header').count() === 2);
for (const id of ['sync-scroll-toggle', 'refs-toggle', 'divergence-toggle', 'dv-map-toggle']) {
    check(`toolbar has #${id}`, await page.locator(`#${id}`).count() === 1);
}
// Normalize toggles the profile may have persisted off
for (const id of ['refs-toggle', 'divergence-toggle']) {
    if (await page.locator(`#${id}[aria-pressed="false"]`).count() > 0) await page.click(`#${id}`);
}
if (await page.locator('#sync-scroll-toggle[aria-pressed="true"]').count() > 0) await page.click('#sync-scroll-toggle');
if (await page.locator('#dv-map-toggle[aria-pressed="true"]').count() > 0) await page.click('#dv-map-toggle');

const t0 = await pane0().locator('.translation-picker').inputValue();
let t1 = await pane1().locator('.translation-picker').inputValue();
check('new pane picked an unused translation', t0 !== t1, `${t0} vs ${t1}`);
// A profile holding OEB (the coverage suite installs it) must never get it
// for Genesis: the pick is capability-aware (issue #404)
check('new pane can render the chapter', t1 !== 'OEB' && await pane1().locator('.verse[data-verse="1"]').count() === 1, t1);
// The comparisons below are written against WEB specifically
if (t1 !== 'WEB') {
    await pane1().locator('.translation-picker').selectOption('WEB');
    await page.waitForFunction(() => document.querySelector('.pane-extra .translation-picker')?.value === 'WEB', { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('.pane-extra .reader-loading'), { timeout: 30000 });
    t1 = 'WEB';
}
if (t0 === t1) {
    // Nothing below can pass without two translations; bail before the divergence wait hangs
    await ctx.close();
    if (server) server.kill();
    finish();
}

// ── Comparison status (toolbar) ──
const status = (await page.locator('#compare-status').textContent()).trim();
check('status names the compared translations', status.startsWith('Comparing'), status);
check('Divergence enabled while comparable', await page.locator('#divergence-toggle:not([disabled])').count() === 1);

// ── Divergence shading ──
await page.waitForFunction(() => document.querySelectorAll('.reader-content .dv').length > 0, { timeout: 30000 });
const dvPane0 = await pane0().locator('.reader-content .dv').count();
const dvPane1 = await pane1().locator('.reader-content .dv').count();
check('divergence spans render in both panes', dvPane0 > 0 && dvPane1 > 0, `${dvPane0} / ${dvPane1} spans`);

// Toggle: spans stay in the DOM (zero re-render), only the shade flips
const shadeBefore = await page.locator('.reader-content .dv').first().evaluate((el) => getComputedStyle(el).backgroundColor);
await page.click('#divergence-toggle');
await page.waitForTimeout(200);
const dvAfterToggle = await pane0().locator('.reader-content .dv').count();
const shadeAfter = await page.locator('.reader-content .dv').first().evaluate((el) => getComputedStyle(el).backgroundColor);
check('divergence toggle keeps spans in DOM', dvAfterToggle === dvPane0, `${dvPane0} -> ${dvAfterToggle}`);
check('divergence toggle clears the shade', shadeBefore !== shadeAfter && /rgba\(0, 0, 0, 0\)|transparent/.test(shadeAfter));
await page.click('#divergence-toggle');

// ── Nothing comparable: status explains, toggles disable, shading clears ──
await page.locator('.pane-extra [aria-label="Next chapter"]').click();
await page.waitForFunction(() => !document.querySelector('.pane-extra .reader-loading'), { timeout: 30000 });
await page.waitForTimeout(300);
const awayStatus = (await page.locator('#compare-status').textContent()).trim();
check('status explains different passages', awayStatus === 'Panes show different passages', awayStatus);
check('Divergence disables when nothing comparable', await page.locator('#divergence-toggle[disabled]').count() === 1);
check('Map disables when nothing comparable and closed', await page.locator('#dv-map-toggle[disabled]').count() === 1);
check('shading clears when panes diverge in passage', await page.locator('.reader-content .dv').count() === 0);
await page.locator('.pane-extra [aria-label="Previous chapter"]').click();
await page.waitForFunction(() => !document.querySelector('.pane-extra .reader-loading'), { timeout: 30000 });
await page.waitForFunction(() => document.querySelectorAll('.reader-content .dv').length > 0, { timeout: 30000 });
check('comparison recovers when panes reunite', (await page.locator('#compare-status').textContent()).trim().startsWith('Comparing'));

// ── Divergence Map ──
await page.click('#dv-map-toggle');
await page.waitForSelector('.dv-map', { timeout: 10000 });
await page.waitForFunction(() => document.querySelectorAll('.dv-card').length > 0, { timeout: 15000 });
check('map opens with cards', await page.locator('.dv-card').count() > 0);
await page.locator('.dv-card').first().click();
await page.waitForTimeout(600);
check('card click flashes the verse', await page.locator('.verse-flash').count() >= 1);
await page.click('#dv-map-toggle');

// ── Refs toggle ──
const badgesOn = await pane0().locator('.verse-badges').count();
await page.click('#refs-toggle');
await page.waitForTimeout(200);
check('refs toggle hides inline badges', badgesOn > 0 && await page.locator('.verse-badges').count() === 0, `${badgesOn} -> 0`);
await page.click('#refs-toggle');

// ── Cross-pane hover linking ──
await pane0().locator('.verse[data-verse="5"]').hover();
await page.waitForTimeout(150);
check('hovered verse echoes in the sibling pane', await page.locator('.pane-extra .verse[data-verse="5"].linked-hover').count() === 1);
await page.locator('#compare-status').hover();
await page.waitForTimeout(150);
check('hover echo clears on leave', await page.locator('.linked-hover').count() === 0);

// ── Divergence popover (click a shaded word) ──
// The map card click above scrolled pane 0 away from verse 1. Scroll back and
// let the scroll event settle first: pane scrolls close the popover, and a
// scroll-then-click in one motion lands the scroll event after the click.
const firstDv = pane0().locator('.reader-content .dv').first();
await firstDv.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await firstDv.click();
await page.waitForSelector('.dv-popover', { timeout: 5000 });
check('clicking a shaded word opens the popover', await page.locator('.dv-popover').count() === 1);
check('popover shows every compared rendering', await page.locator('.dv-popover .dv-render').count() >= 2);
check('clicking a shaded word does not select the verse', await page.locator('.selection-toolbar').count() === 0);
const wsHref = await page.locator('.dv-word-study-link').count()
    ? await page.locator('.dv-word-study-link').getAttribute('href')
    : '';
check("Word Study link carries the Strong's number", /\/search\?q=[GH]\d+.*mode=concordance/.test(wsHref), wsHref || 'no lexicon row');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('Escape closes the popover', await page.locator('.dv-popover').count() === 0);

// ── Translation-scoped highlights ──
await pane0().locator('.verse[data-verse="3"]').click();
await page.waitForSelector('.selection-toolbar', { timeout: 5000 });
await page.locator('.color-picker .color-btn').first().click();
await page.waitForTimeout(600);
const bg0 = await pane0().locator('.verse[data-verse="3"]').evaluate((el) => el.style.backgroundColor);
const bg1 = await page.locator('.pane-extra .verse[data-verse="3"]').evaluate((el) => el.style.backgroundColor);
check('highlight tints only its own translation', !!bg0 && !bg1, `pane0=${bg0} pane1=${bg1 || 'clear'}`);
await pane0().locator('.verse[data-verse="3"]').click();
await page.waitForSelector('.selection-toolbar', { timeout: 5000 });
await page.locator('.eraser-btn').click();
await page.waitForTimeout(400);

// ── Verse-anchored sync scroll ──
await page.click('#sync-scroll-toggle');
await page.waitForTimeout(300);
await page.evaluate(() => {
    const pane = document.querySelector('.reader-content');
    const v = pane.querySelector('.verse[data-verse="15"]');
    pane.scrollTop = pane.scrollTop + v.getBoundingClientRect().top - pane.getBoundingClientRect().top;
});
await page.waitForTimeout(500);
const [top0, top1] = await page.evaluate(() => {
    const topVerse = (pane) => {
        const top = pane.getBoundingClientRect().top;
        for (const el of pane.querySelectorAll('.verse[data-verse]')) {
            const r = el.getBoundingClientRect();
            if (r.height > 0 && r.bottom > top + 1) return Number(el.dataset.verse);
        }
        return -1;
    };
    const panes = document.querySelectorAll('.reader-content');
    return [topVerse(panes[0]), topVerse(panes[1])];
});
check('sync scroll anchors on the same verse', top0 === 15 && top1 === 15, `pane0 top=${top0}, pane1 top=${top1}`);

// ── Persistence across reload (sync scroll stays on from the anchor test) ──
await page.waitForTimeout(600);
await page.reload();
await page.waitForSelector('.pane-extra .reader-content', { timeout: 60000 });
await page.waitForFunction(() => !document.querySelector('.pane-extra .reader-loading'), { timeout: 30000 });
check('split restores after reload', await pane1().count() === 1);
check('sync scroll restored', await page.locator('#sync-scroll-toggle[aria-pressed="true"]').count() === 1);
await page.waitForFunction(() => document.querySelectorAll('.reader-content .dv').length > 0, { timeout: 30000 });
await page.click('#sync-scroll-toggle');

// ── Overflow contract at 1000px with map open ──
await page.setViewportSize({ width: 1000, height: 800 });
await page.click('#dv-map-toggle');
await page.waitForTimeout(400);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('no horizontal overflow at 1000px (split + map)', overflow === 0, `delta=${overflow}`);
await page.click('#dv-map-toggle');

// ── Close ──
await page.keyboard.press('Control+\\');
await page.waitForTimeout(500);
check('Ctrl+\\ closes the split', await pane1().count() === 0);
check('solo passage bar returns', await page.locator('#book-selector-toggle').count() === 1);

// ── Issue #398: 3 -> 2 -> 1 after a drag leaves the last pane full width ──
// Weights carry the flex-grow factors; a lone pane left at its dragged
// weight (< 1) only gets that fraction of the row. Two runs: squeeze a
// different pane each time and close the survivors in the opposite order.
await page.setViewportSize({ width: 1440, height: 900 });
const paneBoxes = () => page.locator('.pane-wrapper').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
const rowWidth = () => page.locator('.panes-row').evaluate((el) => el.clientWidth);
async function openThreePanes() {
    for (let i = 0; i < 2; i++) {
        await page.click('#split-pane-btn');
        await page.waitForFunction((n) => document.querySelectorAll('.pane-extra .reader-content').length === n, i + 1, { timeout: 30000 });
    }
    await page.waitForFunction(() => !document.querySelector('.reader-loading'), { timeout: 30000 });
}
async function dragDivider(index, deltaX) {
    const box = await page.locator('.pane-divider').nth(index).boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + deltaX / 2, y, { steps: 5 });
    await page.mouse.move(x + deltaX, y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);
}
async function closeExtra(index) {
    await page.locator('.pane-extra .pane-close-btn').nth(index).click();
    await page.waitForTimeout(300);
}

for (const run of [
    { label: 'squeeze pane 0, close right then left', divider: 0, delta: -700, closes: [1, 0] },
    { label: 'squeeze pane 2, close left then right', divider: 1, delta: 700, closes: [0, 0] },
]) {
    await openThreePanes();
    check(`[${run.label}] three panes open`, await page.locator('.pane-wrapper').count() === 3);
    const before = await paneBoxes();
    await dragDivider(run.divider, run.delta);
    const after = await paneBoxes();
    const squeezed = run.divider === 0 ? 0 : 2;
    check(`[${run.label}] drag narrowed the target pane`, after[squeezed] < before[squeezed] - 100, `${before[squeezed].toFixed(0)} -> ${after[squeezed].toFixed(0)}`);

    await closeExtra(run.closes[0]);
    const twoWidths = await paneBoxes();
    const twoSum = twoWidths.reduce((a, b) => a + b, 0) + 5; // + the one divider
    check(`[${run.label}] two survivors fill the row`, Math.abs(twoSum - await rowWidth()) <= 2, `${twoWidths.map((w) => w.toFixed(0)).join('+')} vs row ${await rowWidth()}`);

    await closeExtra(run.closes[1]);
    const soloWidth = (await paneBoxes())[0];
    const row = await rowWidth();
    check(`[${run.label}] last pane spans the row`, Math.abs(soloWidth - row) <= 1, `${soloWidth.toFixed(0)} vs ${row}`);
    check(`[${run.label}] no divider left behind`, await page.locator('.pane-divider').count() === 0);
    check(`[${run.label}] no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) === 0);
    check(`[${run.label}] back to a solo reader`, await pane1().count() === 0 && await page.locator('#book-selector-toggle').count() === 1);
}

check('no page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));

await ctx.close();
if (server) server.kill();
finish();
