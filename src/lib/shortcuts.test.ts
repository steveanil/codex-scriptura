import { describe, expect, it } from 'vitest';
import { SHORTCUTS, renderKey } from './shortcuts';

describe('shortcuts', () => {
    it('every shortcut has a label, keys and a scope, with unique ids', () => {
        for (const s of SHORTCUTS) {
            expect(s.label.length).toBeGreaterThan(0);
            expect(s.keys.length).toBeGreaterThan(0);
            expect(['global', 'reader', 'search', 'palette']).toContain(s.scope);
        }
        expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
    });
    it('renders the modifier per platform', () => {
        expect(renderKey('mod', true)).toBe('⌘');
        expect(renderKey('mod', false)).toBe('Ctrl');
        expect(renderKey('K', true)).toBe('K');
    });
});
