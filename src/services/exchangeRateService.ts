/**
 * Currency rates and converted totals.
 *
 * Every function here is offline by construction: it reads rates the user typed and does
 * arithmetic on integers. There is no transport, no cache and no staleness question,
 * because there is nothing that can go stale on its own — which is the only way a rate
 * stays honest without a server.
 *
 * Conversion failures are values, not exceptions, wherever a screen will show the user
 * something: a missing rate produces a "set a rate first" message, never a crash and
 * never a silently-zeroed total.
 */

import * as repository from '@/repositories/exchangeRateRepository';
import { ValidationError } from '@/services/errors';
import type { FieldErrors } from '@/utils/validation';
import {
  convertMinor,
  formatRate,
  invertRateMicro,
  normaliseCurrencyCode,
  parseRateToMicro,
  rateFor,
} from '@/finance/rates';
import { addMinor } from '@/utils/money';
import type { ExchangeRates } from '@/repositories/exchangeRateRepository';

/** One currency's contribution to a converted total. */
export interface ConvertedAmount {
  currency: string;
  /** The amount as stored, in minor units of `currency`. */
  minor: number;
  /** The same amount in the base currency, or null when no rate is set. */
  convertedMinor: number | null;
  /** The rate actually used, so the UI can show it rather than implying precision. */
  rateLabel: string | null;
}

export interface ConvertedTotal {
  base: string;
  /** Sum of the convertible amounts. Excludes anything with no rate. */
  minor: number;
  /** Currencies that could not be converted, so the total is never shown as complete. */
  missing: string[];
  amounts: ConvertedAmount[];
}

/** All stored rates, for the settings editor. */
export async function listRates(): Promise<ExchangeRates> {
  return repository.getExchangeRates();
}

/**
 * Stores one user-entered rate.
 *
 * Validated here rather than in the repository so the screen gets field-level messages:
 * an unusable code or an unparseable rate is a typo the user can fix, and silently
 * ignoring it would leave them wondering why their conversion vanished.
 */
export async function setRate(input: {
  from: string;
  to: string;
  rate: string;
}): Promise<ExchangeRates> {
  const fields: FieldErrors = {};
  const from = normaliseCurrencyCode(input.from);
  const to = normaliseCurrencyCode(input.to);

  if (!from) fields.from = 'Use a three-letter code such as USD.';
  if (!to) fields.to = 'Use a three-letter code such as EUR.';
  if (from && to && from === to) {
    fields.to = 'Choose two different currencies.';
  }

  const micro = parseRateToMicro(input.rate);
  if (micro === null) {
    fields.rate = 'Enter a rate such as 58.25.';
  } else if (micro < 1) {
    fields.rate = 'Enter a rate greater than zero.';
  }

  if (Object.keys(fields).length > 0 || !from || !to || micro === null) {
    throw new ValidationError(fields);
  }

  // The inverse is stored alongside the direct rate so either direction converts, and so
  // the editor always shows a consistent pair rather than silently ignoring a mismatch.
  const inverse = invertRateMicro(micro);
  const next: ExchangeRates = {
    ...(await repository.getExchangeRates()),
    [`${from}_${to}`]: micro,
  };
  if (inverse !== null) next[`${to}_${from}`] = inverse;

  return repository.setExchangeRates(next);
}

/** Forgets a pair. Both directions go together, for the same reason they were written. */
export async function clearRate(from: string, to: string): Promise<ExchangeRates> {
  const codes = [normaliseCurrencyCode(from), normaliseCurrencyCode(to)];
  if (!codes[0] || !codes[1]) {
    throw new ValidationError({ from: 'Use a three-letter code such as USD.' });
  }
  await repository.clearExchangeRate(codes[0], codes[1]);
  await repository.clearExchangeRate(codes[1], codes[0]);
  return repository.getExchangeRates();
}

/**
 * Converts one amount into `base`.
 *
 * Returns the amount untouched when it is already in the base currency, so a user with a
 * single currency never has to set a rate to see their own total.
 */
export async function convertToBase(
  minor: number,
  currency: string,
  base: string,
): Promise<ConvertedAmount> {
  const rates = await repository.getExchangeRates();
  return convertWith(rates, minor, currency, base);
}

/** Pure form of {@link convertToBase}, so a screen can convert a list in one read. */
export function convertWith(
  rates: Readonly<Record<string, number>>,
  minor: number,
  currency: string,
  base: string,
): ConvertedAmount {
  if (currency.toUpperCase() === base.toUpperCase()) {
    return { currency, minor, convertedMinor: minor, rateLabel: null };
  }

  const rate = rateFor(rates, currency, base);
  if (rate === null) {
    return { currency, minor, convertedMinor: null, rateLabel: null };
  }

  return {
    currency,
    minor,
    convertedMinor: convertMinor(minor, currency, base, rate),
    rateLabel: `1 ${currency} = ${formatRate(rate)} ${base}`,
  };
}

/**
 * Sums amounts across currencies into `base`.
 *
 * Anything with no rate is reported in `missing` rather than counted as zero, because a
 * total that silently omits an account is worse than no total: it looks complete.
 */
export async function convertedTotal(
  amounts: readonly { minor: number; currency: string }[],
  base: string,
): Promise<ConvertedTotal> {
  const rates = await repository.getExchangeRates();
  return totalWith(rates, amounts, base);
}

/** Pure form of {@link convertedTotal}. */
export function totalWith(
  rates: Readonly<Record<string, number>>,
  amounts: readonly { minor: number; currency: string }[],
  base: string,
): ConvertedTotal {
  const converted: ConvertedAmount[] = amounts.map((amount) =>
    convertWith(rates, amount.minor, amount.currency, base),
  );

  const convertible = converted.filter(
    (amount): amount is ConvertedAmount & { convertedMinor: number } =>
      amount.convertedMinor !== null,
  );

  return {
    base,
    minor: addMinor(...convertible.map((amount) => amount.convertedMinor)),
    missing: converted
      .filter((amount) => amount.convertedMinor === null)
      .map((amount) => amount.currency),
    amounts: converted,
  };
}

export {
  CURRENCY_PRESETS,
  RATE_SCALE,
  convertMinor,
  currencyName,
  formatRate,
  invertRateMicro,
  normaliseCurrencyCode,
  parseRateToMicro,
  rateFor,
  rateKey,
} from '@/finance/rates';
