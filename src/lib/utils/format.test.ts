import { describe, expect, it } from 'vitest';
import { formatBytes, formatDate, shareOf } from './format';

describe('formatBytes', () => {
    it('picks the unit', () => {
        expect(formatBytes(512)).toBe('1 KB');
        expect(formatBytes(3.1 * 1024 ** 2)).toBe('3.1 MB');
        expect(formatBytes(10.1 * 1024 ** 3)).toBe('10.1 GB');
    });
    it('never prints garbage', () => {
        expect(formatBytes(NaN)).toBe('0 KB');
        expect(formatBytes(-5)).toBe('0 KB');
    });
});

describe('shareOf', () => {
    it('clamps and handles an empty total', () => {
        expect(shareOf(5, 10)).toBe(0.5);
        expect(shareOf(20, 10)).toBe(1);
        expect(shareOf(5, 0)).toBe(0);
    });
});

describe('formatDate', () => {
    it('says never for nothing', () => {
        expect(formatDate(null)).toBe('never');
        expect(formatDate(undefined)).toBe('never');
    });
});
