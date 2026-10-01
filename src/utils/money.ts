/**
 * Money.
 *
 * Rule from the specification: "Never use unsafe floating-point calculations for
 * money."
 *
 * Therefore every amount is an INTEGER number of minor units (cents, pence, fils)
 * plus an ISO-4217 currency code. `0.1 + 0.2 !== 0.3` in binary floating point; in
 * integers `10 + 20 === 30` always. No function in this file accepts or returns a
 * `number` that represents a decimal quantity of currency.
 *
 * Conversion from user input parses the decimal *string* digit by digit. It never
 * routes through `parseFloat`, because `parseFloat('19.99') * 100` is `1998.9999...`.
 */

/** Currencies whose minor unit is not 1/100. */
const MINOR_UNIT_EXPONENT: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  JOD: 3,
  TND: 3,
};

export function minorUnitExponent(currency: string): number {
  return MINOR_UNIT_EXPONENT[currency.toUpperCase()] ?? 2;
}

export function isValidCurrencyCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

/**
 * Parses a user-entered decimal amount into minor units.
 *
 * Accepts optional grouping separators and a leading sign; rejects anything else.
 * Extra precision beyond the currency's minor unit is rounded half-away-from-zero,
 * which is what a person typing a price expects.
 *
 * Returns `null` for invalid input so callers can show a validation message rather
 * than silently storing a wrong number.
 */
export function parseAmountToMinor(input: string, currency: string): number | null {
  const cleaned = input.trim().replace(/[\s,  ]/g, '');
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return null;

  const [, sign, wholeRaw, fractionRaw = ''] = match;
  if (!wholeRaw && !fractionRaw) return null;

  const whole = wholeRaw === '' ? '0' : wholeRaw;
  const exponent = minorUnitExponent(currency);

  let scaled: number;
  if (exponent === 0) {
    // Zero-decimal currency: any fractional part is discarded, not rounded up.
    scaled = Number(whole);
  } else {
    const padded = (fractionRaw + '0'.repeat(exponent)).slice(0, exponent);
    const kept = fractionRaw.length > exponent ? Number(fractionRaw[exponent] ?? '0') : 0;
    scaled = Number(whole) * 10 ** exponent + Number(padded);
    // Round the discarded digit half away from zero.
    if (kept >= 5) scaled += 1;
  }

  if (!Number.isSafeInteger(scaled)) return null;
  return sign === '-' ? -scaled : scaled;
}

/** Formats minor units for display using the device locale. */
export function formatMinor(
  minor: number,
  currency: string,
  options: { showSign?: boolean; hideSymbol?: boolean } = {},
): string {
  const exponent = minorUnitExponent(currency);
  const value = exponent === 0 ? minor : minor / 10 ** exponent;

  try {
    return new Intl.NumberFormat(undefined, {
      style: options.hideSymbol ? 'decimal' : 'currency',
      ...(options.hideSymbol ? {} : { currency }),
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
      signDisplay: options.showSign ? 'exceptZero' : 'auto',
    }).format(value);
  } catch {
    const sign = minor < 0 ? '-' : options.showSign && minor > 0 ? '+' : '';
    const abs = Math.abs(minor);
    if (exponent === 0) return `${sign}${abs}`;
    return `${sign}${Math.floor(abs / 10 ** exponent)}.${String(abs % 10 ** exponent).padStart(exponent, '0')}`;
  }
}

/** Exact integer addition. Throws on overflow rather than returning a wrong number. */
export function addMinor(...values: number[]): number {
  return checked(values.reduce((a, b) => a + b, 0));
}

export function subtractMinor(a: number, b: number): number {
  return checked(a - b);
}

export function sumMinor(values: readonly number[]): number {
  return addMinor(...values);
}

function checked(value: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Money arithmetic overflowed: ${value}`);
  }
  return value;
}

/** Applies a percentage (e.g. a tax rate) to an integer amount, rounding half away from zero. */
export function percentageOfMinor(amountMinor: number, percentMilli: number): number {
  // percentMilli is percent x 1000 so callers never pass a float.
  const scaled = (amountMinor * percentMilli) / 100_000;
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return checked(rounded);
}

/** Suggests a month key from a timestamp, e.g. `2026-01`. */
export function periodKeyFor(timestamp: number): { month: string; year: string } {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return {
    month: `${date.getFullYear()}-${month}`,
    year: String(date.getFullYear()),
  };
}
