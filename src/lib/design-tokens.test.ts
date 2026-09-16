/**
 * Design-token regression guard (issue #256).
 *
 * Every `var(--name)` a component uses without a fallback must resolve to a
 * token declared in app.css, set by the layout at runtime, or declared
 * locally in the same file. An undefined token silently collapses to the
 * property's initial value: --radius-full and --shadow-xl rendered square
 * pills and a shadowless toolbar for weeks before anyone noticed.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(svelte|css|ts)$/.test(name) && !name.endsWith('.test.ts')) out.push(p);
    }
    return out;
}

const files = walk(SRC).map((p) => ({ path: p.slice(SRC.length + 1), text: readFileSync(p, 'utf8') }));
const appCss = files.find((f) => f.path === 'app.css')!.text;

const declared = new Set<string>();
for (const m of appCss.matchAll(/(--[\w-]+)\s*:/g)) declared.add(m[1]);
// Tokens the shell projects from preferences at runtime.
for (const f of files) {
    for (const m of f.text.matchAll(/setProperty\(\s*['"](--[\w-]+)['"]/g)) declared.add(m[1]);
}

describe('design tokens', () => {
    it('defines the row-height scale and its density shifts', () => {
        for (const t of ['--row-h-sm', '--row-h-md', '--row-h-lg']) expect(declared.has(t)).toBe(true);
        expect(appCss).toMatch(/\[data-density="compact"\]\s*{[^}]*--row-h-md/);
        expect(appCss).toMatch(/\[data-density="relaxed"\]\s*{[^}]*--row-h-md/);
    });

    it('retired --shadow-glow', () => {
        expect(declared.has('--shadow-glow')).toBe(false);
        for (const f of files) expect(f.text, f.path).not.toContain('--shadow-glow');
    });

    it('models scripture typography as one family the reader reads from (issue #250)', () => {
        for (const t of ['--scripture-size', '--scripture-leading', '--scripture-measure']) expect(declared.has(t)).toBe(true);
        const pane = files.find((f) => f.path === 'lib/components/ReaderPane.svelte')!.text;
        expect(pane).toContain('font-size: var(--scripture-size)');
        expect(pane).toContain('line-height: var(--scripture-leading)');
        expect(pane).toContain('max-width: var(--scripture-measure)');
        // The pre-token names must not creep back in.
        for (const f of files) {
            for (const old of ['--font-reader-size', '--reader-line-height', '--reader-content-padding', '--content-max-width', '--font-reader)']) {
                expect(f.text, `${f.path} uses retired ${old}`).not.toContain(old);
            }
        }
    });

    it('keeps the elevation ladder to raised (hairline) and floating (shadow + scrim)', () => {
        expect(declared.has('--shadow-floating')).toBe(true);
        expect(declared.has('--color-scrim')).toBe(true);
    });

    it('every var(--token) without a fallback resolves to a declared token', () => {
        const missing: string[] = [];
        for (const f of files) {
            const local = new Set<string>();
            for (const m of f.text.matchAll(/(--[\w-]+)\s*:/g)) local.add(m[1]);
            for (const m of f.text.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
                const name = m[1];
                if (declared.has(name) || local.has(name)) continue;
                missing.push(`${f.path}: ${name}`);
            }
        }
        expect(missing).toEqual([]);
    });
});
