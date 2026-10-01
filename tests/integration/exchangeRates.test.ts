/**
 * Exchange-rate storage and converted totals.
 *
 * Rates are user input, so the interesting failures are the ones where bad input would
 * otherwise become a wrong number: a corrupt stored blob, a rate missing in one direction
 * only, and an amount that cannot be converted at all. All of them must be values the UI
 * can explain, never an exception and never a silently-zeroed total.
 */

import { NodeSqliteDriver } from '../support/nodeSqliteDriver';
import { runMigrations } from '@/database/migrator';
import {
  __setDatabaseHandleForTests,
  __resetDatabaseHandleForTests,
} from '@/database/database';
import * as service from '@/services/exchangeRateService';
import { isValidationError } from '@/services/errors';
import { RATE_SCALE } from '@/finance/rates';

let driver: NodeSqliteDriver;

beforeEach(async () => {
  driver = new NodeSqliteDriver();
  await runMigrations(driver);
  __setDatabaseHandleForTests(driver, 15);
});

afterEach(async () => {
  __resetDatabaseHandleForTests();
  await driver.close();
});

async function writeRawRates(value: string): Promise<void> {
  await driver.run(
    `INSERT INTO preferences (key, value, updated_at) VALUES ('exchange_rates.v1', ?, 1000)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    [value],
  );
}

describe('stored rates', () => {
  it('starts empty', async () => {
    await expect(service.listRates()).resolves.toEqual({});
  });

  it('stores a rate and reads it back', async () => {
    await service.setRate({ from: 'USD', to: 'PHP', rate: '58.25' });
    await expect(service.listRates()).resolves.toEqual({
      USD_PHP: 58_250_000,
      PHP_USD: 17_167,
    });
  });

  it('stores the inverse alongside the direct rate', async () => {
    await service.setRate({ from: 'EUR', to: 'GBP', rate: '0.85' });
    const rates = await service.listRates();
    expect(rates.EUR_GBP).toBe(850_000);
    // 1 / 0.85 = 1.176470..., kept to six places.
    expect(rates.GBP_EUR).toBe(1_176_471);
  });

  it('overwrites an existing pair rather than accumulating stale entries', async () => {
    await service.setRate({ from: 'USD', to: 'PHP', rate: '58.25' });
    await service.setRate({ from: 'USD', to: 'PHP', rate: '60' });
    const rates = await service.listRates();
    expect(rates.USD_PHP).toBe(60_000_000);
    expect(Object.keys(rates)).toHaveLength(2);
  });

  it('clears both directions together', async () => {
    await service.setRate({ from: 'USD', to: 'PHP', rate: '58.25' });
    await service.clearRate('USD', 'PHP');
    await expect(service.listRates()).resolves.toEqual({});
  });

  it('rejects a rate of zero, which is not a conversion', async () => {
    const attempt = service.setRate({ from: 'USD', to: 'PHP', rate: '0' });
    await expect(attempt).rejects.toBeInstanceOf(Error);
    await attempt.catch((error: unknown) => {
      if (!isValidationError(error)) throw new Error('expected a ValidationError');
      expect(error.fields.rate).toBe('Enter a rate greater than zero.');
    });
  });

  it('rejects unparseable input with a field-level message', async () => {
    const attempt = service.setRate({ from: 'US', to: 'PHP', rate: 'abc' });
    await expect(attempt).rejects.toBeInstanceOf(Error);
    await attempt.catch((error: unknown) => {
      expect(isValidationError(error)).toBe(true);
      if (!isValidationError(error)) return;
      expect(error.fields.from).toBeDefined();
      expect(error.fields.rate).toBeDefined();
    });
  });

  it('refuses a pair with the same currency on both sides', async () => {
    await expect(
      service.setRate({ from: 'USD', to: 'usd', rate: '1' }),
    ).rejects.toBeInstanceOf(Error);
  });

  it('survives a corrupt stored blob', async () => {
    await writeRawRates('{not json');
    await expect(service.listRates()).resolves.toEqual({});
  });

  it('survives a stored blob of the wrong shape', async () => {
    await writeRawRates('["USD_PHP"]');
    await expect(service.listRates()).resolves.toEqual({});
  });

  it('drops individual malformed entries rather than the whole map', async () => {
    await writeRawRates(
      JSON.stringify({
        USD_PHP: 58_250_000,
        EUR_PHP: 'fifty',
        'BAD:KEY': 1,
        JPY_PHP: -5,
        usd_php: 1,
        GBP_PHP: 1.5,
      }),
    );
    await expect(service.listRates()).resolves.toEqual({ USD_PHP: 58_250_000 });
  });
});

describe('converting a single amount', () => {
  it('returns the amount untouched when it is already in the base currency', async () => {
    await expect(service.convertToBase(12_345, 'USD', 'USD')).resolves.toEqual({
      currency: 'USD',
      minor: 12_345,
      convertedMinor: 12_345,
      rateLabel: null,
    });
  });

  it('converts using a stored rate and reports the rate used', async () => {
    await service.setRate({ from: 'USD', to: 'PHP', rate: '58.25' });
    const result = await service.convertToBase(1_000, 'USD', 'PHP');
    expect(result.convertedMinor).toBe(58_250);
    expect(result.rateLabel).toBe('1 USD = 58.25 PHP');
  });

  it('reports a missing rate rather than returning zero', async () => {
    const result = await service.convertToBase(1_000, 'EUR', 'PHP');
    expect(result.convertedMinor).toBeNull();
    expect(result.rateLabel).toBeNull();
  });
});

describe('converted totals', () => {
  it('sums only the amounts it can convert and names the rest', async () => {
    await service.setRate({ from: 'USD', to: 'EUR', rate: '0.9' });
    const total = await service.convertedTotal(
      [
        { minor: 1_000, currency: 'EUR' },
        { minor: 2_000, currency: 'USD' },
        { minor: 5_000, currency: 'PHP' },
      ],
      'EUR',
    );

    expect(total.base).toBe('EUR');
    // 1000 EUR plus 20.00 USD at 0.9 = 1800 EUR minor units. PHP is excluded, not zeroed.
    expect(total.minor).toBe(2_800);
    expect(total.missing).toEqual(['PHP']);
    expect(total.amounts).toHaveLength(3);
  });

  it('is exact with no rates at all when every currency matches the base', async () => {
    const total = await service.convertedTotal(
      [
        { minor: 1_000, currency: 'USD' },
        { minor: 2_000, currency: 'USD' },
      ],
      'USD',
    );
    expect(total.minor).toBe(3_000);
    expect(total.missing).toEqual([]);
  });

  it('handles negative balances, as an overdrawn account has', async () => {
    const total = await service.totalWith(
      { USD_EUR: 900_000 },
      [
        { minor: 5_000, currency: 'EUR' },
        { minor: -2_000, currency: 'USD' },
      ],
      'EUR',
    );
    expect(total.minor).toBe(3_200);
  });

  it('returns a zero total for no accounts rather than null', async () => {
    const total = await service.convertedTotal([], 'USD');
    expect(total.minor).toBe(0);
    expect(total.missing).toEqual([]);
  });

  it('refuses to sum past the safe integer range rather than returning a wrong total', () => {
    // One unit beyond `MAX_SAFE_INTEGER` is the smallest amount a double cannot hold
    // exactly. Throwing is the honest outcome; a rounded total would look plausible.
    expect(() =>
      service.totalWith(
        {},
        [
          { minor: Number.MAX_SAFE_INTEGER, currency: 'USD' },
          { minor: 1, currency: 'USD' },
        ],
        'USD',
      ),
    ).toThrow(RangeError);
  });
});

describe('the identity rate', () => {
  it('converts a currency to itself with the neutral rate', async () => {
    await service.setRate({ from: 'USD', to: 'EUR', rate: '1' });
    const total = await service.totalWith(
      { USD_EUR: RATE_SCALE },
      [{ minor: 4_242, currency: 'USD' }],
      'EUR',
    );
    expect(total.minor).toBe(4_242);
  });
});
