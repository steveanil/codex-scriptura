/**
 * WCAG contrast for the accent picker: the accent is link and control
 * text on both theme backgrounds, so it has to hold AA (4.5:1) on each.
 */
import { hexToRgb, relativeLuminance } from './color';

/** Fallbacks for environments without a stylesheet (tests, SSR); the browser reads the real tokens. */
export const DARK_BG = '#0f1319';
export const LIGHT_BG = '#faf9fc';
export const AA_TEXT = 4.5;

let probe: HTMLElement | null = null;

/**
 * The page background of a theme as app.css defines it right now. The
 * [data-theme] selector matches any element, so a detached probe carrying
 * the attribute resolves that theme's --color-bg without switching the page.
 */
export function themeBackground(theme: 'dark' | 'light'): string {
    if (typeof document === 'undefined') return theme === 'dark' ? DARK_BG : LIGHT_BG;
    if (!probe) {
        probe = document.createElement('div');
        probe.hidden = true;
        probe.setAttribute('aria-hidden', 'true');
        document.body.appendChild(probe);
    }
    if (theme === 'light') probe.dataset.theme = 'light';
    else delete probe.dataset.theme;
    const v = getComputedStyle(probe).getPropertyValue('--color-bg').trim();
    return isHex(v) ? v : theme === 'dark' ? DARK_BG : LIGHT_BG;
}

export function contrastRatio(fg: string, bg: string): number {
    const a = relativeLuminance(fg);
    const b = relativeLuminance(bg);
    const [hi, lo] = a >= b ? [a, b] : [b, a];
    return (hi + 0.05) / (lo + 0.05);
}

export function isHex(value: string): boolean {
    return hexToRgb(value) !== null;
}

/** "6.4:1", one decimal, for the readout. */
export function formatRatio(ratio: number): string {
    return `${ratio.toFixed(1)}:1`;
}

function toHex([r, g, b]: [number, number, number]): string {
    return '#' + [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
}

/**
 * The nearest darker shade of `hex` that reaches `target` on `bg`, mixing
 * toward black in small steps and keeping the hue. Returns the input when
 * it already passes, and black's neighbourhood when nothing else does.
 */
export function darkenUntil(hex: string, bg: string, target = AA_TEXT): string {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    if (contrastRatio(hex, bg) >= target) return hex;
    for (let step = 1; step <= 40; step++) {
        const amount = step / 40;
        const candidate = toHex([rgb[0] * (1 - amount), rgb[1] * (1 - amount), rgb[2] * (1 - amount)]);
        if (contrastRatio(candidate, bg) >= target) return candidate;
    }
    return '#000000';
}
