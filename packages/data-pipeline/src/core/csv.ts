/**
 * Shared CSV parsing for pipeline importers.
 */

/**
 * RFC 4180-compliant CSV parser.
 * Handles quoted fields, escaped quotes (""), multiline quoted fields,
 * Windows/Unix line endings, and UTF-8 BOM.
 */
export function parseCsv(content: string): Array<Record<string, string>> {
    // Normalize line endings and strip BOM
    const raw = content
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/^﻿/, '');

    const allRows: string[][] = [];
    let currentRow: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];

        if (inQuotes) {
            if (ch === '"') {
                if (raw[i + 1] === '"') {
                    // Escaped quote
                    field += '"';
                    i++;
                } else {
                    // End of quoted field
                    inQuotes = false;
                }
            } else {
                field += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                currentRow.push(field.trim());
                field = '';
            } else if (ch === '\n') {
                currentRow.push(field.trim());
                if (currentRow.some(f => f !== '')) {
                    allRows.push(currentRow);
                }
                currentRow = [];
                field = '';
            } else {
                field += ch;
            }
        }
    }

    // Flush last field/row
    currentRow.push(field.trim());
    if (currentRow.some(f => f !== '')) {
        allRows.push(currentRow);
    }

    if (allRows.length === 0) return [];

    const headers = allRows[0].map(h => h.trim());

    return allRows.slice(1).map(row => {
        const obj: Record<string, string> = {};
        for (let j = 0; j < headers.length; j++) {
            obj[headers[j]] = row[j] ?? '';
        }
        return obj;
    });
}
