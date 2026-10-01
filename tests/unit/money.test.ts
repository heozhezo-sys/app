/**
 * Money correctness.
 *
 * The specification forbids unsafe floating-point money. These tests are the
 * regression net for that rule.
 */

import {
  addMinor,
  formatMinor,
  isValidCurrencyCode,
  minorUnitExponent,
  parseAmountToMinor,
  percentageOfMinor,
  subtractMinor,
  sumMinor,
} from '@/utils/money';

describe('parseAmountToMinor', () => {
  it('parses plain decimals into exact minor units', () => {
    expect(parseAmountToMinor('12.34', 'USD')).toBe(1234);
    expect(parseAmountToMinor('0.01', 'USD')).toBe(1);
    expect(parseAmountToMinor('19.99', 'USD')).toBe(1999);
  });

  it('does NOT reproduce the classic float error', () => {
    // parseFloat('19.99') * 100 === 1998.9999999999998
    expect(parseAmountToMinor('19.99', 'USD')).toBe(1999);
    expect(parseAmountToMinor('1.15', 'USD')).toBe(115);
    expect(parseAmountToMinor('8.29', 'USD')).toBe(829);
  });

  it('handles the floating-point trap values explicitly', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point.
    const tenth = parseAmountToMinor('0.1', 'USD') ?? 0;
    const fifth = parseAmountToMinor('0.2', 'USD') ?? 0;
    expect(addMinor(tenth, fifth)).toBe(parseAmountToMinor('0.3', 'USD'));
  });

  it('accepts thousands separators and spaces', () => {
    expect(parseAmountToMinor('1,234.56', 'USD')).toBe(123456);
    expect(parseAmountToMinor(' 12.34 ', 'USD')).toBe(1234);
  });

  it('rounds extra precision half away from zero', () => {
    expect(parseAmountToMinor('1.005', 'USD')).toBe(101);
    expect(parseAmountToMinor('1.004', 'USD')).toBe(100);
    expect(parseAmountToMinor('0.999', 'USD')).toBe(100);
  });

  it('handles negatives', () => {
    expect(parseAmountToMinor('-12.34', 'USD')).toBe(-1234);
    expect(parseAmountToMinor('-0.01', 'USD')).toBe(-1);
  });

  it('supports zero-decimal currencies', () => {
    expect(minorUnitExponent('JPY')).toBe(0);
    expect(parseAmountToMinor('1500', 'JPY')).toBe(1500);
    // A fractional part is discarded, never rounded up into a whole extra unit.
    expect(parseAmountToMinor('1500.75', 'JPY')).toBe(1500);
  });

  it('supports three-decimal currencies', () => {
    expect(minorUnitExponent('KWD')).toBe(3);
    expect(parseAmountToMinor('1.234', 'KWD')).toBe(1234);
  });

  it('rejects nonsense rather than guessing', () => {
    expect(parseAmountToMinor('', 'USD')).toBeNull();
    expect(parseAmountToMinor('abc', 'USD')).toBeNull();
    expect(parseAmountToMinor('1.2.3', 'USD')).toBeNull();
    expect(parseAmountToMinor('--5', 'USD')).toBeNull();
    expect(parseAmountToMinor('5-', 'USD')).toBeNull();
    expect(parseAmountToMinor('1e5', 'USD')).toBeNull();
    expect(parseAmountToMinor('.', 'USD')).toBeNull();
  });

  it('accepts a bare decimal point form', () => {
    expect(parseAmountToMinor('.5', 'USD')).toBe(50);
  });
});

describe('integer arithmetic', () => {
  it('adds and subtracts exactly', () => {
    expect(addMinor(10, 20)).toBe(30);
    expect(subtractMinor(30, 10)).toBe(20);
    expect(sumMinor([1, 2, 3, 4])).toBe(10);
  });

  it('sums a realistic ledger without drift', () => {
    // 1000 entries of 0.10 = 10 000 cents = 100.00, with zero floating-point error.
    const amounts = Array.from({ length: 1000 }, () => parseAmountToMinor('0.10', 'USD') ?? 0);
    expect(sumMinor(amounts)).toBe(10000);
  });

  it('throws rather than silently losing precision on overflow', () => {
    expect(() => addMinor(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
  });

  it('applies percentages in integer arithmetic', () => {
    // `percentMilli` is percent x 1000, so 20% is 20000 and 50% is 50000.
    // 20% of 19.99 is 3.998 -> 400 cents
    expect(percentageOfMinor(1999, 20000)).toBe(400);
    expect(percentageOfMinor(1000, 50000)).toBe(500);
    // 5% of 10.00 is 0.50
    expect(percentageOfMinor(1000, 5000)).toBe(50);
  });
});

describe('formatMinor', () => {
  it('renders without losing the sign', () => {
    expect(formatMinor(1234, 'USD')).toContain('12.34');
    expect(formatMinor(-1234, 'USD')).toContain('-');
  });

  it('falls back to a plain number when Intl is unavailable', () => {
    const original = Intl.NumberFormat;
    // @ts-expect-error deliberately removing the API to exercise the fallback
    Intl.NumberFormat = undefined;
    try {
      expect(formatMinor(1234, 'USD')).toBe('12.34');
      expect(formatMinor(5, 'USD')).toBe('0.05');
      expect(formatMinor(-1234, 'USD')).toBe('-12.34');
    } finally {
      Intl.NumberFormat = original;
    }
  });

  it('honours the currency minor unit when falling back', () => {
    const original = Intl.NumberFormat;
    // @ts-expect-error deliberately removing the API to exercise the fallback
    Intl.NumberFormat = undefined;
    try {
      expect(formatMinor(1500, 'JPY')).toBe('1500');
      expect(formatMinor(1234, 'KWD')).toBe('1.234');
    } finally {
      Intl.NumberFormat = original;
    }
  });
});

describe('currency codes', () => {
  it('validates ISO-4217 shape', () => {
    expect(isValidCurrencyCode('USD')).toBe(true);
    expect(isValidCurrencyCode('EUR')).toBe(true);
    expect(isValidCurrencyCode('usd')).toBe(false);
    expect(isValidCurrencyCode('US')).toBe(false);
    expect(isValidCurrencyCode('US Dollar')).toBe(false);
  });
});
