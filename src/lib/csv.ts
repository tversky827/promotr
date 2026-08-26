/**
 * CSV generation.
 *
 * Two things this does that a naive join would not:
 *
 *  1. Escapes properly — fields containing a comma, quote or newline are
 *     quoted and internal quotes doubled, per RFC 4180.
 *  2. Neutralises formula injection. A cell beginning with =, +, -, @, tab or
 *     CR is prefixed with an apostrophe. Without this, a publisher could set
 *     their display name to `=cmd|'/c calc'!A1` and have it execute when a
 *     brand opens the export in Excel.
 */

const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;

export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text: string;
  if (typeof value === 'bigint') text = value.toString();
  else if (value instanceof Date) text = value.toISOString();
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);

  if (FORMULA_TRIGGERS.test(text)) text = `'${text}`;

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsvRow(values: unknown[]): string {
  return values.map(escapeCsvValue).join(',');
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [toCsvRow(headers), ...rows.map(toCsvRow)].join('\r\n');
}

/**
 * Stream a CSV so a large export never materialises in memory. The generator
 * yields chunks; the caller pipes them into a Response or an upload.
 */
export async function* streamCsv(
  headers: string[],
  batches: AsyncIterable<unknown[][]>,
): AsyncGenerator<string> {
  yield `${toCsvRow(headers)}\r\n`;
  for await (const batch of batches) {
    if (batch.length === 0) continue;
    yield `${batch.map(toCsvRow).join('\r\n')}\r\n`;
  }
}

export function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      'Cache-Control': 'no-store',
    },
  });
}
