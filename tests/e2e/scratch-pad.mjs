/**
 * Scratch pad e2e suite (issue #23).
 *
 * Run with `pnpm test:e2e:scratch`. Needs system Chrome (CHROME_PATH to
 * override) and seeded app data; the first run on a fresh profile seeds
 * IndexedDB for 1-2 minutes. Covers: toggle via header button and
 * Ctrl+Shift+P, content surviving chapter navigation, "Scratch" on the
 * selection toolbar quoting the selected verse, persistence across
 * reload, and Convert to note promoting into the annotation editor.
 */
import { ensureServer, launch, makeChecker, openReader } from './harness.mjs';

const server = await ensureServer();
const { check, finish } = makeChecker();

const ctx = await launch();
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('dialog', (d) => d.accept());

const padText = () => page.locator('#scratch-pad-text');

await openReader(page);

// ── Open via header button; clean slate from previous runs ──
check('pad starts closed', await page.locator('.scratch-pad.open').count() === 0);
await page.click('#scratch-pad-toggle');
await page.waitForTimeout(400);
check('header button opens the pad', await page.locator('.scratch-pad.open').count() === 1);
if ((await padText().inputValue()).trim()) {
    await page.click('#scratch-pad-clear');
    await page.waitForTimeout(300);
}
check('pad is empty after clear', (await padText().inputValue()) === '');

// ── Keyboard toggle ──
await page.keyboard.press('Control+Shift+KeyP');
await page.waitForTimeout(400);
check('Ctrl+Shift+P closes the pad', await page.locator('.scratch-pad.open').count() === 0);
await page.keyboard.press('Control+Shift+KeyP');
await page.waitForTimeout(400);
check('Ctrl+Shift+P reopens the pad', await page.locator('.scratch-pad.open').count() === 1);

// ── Typed content survives chapter navigation ──
await padText().fill('my scratch thought');
await page.click('#next-chapter');
await page.waitForSelector('.verse[data-verse="1"]', { timeout: 30000 });
check('pad stays open across navigation', await page.locator('.scratch-pad.open').count() === 1);
check('content survives navigation', (await padText().inputValue()).includes('my scratch thought'));

// ── Send a selected verse (now in Gen 2) ──
await page.click('.verse[data-verse="1"]');
await page.waitForSelector('#scratch-pad-send', { timeout: 10000 });
await page.click('#scratch-pad-send');
await page.waitForTimeout(300);
const afterSend = await padText().inputValue();
check('sent verse lands as a quoted block', afterSend.includes('> - Gen 2:1 ('), afterSend.slice(-80));
check('typed text still present', afterSend.includes('my scratch thought'));
await page.click('.selection-toolbar .action-btn:last-child'); // Clear selection

// ── Persistence across reload (wait out the 500ms debounce) ──
await page.waitForTimeout(900);
await page.reload();
await page.waitForSelector('.verse[data-verse="1"]', { timeout: 60000 });
check('pad closed after reload (open state is session-only)', await page.locator('.scratch-pad.open').count() === 0);
await page.click('#scratch-pad-toggle');
await page.waitForTimeout(400);
const reloaded = await padText().inputValue();
check('content persisted across reload', reloaded.includes('my scratch thought') && reloaded.includes('> - Gen 2:1 ('));

// ── Convert to note (whole pad; anchors from the quoted reference) ──
check('convert enabled with a verse reference present', await page.locator('#scratch-pad-convert:not([disabled])').count() === 1);
await page.click('#scratch-pad-convert');
await page.waitForSelector('.annotation-sidebar.open', { timeout: 10000 });
const editorText = await page.locator('.note-textarea').inputValue();
check('note editor prefilled from the pad', editorText.includes('my scratch thought'));
const indicator = (await page.locator('.selection-indicator').textContent()).trim();
check('note anchored to the quoted verse', indicator.includes('Gen 2:1'), indicator);
await page.click('.annotation-sidebar .editor-actions button');
await page.waitForTimeout(500);
check('promoted note appears in the sidebar', (await page.locator('.annotation-card .note-body').allTextContents()).some((t) => t.includes('my scratch thought')));
check('pad unchanged by promotion (non-destructive)', (await padText().inputValue()) === reloaded);

// ── Tidy up: delete the note, clear the pad ──
const cards = page.locator('.annotation-card', { hasText: 'my scratch thought' });
if (await cards.count() > 0) await cards.first().locator('.delete-btn').click();
await page.locator('.sidebar-overlay').click();
await page.click('#scratch-pad-clear');
await page.waitForTimeout(300);
check('manual clear empties the pad', (await padText().inputValue()) === '');

check('no page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));

await ctx.close();
if (server) server.kill();
finish();
