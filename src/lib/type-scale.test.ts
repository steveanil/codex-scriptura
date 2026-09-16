/**
 * Type hierarchy guard (issue #251).
 *
 * Components take sizes from the --font-size-* scale and weights the
 * loaded faces actually ship (400/500/600/700): a literal 13.5px or a 550
 * weight is a value the design system does not model. Sectioning uses the
 * shared .section-heading pattern; the uppercase micro-label (.data-label)
 * is for labels attached to a control, never for section titles.
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

const files = walk(SRC).map((p) => ({ path: p.slice(SRC.length + 1), text: readFileSync(p, 'utf8') }));
const appCss = readFileSync(join(SRC, 'app.css'), 'utf8');

describe('type scale', () => {
    it('no component declares a literal pixel font-size', () => {
        const offenders = files.flatMap((f) =>
            [...f.text.matchAll(/font-size:\s*[0-9.]+px/g)].map((m) => `${f.path}: ${m[0]}`)
        );
        expect(offenders).toEqual([]);
    });

    it('no component asks for a weight the faces do not ship', () => {
        const offenders = files.flatMap((f) =>
            [...f.text.matchAll(/font-weight:\s*(\d+)/g)]
                .filter((m) => !['400', '500', '600', '700'].includes(m[1]))
                .map((m) => `${f.path}: ${m[0]}`)
        );
        expect(offenders).toEqual([]);
    });

    it('section headings are 15px/600 primary text and never uppercase', () => {
        const rule = appCss.match(/\.section-heading\s*{([^}]*)}/)?.[1] ?? '';
        expect(rule).toContain('font-size: var(--font-size-md)');
        expect(rule).toContain('font-weight: 600');
        expect(rule).toContain('color: var(--color-text-primary)');
        expect(rule).toContain('text-transform: none');
    });

    it('the surfaces that used uppercase labels for sectioning now use the heading pattern', () => {
        for (const path of [
            'lib/components/AnnotationSidebar.svelte',
            'lib/components/StudyRail.svelte',
            'routes/themes/+page.svelte',
            'lib/components/WhatsNewModal.svelte',
        ]) {
            const f = files.find((x) => x.path === path)!;
            expect(f.text, path).toContain('class="section-heading');
            // A component may not restyle the pattern into a micro-label.
            const local = f.text.match(/\.section-heading\s*{([^}]*)}/)?.[1] ?? '';
            expect(local, path).not.toContain('uppercase');
        }
    });
});

describe('card kicker', () => {
    it('is the only sanctioned uppercase heading and is mono 11px', () => {
        const rule = appCss.match(/\.card-kicker\s*{([^}]*)}/)?.[1] ?? '';
        expect(rule).toContain('font-family: var(--font-mono)');
        expect(rule).toContain('font-size: var(--font-size-2xs)');
        expect(rule).toContain('text-transform: uppercase');
    });
});
