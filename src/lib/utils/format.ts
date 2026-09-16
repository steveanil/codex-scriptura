export function formatBytes(n: number): string {
    if (!Number.isFinite(n) || n < 0) return '0 KB';
    if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
    if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.round(n / 1024)} KB`;
}

/** Fraction of `part` in `total`, clamped 0..1; 0 for an empty total. */
export function shareOf(part: number, total: number): number {
    if (!(total > 0)) return 0;
    return Math.max(0, Math.min(1, part / total));
}

export function formatDate(ts: number | null | undefined): string {
    if (!ts) return 'never';
    return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
