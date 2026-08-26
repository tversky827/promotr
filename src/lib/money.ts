/**
 * Exact money arithmetic.
 *
 * The internal unit is the MICRO: one millionth of a currency unit.
 *   $1.00      = 1_000_000 micros
 *   $0.25      =   250_000 micros
 *   $0.0025    =     2_500 micros   (a quarter-cent CPC — representable exactly)
 *
 * Why micros rather than cents: performance advertising routinely prices below
 * a cent (CPM of $5.00 is $0.005 per impression). Cents would force rounding on
 * every single event, and those roundings compound across millions of events.
 * Micros give four extra decimal places of headroom while staying integral.
 *
 * Every value is a bigint. There is no float anywhere in this module, and no
 * float may be used for money anywhere in the codebase.
 *
 * External boundaries (Stripe) work in cents. Crossing that boundary is the
 * only place rounding happens, and it is always explicit: see `splitToCents`.
 */

export const MICROS_PER_UNIT = 1_000_000n;
export const MICROS_PER_CENT = 10_000n;
export const BPS_DENOMINATOR = 10_000n;

export type Micros = bigint;

/** Parse a user-supplied decimal string ("12.34", "0.0025") into micros. */
export function parseAmount(input: string): Micros {
  const trimmed = input.trim().replace(/[$,\s]/g, '');
  if (trimmed === '') throw new MoneyError('Amount is required');
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!match) throw new MoneyError(`"${input}" is not a valid amount`);

  const [, sign, wholePart = '', fracPart = ''] = match;
  if (wholePart === '' && fracPart === '') {
    throw new MoneyError(`"${input}" is not a valid amount`);
  }
  if (fracPart.length > 6) {
    throw new MoneyError('Amounts support at most 6 decimal places');
  }

  const whole = BigInt(wholePart === '' ? '0' : wholePart);
  const frac = BigInt(fracPart.padEnd(6, '0') || '0');
  const total = whole * MICROS_PER_UNIT + frac;
  return sign === '-' ? -total : total;
}

/** Parse, returning null instead of throwing. */
export function tryParseAmount(input: string): Micros | null {
  try {
    return parseAmount(input);
  } catch {
    return null;
  }
}

export function fromUnits(units: number | bigint): Micros {
  if (typeof units === 'bigint') return units * MICROS_PER_UNIT;
  if (!Number.isInteger(units)) {
    // Route non-integers through the string parser so no float rounding leaks in.
    return parseAmount(units.toFixed(6));
  }
  return BigInt(units) * MICROS_PER_UNIT;
}

export function fromCents(cents: number | bigint): Micros {
  return BigInt(cents) * MICROS_PER_CENT;
}

/**
 * Convert micros to whole cents, floor-rounded, returning the remainder so the
 * caller must consciously decide what happens to sub-cent dust. Used at the
 * Stripe boundary; the remainder is either retained in the publisher's balance
 * or posted to the ROUNDING ledger account.
 */
export function splitToCents(micros: Micros): { cents: bigint; remainderMicros: Micros } {
  if (micros < 0n) {
    const { cents, remainderMicros } = splitToCents(-micros);
    return { cents: -cents, remainderMicros: -remainderMicros };
  }
  const cents = micros / MICROS_PER_CENT;
  return { cents, remainderMicros: micros - cents * MICROS_PER_CENT };
}

/** Whole cents, floor-rounded. Prefer `splitToCents` when the dust matters. */
export function toCents(micros: Micros): number {
  return Number(splitToCents(micros).cents);
}

/**
 * Apply a basis-point rate with banker-free, deterministic rounding.
 * Rounds half away from zero so a 50/50 split never silently favours the house.
 */
export function applyBps(micros: Micros, bps: number): Micros {
  const b = BigInt(Math.trunc(bps));
  const product = micros * b;
  return divRound(product, BPS_DENOMINATOR);
}

/** Integer division rounding half away from zero. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new MoneyError('Division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

export function multiplyByQuantity(micros: Micros, quantity: number): Micros {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new MoneyError(`Quantity must be a non-negative integer (got ${quantity})`);
  }
  return micros * BigInt(quantity);
}

/** CPM: payout is per 1,000 events. */
export function cpmAmount(cpmMicros: Micros, impressions: number): Micros {
  if (!Number.isInteger(impressions) || impressions < 0) {
    throw new MoneyError('Impressions must be a non-negative integer');
  }
  return divRound(cpmMicros * BigInt(impressions), 1000n);
}

export function sum(values: Iterable<Micros>): Micros {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

export function max(a: Micros, b: Micros): Micros {
  return a > b ? a : b;
}

export function min(a: Micros, b: Micros): Micros {
  return a < b ? a : b;
}

export function clampNonNegative(v: Micros): Micros {
  return v < 0n ? 0n : v;
}

export function isZero(v: Micros): boolean {
  return v === 0n;
}

/**
 * Format micros for display. Shows extra precision only when the amount
 * genuinely has sub-cent detail, so "$0.25" does not render as "$0.2500".
 */
export function formatMicros(
  micros: Micros,
  options: { currency?: string; locale?: string; showSubCent?: boolean } = {},
): string {
  const { currency = 'USD', locale = 'en-US' } = options;
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;

  const hasSubCent = abs % MICROS_PER_CENT !== 0n;
  const showSubCent = options.showSubCent ?? hasSubCent;
  const decimals = showSubCent ? 4 : 2;

  const whole = abs / MICROS_PER_UNIT;
  const fracMicros = abs % MICROS_PER_UNIT;
  // Take the leading `decimals` digits of the 6-digit fraction, rounding the tail.
  const divisor = 10n ** BigInt(6 - decimals);
  let frac = divRound(fracMicros, divisor);
  let wholeAdjusted = whole;
  const fracLimit = 10n ** BigInt(decimals);
  if (frac >= fracLimit) {
    frac -= fracLimit;
    wholeAdjusted += 1n;
  }

  const wholeStr = new Intl.NumberFormat(locale).format(wholeAdjusted);
  const fracStr = frac.toString().padStart(decimals, '0');
  const symbol = currencySymbol(currency);
  return `${negative ? '-' : ''}${symbol}${wholeStr}.${fracStr}`;
}

/** Plain decimal string with no currency symbol — used for CSV exports. */
export function microsToDecimalString(micros: Micros, decimals = 6): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / MICROS_PER_UNIT;
  const frac = abs % MICROS_PER_UNIT;
  const fracStr = frac.toString().padStart(6, '0').slice(0, decimals).replace(/0+$/, '');
  const body = fracStr ? `${whole}.${fracStr}` : `${whole}.00`;
  return negative ? `-${body}` : body;
}

function currencySymbol(currency: string): string {
  switch (currency.toUpperCase()) {
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    case 'CAD':
      return 'CA$';
    case 'AUD':
      return 'A$';
    default:
      return `${currency.toUpperCase()} `;
  }
}

export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Serialise bigint money for transport to client components. */
export function serializeMicros(v: Micros): string {
  return v.toString();
}

export function deserializeMicros(v: string | number | bigint): Micros {
  return BigInt(v);
}
