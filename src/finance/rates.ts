/**
 * Exchange rates and multi-currency conversion.
 *
 * `FEATURES/FINANCE.md` requires PHP, USD, EUR and custom currencies, and requires that
 * finance records stay local. Those two together rule out fetching live rates: an
 * app that cannot work offline cannot depend on a rate service, and a *stale* rate is
 * worse than an explicitly entered one because the user cannot see how old it is.
 *
 * So a rate is a number **the user types**, stored against a pair, with no transport
 * anywhere in this file. The UI shows the rate it is using, so a conversion is always
 * explainable.
 *
 * Integer discipline: a rate is stored as an integer number of *micro-units* — 1.0 is
 * `RATE_SCALE` — and conversion is integer arithmetic with a single rounding step at the
 * end. No float ever touches an amount, and `0.1 + 0.2` never becomes someone's balance.
 */

import { minorUnitExponent } from '@/utils/money';

/** Rates are held as micro-units: `1.234567` is stored as `1234567`. */
export const RATE_SCALE = 1_000_000;

/** Below this a typed rate is a typo rather than a conversion. */
export const MIN_RATE_MICRO = 1;

/** Currencies offered without typing a code. Any other ISO-4217 code is accepted. */
export const CURRENCY_PRESETS: readonly { code: string; name: string }[] = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'PHP', name: 'Philippine Peso' },
  { code: 'GBP', name: 'Pound Sterling' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'AED', name: 'UAE Dirham' },
];

/**
 * Names for currencies likely to appear, so a list of accounts reads as "Euro" rather
 * than "EUR". Unknown codes are shown as themselves, which is what an ISO code is for.
 */
const CURRENCY_NAMES: Record<string, string> = Object.fromEntries(
  CURRENCY_PRESETS.map((preset) => [preset.code, preset.name]),
);

export function currencyName(code: string): string {
  return CURRENCY_NAMES[code.toUpperCase()] ?? code.toUpperCase();
}

/** Canonical form of a rate key: `usd_php`. Lower case so it cannot be duplicated. */
export function rateKey(from: string, to: string): string {
  return `${from.toUpperCase()}_${to.toUpperCase()}`;
}

/** Normalises a code to upper case, returning null when it is not an ISO-4217 shape. */
export function normaliseCurrencyCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/**
 * Parses a user-typed rate such as `58.25` into micro-units.
 *
 * Digit-by-digit, like `parseAmountToMinor`, and never through `parseFloat`:
 * `parseFloat('58.25') * 1e6` is not reliably `58250000`.
 *
 * Returns `null` for anything unparseable so the caller can show a message instead of
 * silently storing a wrong rate.
 */
export function parseRateToMicro(input: string): number | null {
  const cleaned = input.trim().replace(/[\s,]/g, '');
  const match = /^(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return null;

  const [, wholeRaw, fractionRaw = ''] = match;
  if (!wholeRaw && !fractionRaw) return null;

  const whole = wholeRaw === '' ? '0' : wholeRaw;
  const digits = 6;

  const padded = (fractionRaw + '0'.repeat(digits)).slice(0, digits);
  const kept = fractionRaw.length > digits ? Number(fractionRaw[digits] ?? '0') : 0;
  let scaled = Number(whole) * RATE_SCALE + Number(padded);
  if (kept >= 5) scaled += 1;

  return Number.isSafeInteger(scaled) ? scaled : null;
}

/** Micro-units back to a plain decimal string, for display and for round-tripping. */
export function formatRate(micro: number): string {
  if (!Number.isSafeInteger(micro) || micro <= 0) return '0';
  const whole = Math.floor(micro / RATE_SCALE);
  const fraction = String(micro % RATE_SCALE).padStart(6, '0').replace(/0+$/, '');
  return fraction === '' ? String(whole) : `${whole}.${fraction}`;
}

/**
 * Converts an integer minor-unit amount between currencies.
 *
 * The arithmetic is deliberately three auditable steps:
 *
 *   `major    = minor / 10^fromExponent`
 *   `target   = major * rate * 10^toExponent`
 *   `rate     = rateMicro / RATE_SCALE`
 *
 * which as integers is
 * `minor * rateMicro * 10^toExponent / (10^fromExponent * RATE_SCALE)`, rounded half away
 * from zero exactly once at the end. Handling the two exponents separately is what makes
 * USD (2 decimals) to JPY (0 decimals) correct instead of off by a factor of 100, and
 * dividing by `RATE_SCALE` is what makes a micro-scaled rate a rate rather than a
 * million times one.
 *
 * Converting to the same currency is the identity, so a missing rate is never consulted
 * for a no-op and a user with one account is never blocked.
 */
export function convertMinor(
  minor: number,
  from: string,
  to: string,
  rateMicro: number,
): number {
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError(`Amount is not an integer number of minor units: ${minor}`);
  }

  const fromCode = from.toUpperCase();
  const toCode = to.toUpperCase();
  if (fromCode === toCode) return minor;

  if (!Number.isSafeInteger(rateMicro) || rateMicro < MIN_RATE_MICRO) {
    throw new RangeError(`Exchange rate is missing or not positive: ${rateMicro}`);
  }

  // Cancel the shared power of ten *before* multiplying, so a large amount at a large
  // rate cannot overflow a double and then be divided back into a plausible-looking
  // wrong number. `numerator` therefore stays as `minor * rateMicro`.
  let denominator = RATE_SCALE * 10 ** minorUnitExponent(fromCode);
  let scaleUp = 10 ** minorUnitExponent(toCode);
  while (scaleUp > 1 && denominator % 10 === 0) {
    denominator /= 10;
    scaleUp /= 10;
  }

  const numerator = minor * rateMicro * scaleUp;
  if (!Number.isSafeInteger(numerator)) {
    throw new RangeError(`Conversion overflowed: ${minor} ${fromCode} to ${toCode}`);
  }

  // `Math.round` breaks on exactly .5 for negatives (it rounds toward +Infinity), which
  // would make -50 cents convert the "wrong" way compared with +50. Round away from zero.
  const scaled = numerator / denominator;
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);

  if (!Number.isSafeInteger(rounded)) {
    throw new RangeError(`Conversion overflowed: ${minor} ${fromCode} to ${toCode}`);
  }
  // Rounding a negative fraction toward zero yields `-0`, which formats as "-0" and
  // compares unequal to `0` under `Object.is`. A zero amount must be exactly zero.
  return rounded === 0 ? 0 : rounded;
}

/**
 * Inverts a rate.
 *
 * Needed when the user entered `PHP → USD` but the base is USD, and rounding the inverse
 * to six places would otherwise drift on every round trip. Returns `null` for a
 * non-positive rate rather than dividing by zero.
 */
export function invertRateMicro(rateMicro: number): number | null {
  if (!Number.isSafeInteger(rateMicro) || rateMicro < MIN_RATE_MICRO) return null;
  return Math.round(RATE_SCALE ** 2 / rateMicro);
}

/** The stored rate for a pair, or the identity rate when the pair is the same currency. */
export function rateFor(
  rates: Readonly<Record<string, number>>,
  from: string,
  to: string,
): number | null {
  if (from.toUpperCase() === to.toUpperCase()) return RATE_SCALE;
  return rates[rateKey(from, to)] ?? null;
}
