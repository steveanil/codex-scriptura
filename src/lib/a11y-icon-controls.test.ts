/**
 * Icon-only control guard (issue #259).
 *
 * Every <button> or <a> whose visible content is only an icon (an svg, a
 * glyph, nothing textual) must carry an aria-label (its accessible name)
 * and a title (its tooltip). The Button primitive enforces this through
 * its types; this test enforces it for hand-rolled controls.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (name.endsWith('.svelte')) out.push(p);
    }
    return out;
}

const GLYPHS = new Set(['', '×', '✕', '⋯', '…', '▶', '+', '-', '−', '#']);

/** True when the element's inner markup carries no visible text of its own. */
function isIconOnly(inner: string): boolean {
    let body = inner.replace(/<!--[\s\S]*?-->/g, '');
    body = body.replace(/<svg\b[\s\S]*?<\/svg>/g, '');
    // Rendered children or interpolated text count as text; control-flow blocks do not.
    if (/\{@render\b/.test(body)) return false;
    body = body.replace(/\{[#:/@][^}]*\}/g, '');
    if (/\{[^}]+\}/.test(body)) return false;
    body = body.replace(/<[^>]+>/g, '');
    return GLYPHS.has(body.replace(/\s+/g, '').trim());
}

export function findUnlabelledIconControls(): string[] {
    const offenders: string[] = [];
    for (const path of walk(SRC)) {
        const s = readFileSync(path, 'utf8');
        const rel = path.slice(SRC.length + 1);
        // Attributes may contain `=>` inside handlers; only a bare `>` ends the tag.
        for (const m of s.matchAll(/<(button|a)\b((?:=>|[^>])*?)>([\s\S]*?)<\/\1>/g)) {
            const [, tag, attrs, inner] = m;
            if (!isIconOnly(inner)) continue;
            // Spread props delegate the name to the caller (Button, SelectTrigger).
            if (/\{\.\.\.rest\}/.test(attrs)) continue;
            const hasName = /aria-label(ledby)?=/.test(attrs);
            const hasTip = /\btitle=/.test(attrs);
            if (!hasName || !hasTip) {
                const line = s.slice(0, m.index).split('\n').length;
                offenders.push(`${rel}:${line} <${tag}> ${!hasName ? 'no aria-label' : ''}${!hasName && !hasTip ? ', ' : ''}${!hasTip ? 'no title' : ''}`);
            }
        }
    }
    return offenders;
}

describe('icon-only controls', () => {
    it('every icon-only button or link has an aria-label and a title', () => {
        expect(findUnlabelledIconControls()).toEqual([]);
    });
});
