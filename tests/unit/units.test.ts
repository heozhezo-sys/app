/**
 * Weight, RPE, distance and duration conversion.
 *
 * The load-bearing claim is that integer grams represent fractional plate weights
 * exactly, which is why these are integers rather than floats.
 */

import {
  formatDistance,
  formatDuration,
  formatDurationShort,
  formatSetDuration,
  formatWeight,
  gramsToKg,
  gramsToLb,
  kgToGrams,
  lbToGrams,
  parseDistanceToMetres,
  parseDurationToSeconds,
  parseWeightToGrams,
  rpeToScaled,
  scaledToRpe,
} from '@/utils/units';

describe('gram storage of fractional plate weights', () => {
  it('represents 2.5 lb exactly, with no float drift', () => {
    // parseFloat('2.5') * 453.59237 = 1133.9809..., which is not a plate.
    expect(lbToGrams(2.5)).toBe(1134);
  });

  it('represents a 1.25 kg plate exactly', () => {
    expect(kgToGrams(1.25)).toBe(1250);
  });

  it('represents 0.5 kg exactly', () => {
    expect(kgToGrams(0.5)).toBe(500);
  });

  it('round-trips kilogram values without loss', () => {
    for (const kg of [0.5, 1.25, 20, 60, 100, 180.5]) {
      expect(gramsToKg(kgToGrams(kg))).toBeCloseTo(kg, 10);
    }
  });

  it('round-trips pound values to the nearest gram', () => {
    for (const lb of [2.5, 5, 45, 135, 225]) {
      expect(Math.round(gramsToLb(lbToGrams(lb)))).toBe(Math.round(lb));
    }
  });
});

describe('parseWeightToGrams', () => {
  it('accepts whole and decimal input', () => {
    expect(parseWeightToGrams('100', 'kg')).toBe(100_000);
    expect(parseWeightToGrams('22.5', 'kg')).toBe(22_500);
    expect(parseWeightToGrams('2.5', 'lb')).toBe(1134);
  });

  it('accepts a comma as the decimal separator', () => {
    expect(parseWeightToGrams('22,5', 'kg')).toBe(22_500);
  });

  it('allows zero, because bodyweight work is a real zero', () => {
    expect(parseWeightToGrams('0', 'kg')).toBe(0);
  });

  it('rejects negative weights as a typo', () => {
    expect(parseWeightToGrams('-5', 'kg')).toBeNull();
  });

  it('rejects nonsense rather than guessing', () => {
    expect(parseWeightToGrams('', 'kg')).toBeNull();
    expect(parseWeightToGrams('abc', 'kg')).toBeNull();
    expect(parseWeightToGrams('1.2.3', 'kg')).toBeNull();
    expect(parseWeightToGrams('.', 'kg')).toBeNull();
  });
});

describe('formatWeight', () => {
  it('renders kilogram values without trailing zeros', () => {
    expect(formatWeight(100_000, 'kg')).toBe('100 kg');
    expect(formatWeight(22_500, 'kg')).toBe('22.5 kg');
  });

  it('renders pound values', () => {
    expect(formatWeight(lbToGrams(225), 'lb')).toBe('225 lb');
    expect(formatWeight(1134, 'lb')).toBe('2.5 lb');
  });

  it('distinguishes bodyweight from "no weight recorded"', () => {
    expect(formatWeight(0, 'kg')).toBe('0 kg');
    expect(formatWeight(null, 'kg')).toBe('');
  });
});

describe('RPE scaling', () => {
  it('scales 1-10 onto an integer scaled by ten', () => {
    expect(rpeToScaled(7)).toBe(70);
    expect(rpeToScaled(8.5)).toBe(85);
    expect(rpeToScaled(10)).toBe(100);
    expect(rpeToScaled(1)).toBe(10);
  });

  it('round-trips', () => {
    for (const rpe of [1, 5.5, 7, 8.5, 10]) {
      expect(scaledToRpe(rpeToScaled(rpe) ?? 0)).toBe(rpe);
    }
  });

  it('rejects values outside 1-10', () => {
    expect(rpeToScaled(0)).toBeNull();
    expect(rpeToScaled(11)).toBeNull();
    expect(rpeToScaled(Number.NaN)).toBeNull();
  });
});

describe('distance and duration', () => {
  it('stores distance in whole metres', () => {
    expect(parseDistanceToMetres('5', 'km')).toBe(5000);
    expect(parseDistanceToMetres('400', 'm')).toBe(400);
    expect(parseDistanceToMetres('5.5', 'km')).toBe(5500);
  });

  it('rejects a negative distance', () => {
    expect(parseDistanceToMetres('-1', 'km')).toBeNull();
  });

  it('stores durations in whole seconds', () => {
    expect(parseDurationToSeconds('45')).toBe(2700);
    expect(parseDurationToSeconds('0.5')).toBe(30);
    expect(parseDurationToSeconds('0')).toBeNull();
  });

  it('formats durations readably', () => {
    expect(formatDuration(45)).toBe('0:45');
    expect(formatDuration(2700)).toBe('45:00');
    expect(formatDuration(3903)).toBe('1:05:03');
    expect(formatDurationShort(2700)).toBe('45m');
    expect(formatDurationShort(3903)).toBe('1h 05m');
    expect(formatSetDuration(45)).toBe('45s');
    expect(formatSetDuration(150)).toBe('2:30');
  });

  it('formats distance', () => {
    expect(formatDistance(5000, 'km')).toBe('5 km');
    expect(formatDistance(5500, 'km')).toBe('5.5 km');
    expect(formatDistance(400, 'm')).toBe('400 m');
  });
});
