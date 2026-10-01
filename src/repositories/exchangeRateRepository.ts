/**
 * Exchange rate persistence.
 *
 * Rates live in the same durable key/value store as Settings rather than in a table of
 * their own, for two reasons: the map is a single opaque blob that is only ever read and
 * written as a whole, and adding a rate must not require a migration for a value that
 * is entirely derived from user input.
 *
 * Stored as micro-units (see `src/finance/rates.ts`). A row that has been corrupted by a
 * partially-written write, or written by a future version with different rules, is
 * dropped back to empty rather than being trusted: a wrong rate silently produces wrong
 * numbers, and an absent one produces an honest "set a rate first".
 */

import { CHANNELS, getDatabase, notify } from '@/database/database';
import { rateKey } from '@/finance/rates';

const RATES_KEY = 'exchange_rates.v1';

export type ExchangeRates = Record<string, number>;

interface PreferenceRow {
  key: string;
  value: string;
}

/** Every stored rate, keyed `FROM_TO`. Empty when nothing has been set. */
export async function getExchangeRates(): Promise<ExchangeRates> {
  const db = await getDatabase();
  const row = await db.driver.first<PreferenceRow>(
    'SELECT key, value FROM preferences WHERE key = ?;',
    [RATES_KEY],
  );

  if (!row) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return {};
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

  // Only well-formed positive integer micro-rates survive. Anything else is discarded
  // individually rather than failing the whole map, so one bad key cannot erase the rest.
  const out: ExchangeRates = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (/^[A-Z]{3}_[A-Z]{3}$/.test(key) && Number.isSafeInteger(value) && (value as number) > 0) {
      out[key] = value as number;
    }
  }
  return out;
}

/** Replaces the whole map. Rates are few, and a partial merge would be ambiguous. */
export async function setExchangeRates(rates: ExchangeRates): Promise<ExchangeRates> {
  const db = await getDatabase();
  const clean: ExchangeRates = {};
  for (const [key, value] of Object.entries(rates)) {
    if (/^[A-Z]{3}_[A-Z]{3}$/.test(key) && Number.isSafeInteger(value) && value > 0) {
      clean[key] = value;
    }
  }

  await db.driver.run(
    `INSERT INTO preferences (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
    [RATES_KEY, JSON.stringify(clean), Date.now()],
  );

  notify(CHANNELS.finance);
  return clean;
}

/** Sets one pair's rate. */
export async function setExchangeRate(from: string, to: string, micro: number): Promise<void> {
  const current = await getExchangeRates();
  await setExchangeRates({ ...current, [rateKey(from, to)]: micro });
}

/** Forgets one pair. A missing rate is a normal state, not an error. */
export async function clearExchangeRate(from: string, to: string): Promise<void> {
  const current = await getExchangeRates();
  const next = { ...current };
  delete next[rateKey(from, to)];
  await setExchangeRates(next);
}
