import { describe, expect, it } from 'vitest';

import {
  applyBps,
  cpmAmount,
  divRound,
  formatMicros,
  fromCents,
  microsToDecimalString,
  MICROS_PER_UNIT,
  multiplyByQuantity,
  parseAmount,
  splitToCents,
  sum,
  toCents,
} from '@/lib/money';

describe('money — parsing', () => {
  it('parses whole and fractional amounts exactly', () => {
    expect(parseAmount('10.25')).toBe(10_250_000n);
    expect(parseAmount('1')).toBe(1_000_000n);
    expect(parseAmount('0.25')).toBe(250_000n);
    expect(parseAmount('$1,234.56')).toBe(1_234_560_000n);
  });

  it('represents sub-cent amounts exactly — the reason micros exist', () => {
    // $0.0025 per click cannot be represented in cents without rounding.
    expect(parseAmount('0.0025')).toBe(2_500n);
    expect(parseAmount('0.005')).toBe(5_000n);
    expect(parseAmount('0.000001')).toBe(1n);
  });

  it('rejects malformed input rather than silently coercing', () => {
    expect(() => parseAmount('abc')).toThrow();
    expect(() => parseAmount('')).toThrow();
    expect(() => parseAmount('1.2.3')).toThrow();
    expect(() => parseAmount('0.0000001')).toThrow(/6 decimal places/);
  });

  it('avoids the floating-point error that motivates integer money', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754. It must be exact here.
    expect(parseAmount('0.1') + parseAmount('0.2')).toBe(parseAmount('0.3'));
    expect(parseAmount('1.005')).toBe(1_005_000n);
  });

  it('accumulates a million small amounts without drift', () => {
    const cent = parseAmount('0.01');
    let total = 0n;
    for (let i = 0; i < 1_000_000; i += 1) total += cent;
    expect(total).toBe(parseAmount('10000'));
  });
});

describe('money — arithmetic', () => {
  it('applies basis points with half-away-from-zero rounding', () => {
    expect(applyBps(1_000_000n, 2000)).toBe(200_000n);
    expect(applyBps(1_000_000n, 0)).toBe(0n);
    expect(applyBps(1_000_000n, 10_000)).toBe(1_000_000n);
    expect(applyBps(3n, 3333)).toBe(1n);
  });

  it('divRound rounds half away from zero, symmetrically', () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 2n)).toBe(2n);
    expect(divRound(1n, 3n)).toBe(0n);
    expect(() => divRound(1n, 0n)).toThrow();
  });

  it('computes CPM per thousand impressions', () => {
    expect(cpmAmount(parseAmount('5.00'), 1000)).toBe(parseAmount('5.00'));
    expect(cpmAmount(parseAmount('5.00'), 1)).toBe(5_000n);
    expect(cpmAmount(parseAmount('5.00'), 0)).toBe(0n);
  });

  it('multiplies by quantity and rejects fractional counts', () => {
    expect(multiplyByQuantity(250_000n, 4)).toBe(1_000_000n);
    expect(() => multiplyByQuantity(1n, 1.5)).toThrow();
    expect(() => multiplyByQuantity(1n, -1)).toThrow();
  });

  it('sums iterables', () => {
    expect(sum([1n, 2n, 3n])).toBe(6n);
    expect(sum([])).toBe(0n);
  });
});

describe('money — cent boundary', () => {
  it('splits into whole cents and a remainder so dust is never lost', () => {
    expect(splitToCents(1_234_567n)).toEqual({ cents: 123n, remainderMicros: 4_567n });
    expect(splitToCents(1_000_000n)).toEqual({ cents: 100n, remainderMicros: 0n });
    expect(splitToCents(2_500n)).toEqual({ cents: 0n, remainderMicros: 2_500n });
  });

  it('round-trips cents', () => {
    expect(toCents(fromCents(2599))).toBe(2599);
  });

  it('preserves value across the split', () => {
    const amount = 987_654_321n;
    const { cents, remainderMicros } = splitToCents(amount);
    expect(cents * 10_000n + remainderMicros).toBe(amount);
  });
});

describe('money — formatting', () => {
  it('shows two decimals for exact cent amounts', () => {
    expect(formatMicros(10_250_000n)).toBe('$10.25');
    expect(formatMicros(0n)).toBe('$0.00');
    expect(formatMicros(-1_500_000n)).toBe('-$1.50');
  });

  it('reveals sub-cent precision only when it exists', () => {
    expect(formatMicros(2_500n)).toBe('$0.0025');
    expect(formatMicros(250_000n)).toBe('$0.25');
  });

  it('groups thousands and honours currency', () => {
    expect(formatMicros(1_234_567_000_000n)).toBe('$1,234,567.00');
    expect(formatMicros(1_000_000n, { currency: 'EUR' })).toBe('€1.00');
  });

  it('formats plain decimals for CSV export', () => {
    expect(microsToDecimalString(10_250_000n)).toBe('10.25');
    expect(microsToDecimalString(2_500n)).toBe('0.0025');
    expect(microsToDecimalString(1_000_000n)).toBe('1.00');
  });

  it('rounds the display without corrupting the stored value', () => {
    expect(formatMicros(999_999n, { showSubCent: false })).toBe('$1.00');
    expect(MICROS_PER_UNIT).toBe(1_000_000n);
  });
});
