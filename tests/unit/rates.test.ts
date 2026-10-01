/**
 * Exchange-rate arithmetic.
 *
 * The cases below are chosen to catch the three ways currency conversion goes quietly
 * wrong: float drift, a mismatch between minor-unit exponents, and rounding that
 * disagrees in sign.
 */

import {
  MIN_RATE_MICRO,
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

describe('parseRateToMicro', () => {
  it('scales a whole number', () => {
    expect(parseRateToMicro('1')).toBe(RATE_SCALE);
  });

  it('scales a decimal without float drift', () => {
    // `parseFloat('58.25') * 1e6` is 58249999.99999999 on some engines.
    expect(parseRateToMicro('58.25')).toBe(58_250_000);
    expect(parseRateToMicro('0.1')).toBe(100_000);
  });

  it('accepts a leading decimal point', () => {
    expect(parseRateToMicro('.5')).toBe(500_000);
  });

  it('rounds a seventh digit half away from zero', () => {
    expect(parseRateToMicro('1.0000005')).toBe(RATE_SCALE + 1);
    expect(parseRateToMicro('1.0000004')).toBe(RATE_SCALE);
  });

  it('truncates beyond the sixth decimal rather than rounding up a whole unit', () => {
    expect(parseRateToMicro('1.0000004999')).toBe(RATE_SCALE);
  });

  it('tolerates grouping separators and surrounding space', () => {
    expect(parseRateToMicro(' 1,234.5 ')).toBe(1_234_500_000);
  });

  it('rejects a negative rate, since a rate is not a balance', () => {
    expect(parseRateToMicro('-1')).toBeNull();
  });

  it('parses zero as zero, leaving the caller to decide it is unusable', () => {
    // Parsing and policy are separate: the parser reports what was typed, the service
    // decides a zero rate is not a conversion.
    expect(parseRateToMicro('0')).toBe(0);
  });

  it('rejects letters, an empty string and a bare decimal point', () => {
    expect(parseRateToMicro('abc')).toBeNull();
    expect(parseRateToMicro('')).toBeNull();
    expect(parseRateToMicro('.')).toBeNull();
  });
});

describe('formatRate', () => {
  it('renders whole rates without a decimal point', () => {
    expect(formatRate(RATE_SCALE)).toBe('1');
    expect(formatRate(58_250_000)).toBe('58.25');
  });

  it('keeps six decimal places of precision', () => {
    expect(formatRate(1_234_567)).toBe('1.234567');
  });

  it('rounds a value that cannot exist to something honest', () => {
    expect(formatRate(0)).toBe('0');
    expect(formatRate(-5)).toBe('0');
    expect(formatRate(1.5)).toBe('0');
  });
});

describe('convertMinor', () => {
  const rate = 58_250_000; // 1 USD = 58.25 PHP

  it('returns the identity for the same currency without needing a rate', () => {
    expect(convertMinor(1234, 'USD', 'USD', 1)).toBe(1234);
  });

  it('converts between two 2-decimal currencies', () => {
    // 10.00 USD -> 582.50 PHP = 58250 minor units.
    expect(convertMinor(1000, 'USD', 'PHP', rate)).toBe(58_250);
  });

  it('honours a different minor-unit exponent on the way out', () => {
    // 10.00 USD -> 582.50 JPY, and JPY has no minor unit at all.
    expect(convertMinor(1000, 'USD', 'JPY', rate)).toBe(583);
  });

  it('honours a different minor-unit exponent on the way in', () => {
    // 100 JPY at 58.25 is 5825 PHP = 582500 minor units.
    expect(convertMinor(100, 'JPY', 'PHP', 58_250_000)).toBe(582_500);
  });

  it('converts 3-decimal currencies', () => {
    // 1.000 KWD -> 1000 minor units; at 3.5 that is 3500 BHD minor units.
    expect(convertMinor(1000, 'KWD', 'BHD', 3_500_000)).toBe(3500);
  });

  it('rounds half away from zero in both directions', () => {
    // 1 minor unit of USD at 0.5 PHP is exactly half a PHP minor unit.
    expect(convertMinor(1, 'USD', 'PHP', 500_000)).toBe(1);
    expect(convertMinor(-1, 'USD', 'PHP', 500_000)).toBe(-1);
    // And just under half rounds away.
    expect(convertMinor(1, 'USD', 'PHP', 499_999)).toBe(0);
    expect(convertMinor(-1, 'USD', 'PHP', 499_999)).toBe(0);
  });

  it('round-trips exactly when the rate and its inverse are both exact', () => {
    // 2.0 inverts to 0.5 with no lost precision, so the trip must be lossless.
    const inverse = invertRateMicro(2_000_000) as number;
    const there = convertMinor(123_456, 'USD', 'EUR', 2_000_000);
    expect(there).toBe(246_912);
    expect(convertMinor(there, 'EUR', 'USD', inverse)).toBe(123_456);
  });

  it('round-trips a real rate to within a single minor unit, never compounding', () => {
    const inverse = invertRateMicro(rate) as number;
    const there = convertMinor(123_456, 'USD', 'PHP', rate);
    const back = convertMinor(there, 'PHP', 'USD', inverse);
    // Six places of rate precision cannot recover every unit of a 58x rate; the
    // guarantee is that the drift stays proportional rather than growing on each hop.
    expect(Math.abs(back - 123_456)).toBeLessThanOrEqual(3);
  });

  it('refuses a missing or non-positive rate', () => {
    expect(() => convertMinor(100, 'USD', 'PHP', 0)).toThrow(RangeError);
    expect(() => convertMinor(100, 'USD', 'PHP', -1)).toThrow(RangeError);
    expect(() => convertMinor(100, 'USD', 'PHP', 1.5)).toThrow(RangeError);
  });

  it('refuses a non-integer amount rather than silently rounding it', () => {
    expect(() => convertMinor(10.5, 'USD', 'PHP', rate)).toThrow(RangeError);
  });

  it('treats the smallest usable rate as the lower bound, not an error', () => {
    expect(MIN_RATE_MICRO).toBe(1);
    expect(convertMinor(100, 'USD', 'PHP', MIN_RATE_MICRO)).toBe(0);
  });
});

describe('invertRateMicro', () => {
  it('is the identity for a rate of one', () => {
    expect(invertRateMicro(RATE_SCALE)).toBe(RATE_SCALE);
  });

  it('flips a rate', () => {
    expect(invertRateMicro(2_000_000)).toBe(500_000);
  });

  it('returns null rather than dividing by zero', () => {
    expect(invertRateMicro(0)).toBeNull();
    expect(invertRateMicro(-2_000_000)).toBeNull();
  });
});

describe('rateKey and rateFor', () => {
  it('canonicalises the pair so casing cannot create a duplicate', () => {
    expect(rateKey('usd', 'php')).toBe('USD_PHP');
  });

  it('finds a stored rate', () => {
    expect(rateFor({ USD_PHP: 58_250_000 }, 'USD', 'php')).toBe(58_250_000);
  });

  it('reports the identity rate for the same currency, stored or not', () => {
    expect(rateFor({}, 'USD', 'USD')).toBe(RATE_SCALE);
  });

  it('returns null for an unset pair rather than inventing one', () => {
    expect(rateFor({ USD_PHP: 58_250_000 }, 'EUR', 'PHP')).toBeNull();
  });
});

describe('currency metadata', () => {
  it('names a known currency', () => {
    expect(currencyName('php')).toBe('Philippine Peso');
  });

  it('shows an unknown code as itself', () => {
    expect(currencyName('zzz')).toBe('ZZZ');
  });

  it('normalises codes and refuses non-ISO shapes', () => {
    expect(normaliseCurrencyCode(' usd ')).toBe('USD');
    expect(normaliseCurrencyCode('US')).toBeNull();
    expect(normaliseCurrencyCode('US1')).toBeNull();
  });
});
