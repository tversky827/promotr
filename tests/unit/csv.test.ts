import { describe, expect, it } from 'vitest';

import { escapeCsvValue, toCsv } from '@/lib/csv';

describe('CSV generation', () => {
  it('quotes fields containing separators, quotes or newlines', () => {
    expect(escapeCsvValue('plain')).toBe('plain');
    expect(escapeCsvValue('has,comma')).toBe('"has,comma"');
    expect(escapeCsvValue('has"quote')).toBe('"has""quote"');
    expect(escapeCsvValue('has\nnewline')).toBe('"has\nnewline"');
  });

  it('neutralises spreadsheet formula injection', () => {
    // A publisher display name is attacker-controlled and ends up in brand exports.
    // The apostrophe prefix is what stops Excel evaluating the cell. No
    // quoting is added because the value contains no comma, quote or newline.
    expect(escapeCsvValue("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
    // When it does contain a separator, both protections apply.
    expect(escapeCsvValue('=HYPERLINK("http://evil","x"),y')).toBe(
      '"\'=HYPERLINK(""http://evil"",""x""),y"',
    );
    expect(escapeCsvValue('+1234')).toBe("'+1234");
    expect(escapeCsvValue('-1234')).toBe("'-1234");
    expect(escapeCsvValue('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('serialises bigints and dates without precision loss', () => {
    expect(escapeCsvValue(123456789012345678n)).toBe('123456789012345678');
    expect(escapeCsvValue(new Date('2026-01-15T10:30:00Z'))).toBe('2026-01-15T10:30:00.000Z');
  });

  it('renders empty cells for null and undefined', () => {
    expect(escapeCsvValue(null)).toBe('');
    expect(escapeCsvValue(undefined)).toBe('');
  });

  it('builds a complete document with CRLF line endings', () => {
    const csv = toCsv(['id', 'name'], [[1, 'Alice'], [2, 'Bob, Jr.']]);
    expect(csv).toBe('id,name\r\n1,Alice\r\n2,"Bob, Jr."');
  });
});
