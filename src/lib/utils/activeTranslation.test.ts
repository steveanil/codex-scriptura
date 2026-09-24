import { describe, it, expect } from 'vitest';
import { resolveActiveTranslation } from './activeTranslation';

describe('resolveActiveTranslation (issue #401)', () => {
    it('a fresh profile opens on KJV, and that is not a fallback', () => {
        expect(resolveActiveTranslation(undefined, ['KJV'])).toEqual({ id: 'KJV', fellBack: false });
        expect(resolveActiveTranslation(undefined, ['ASV', 'KJV', 'WEB'])).toEqual({ id: 'KJV', fellBack: false });
    });

    it('honours the persisted translation when it is installed', () => {
        expect(resolveActiveTranslation('WEB', ['KJV', 'WEB'])).toEqual({ id: 'WEB', fellBack: false });
        expect(resolveActiveTranslation('OEB', ['KJV', 'OEB'])).toEqual({ id: 'OEB', fellBack: false });
    });

    it('a persisted translation that is not installed falls back to KJV, not to the first in catalog order', () => {
        expect(resolveActiveTranslation('WEB', ['ASV', 'BSB', 'KJV'])).toEqual({ id: 'KJV', fellBack: true });
    });

    it('falls back to the first installed translation only when KJV is not installed either', () => {
        expect(resolveActiveTranslation('WEB', ['ASV', 'BSB'])).toEqual({ id: 'ASV', fellBack: true });
    });

    it('treats junk in the settings row as no preference', () => {
        expect(resolveActiveTranslation('', ['ASV', 'KJV'])).toEqual({ id: 'KJV', fellBack: false });
        expect(resolveActiveTranslation(42, ['ASV', 'KJV'])).toEqual({ id: 'KJV', fellBack: false });
        expect(resolveActiveTranslation(null, ['WEB'])).toEqual({ id: 'WEB', fellBack: false });
    });

    it('reports nothing to open on when nothing is installed', () => {
        expect(resolveActiveTranslation('KJV', [])).toEqual({ id: null, fellBack: false });
    });
});
