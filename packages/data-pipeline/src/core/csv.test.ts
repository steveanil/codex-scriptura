import { describe, it, expect } from 'vitest';
import { parseCsv } from './csv.js';

describe('parseCsv', () => {
    it('parses simple rows into header-keyed records', () => {
        expect(parseCsv('a,b,c\n1,2,3\n4,5,6')).toEqual([
            { a: '1', b: '2', c: '3' },
            { a: '4', b: '5', c: '6' },
        ]);
    });

    it('protects commas inside quoted fields and unescapes doubled quotes', () => {
        const rows = parseCsv('id,meaning\nx1,"strength, ""my strength"""');
        expect(rows).toEqual([{ id: 'x1', meaning: 'strength, "my strength"' }]);
    });

    it('keeps newlines inside quoted fields within one row', () => {
        const rows = parseCsv('id,notes\nx1,"line one\nline two"\nx2,plain');
        expect(rows).toHaveLength(2);
        expect(rows[0].notes).toBe('line one\nline two');
        expect(rows[1].id).toBe('x2');
    });

    it('normalizes CRLF line endings and strips a UTF-8 BOM', () => {
        expect(parseCsv('\uFEFFa,b\r\n1,2\r\n')).toEqual([{ a: '1', b: '2' }]);
    });

    it('fills missing trailing fields with empty strings', () => {
        expect(parseCsv('a,b,c\n1,2')).toEqual([{ a: '1', b: '2', c: '' }]);
    });

    it('treats a stray quote mid-unquoted-field as literal text (known-issues #21)', () => {
        // The old parser entered quote mode on any '"' and swallowed the
        // comma, the newline, and the entire following row into one field.
        const rows = parseCsv('id,meaning,type\nx1,5" of rain,wet\nx2,dry,arid');
        expect(rows).toEqual([
            { id: 'x1', meaning: '5" of rain', type: 'wet' },
            { id: 'x2', meaning: 'dry', type: 'arid' },
        ]);
    });

    it('does not let one unbalanced interior quote truncate the following rows (known-issues #21)', () => {
        const rows = parseCsv([
            'person_id,english_label,hebrew_label_meaning',
            'A_1,Alpha,meaning of "alpha uncertain',
            'B_1,Beta,second',
            'C_1,Gamma,third',
        ].join('\n'));
        expect(rows).toHaveLength(3);
        expect(rows[0].hebrew_label_meaning).toBe('meaning of "alpha uncertain');
        expect(rows[2]).toEqual({ person_id: 'C_1', english_label: 'Gamma', hebrew_label_meaning: 'third' });
    });

    it('still opens quote mode when the quote is the first character of the field', () => {
        expect(parseCsv('a,b\n"x, y",z')).toEqual([{ a: 'x, y', b: 'z' }]);
    });
});
