/**
 * Health domain logic: volume units, sleep windows and nutrition scaling.
 *
 * These carry the decisions that are easy to get subtly wrong and hard to notice — a
 * fluid-ounce conversion that drifts, a night that crosses midnight, a serving that
 * accumulates a rounding error — so they are tested as pure functions with no database.
 */

import {
  DEFAULT_DAILY_TARGET_ML,
  MAX_ENTRY_ML,
  ML_PER_FLUID_OUNCE,
  QUICK_ADD_ML,
  formatVolume,
  fromMillilitres,
  parseVolume,
  toMillilitres,
} from '@/health/units';
import {
  MAX_SLEEP_MINUTES,
  formatClockTime,
  formatDuration,
  parseClockTime,
  resolveSleepWindow,
  sleepConsistency,
  summariseSleep,
} from '@/health/sleepMath';
import {
  EMPTY_TOTALS,
  fromServingsScale,
  gramsToTenths,
  macroCalories,
  macroSplit,
  scaleNutrition,
  toServingsScale,
  totalNutrition,
} from '@/health/nutritionMath';

describe('volume units', () => {
  it('converts millilitres and litres exactly', () => {
    expect(toMillilitres(250, 'ml')).toBe(250);
    expect(toMillilitres(1, 'l')).toBe(1000);
    expect(toMillilitres(1.5, 'l')).toBe(1500);
    expect(toMillilitres(0.25, 'l')).toBe(250);
  });

  it('converts fluid ounces by rounding to the nearest millilitre', () => {
    // A US fluid ounce is 29.5735295625 ml exactly, so the conversion is inherently lossy.
    expect(toMillilitres(8, 'floz')).toBe(237);
    expect(ML_PER_FLUID_OUNCE).toBeCloseTo(29.5735, 3);
  });

  it('keeps the fluid-ounce error below half a millilitre', () => {
    for (const oz of [1, 4, 8, 16, 32]) {
      const exact = oz * ML_PER_FLUID_OUNCE;
      const stored = toMillilitres(oz, 'floz');
      // The documented cost of an INTEGER `amount_ml` column.
      expect(Math.abs(exact - stored)).toBeLessThanOrEqual(0.5);
    }
  });

  it('round-trips millilitres through display units', () => {
    expect(fromMillilitres(1500, 'l')).toBe(1.5);
    expect(fromMillilitres(250, 'ml')).toBe(250);
  });

  it('formats for display without false precision', () => {
    expect(formatVolume(250)).toBe('250 ml');
    expect(formatVolume(1500)).toBe('1.5 L');
    expect(formatVolume(2000, 'l')).toBe('2 L');
  });

  it('parses a bare number as millilitres', () => {
    expect(parseVolume('250')).toEqual({ ml: 250, unit: 'ml' });
  });

  it('parses every supported unit, with or without a space', () => {
    expect(parseVolume('250ml')?.ml).toBe(250);
    expect(parseVolume('250 ml')?.ml).toBe(250);
    expect(parseVolume('1.5l')?.ml).toBe(1500);
    expect(parseVolume('1.5 L')?.ml).toBe(1500);
    expect(parseVolume('16oz')?.ml).toBe(473);
    expect(parseVolume('16 floz')?.ml).toBe(473);
    expect(parseVolume('16 fl oz')?.ml).toBe(473);
  });

  it('accepts the unit before the number', () => {
    expect(parseVolume('ml 250')?.ml).toBe(250);
    expect(parseVolume('L 1.5')?.ml).toBe(1500);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(parseVolume('  250 ML  ')?.ml).toBe(250);
    expect(parseVolume('OZ 16')?.ml).toBe(473);
  });

  it('rejects input it cannot parse rather than guessing', () => {
    // Guessing that "2 cups" means 500 ml would be an invention, and hydration advice
    // built on an invented conversion is worse than no advice.
    expect(parseVolume('2 cups')).toBeNull();
    expect(parseVolume('a lot')).toBeNull();
    expect(parseVolume('')).toBeNull();
    expect(parseVolume('-250')).toBeNull();
    expect(parseVolume('0')).toBeNull();
  });

  it('offers the quick-add amounts the specification names', () => {
    expect([...QUICK_ADD_ML]).toEqual([250, 500, 750, 1000]);
  });

  it('has a sensible default target and entry ceiling', () => {
    expect(DEFAULT_DAILY_TARGET_ML).toBe(2000);
    expect(MAX_ENTRY_ML).toBe(10_000);
  });
});

describe('clock times', () => {
  it('accepts a valid HH:MM', () => {
    expect(parseClockTime('07:30')).toEqual({ hours: 7, minutes: 30 });
    expect(parseClockTime('23:00')).toEqual({ hours: 23, minutes: 0 });
    expect(parseClockTime('7:05')).toEqual({ hours: 7, minutes: 5 });
  });

  it('rejects impossible times rather than coercing them', () => {
    expect(parseClockTime('25:00')).toBeNull();
    expect(parseClockTime('07:60')).toBeNull();
    expect(parseClockTime('7pm')).toBeNull();
    expect(parseClockTime('7')).toBeNull();
    expect(parseClockTime('')).toBeNull();
  });

  it('formats an epoch as 24-hour local time', () => {
    expect(formatClockTime(new Date(2026, 0, 15, 23, 5).getTime())).toBe('23:05');
    expect(formatClockTime(new Date(2026, 0, 15, 7, 0).getTime())).toBe('07:00');
  });
});
describe('sleep windows', () => {
  it('handles a night that crosses midnight', () => {
    // The case the schema's `wake_time >= bedtime` check depends on: 23:00 and 07:00
    // cannot both be on the same date.
    const result = resolveSleepWindow({
      sleepDate: '2026-01-15',
      bedtime: '23:00',
      wakeTime: '07:00',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.window.durationMin).toBe(8 * 60);
    // The bedtime really is the previous evening.
    expect(new Date(result.window.bedtime).getDate()).toBe(14);
    expect(new Date(result.window.wakeTime).getDate()).toBe(15);
  });

  it('handles a night within the same day', () => {
    const result = resolveSleepWindow({
      sleepDate: '2026-01-15',
      bedtime: '01:00',
      wakeTime: '09:00',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.window.durationMin).toBe(8 * 60);
  });

  it('handles a nap', () => {
    const result = resolveSleepWindow({
      sleepDate: '2026-01-15',
      bedtime: '14:00',
      wakeTime: '14:30',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.window.durationMin).toBe(30);
  });

  it('steps back a month boundary correctly', () => {
    const result = resolveSleepWindow({
      sleepDate: '2026-03-01',
      bedtime: '23:30',
      wakeTime: '07:30',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Date(result.window.bedtime).getMonth()).toBe(1); // February.
    expect(result.window.durationMin).toBe(8 * 60);
  });

  it('rejects a wake time at or before bedtime', () => {
    const result = resolveSleepWindow({
      sleepDate: '2026-01-15',
      bedtime: '08:00',
      wakeTime: '08:00',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('duration');
  });

  it('rejects a duration that is almost certainly a typo', () => {
    const result = resolveSleepWindow({
      sleepDate: '2026-01-15',
      bedtime: '08:00',
      // An earlier clock time, so this resolves to nearly 24 hours.
      wakeTime: '07:00',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('duration');
    expect(MAX_SLEEP_MINUTES).toBe(16 * 60);
  });

  it('names the offending input field', () => {
    const bad = resolveSleepWindow({
      sleepDate: '2026-01-15',
      bedtime: '99:99',
      wakeTime: '07:00',
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.field).toBe('bedtime');

    const badWake = resolveSleepWindow({
      sleepDate: '2026-01-15',
      bedtime: '23:00',
      wakeTime: 'nope',
    });
    expect(badWake.ok).toBe(false);
    if (badWake.ok) return;
    expect(badWake.field).toBe('wakeTime');
  });
});

describe('sleep statistics', () => {
  it('summarises nights from the log', () => {
    const summary = summariseSleep([420, 450, 480]);

    expect(summary.nights).toBe(3);
    expect(summary.averageMinutes).toBe(450);
    expect(summary.shortestMinutes).toBe(420);
    expect(summary.longestMinutes).toBe(480);
  });

  it('reports zeroes rather than a blank when nothing is logged', () => {
    expect(summariseSleep([])).toEqual({
      nights: 0,
      averageMinutes: 0,
      shortestMinutes: null,
      longestMinutes: null,
    });
  });

  it('ignores non-positive values rather than skewing the average', () => {
    const summary = summariseSleep([420, 0, -30, 480]);
    expect(summary.nights).toBe(2);
    expect(summary.averageMinutes).toBe(450);
  });

  it('refuses to state a consistency figure from too little data', () => {
    // One or two nights cannot show a pattern, and a number from them would mislead.
    expect(sleepConsistency([])).toBeNull();
    expect(sleepConsistency([420])).toBeNull();
    expect(sleepConsistency([420, 480])).toBeNull();
    expect(sleepConsistency([420, 450, 480])).toBe(60);
  });

  it('formats durations for display', () => {
    expect(formatDuration(450)).toBe('7h 30m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(480)).toBe('8h 0m');
    expect(formatDuration(-10)).toBe('0m');
  });
});

describe('nutrition arithmetic', () => {
  const food = {
    servingGrams: 100,
    calories: 200,
    proteinG: 150, // 15.0 g
    carbsG: 200, // 20.0 g
    fatG: 80, // 8.0 g
    fiberG: 25, // 2.5 g
  };

  it('round-trips servings through the integer scale', () => {
    expect(toServingsScale(1)).toBe(100);
    expect(toServingsScale(0.5)).toBe(50);
    expect(toServingsScale(2.25)).toBe(225);
    expect(fromServingsScale(225)).toBe(2.25);
  });

  it('scales a serving exactly for whole servings', () => {
    // One serving is the identity, and two servings is exactly double.
    const one = scaleNutrition(food, 100);
    expect(one.calories).toBe(food.calories);
    expect(one.proteinG).toBe(food.proteinG);

    expect(scaleNutrition(food, 200).calories).toBe(400);
    expect(scaleNutrition(food, 200).proteinG).toBe(300);
  });

  it('scales a half serving without drift', () => {
    // Halving is exact for these values, so this one really is lossless.
    expect(scaleNutrition(food, 50).calories).toBe(100);
    expect(scaleNutrition(food, 50).proteinG).toBe(75);
  });

  it('bounds the loss from rounding a quarter serving', () => {
    // 15.0 g protein over four servings is 3.75 g, which is not a whole tenth of a gram.
    // The stored integer is therefore off by at most half a tenth — 0.05 g per entry.
    const quarter = scaleNutrition(food, 25);
    const exact = (food.proteinG / 4);
    expect(Math.abs(quarter.proteinG - exact)).toBeLessThanOrEqual(0.5);
  });

  it('keeps every stored value an integer', () => {
    // SQLite columns are INTEGER; a float here would be rounded by the driver, silently.
    for (const value of Object.values(scaleNutrition(food, 33))) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('totals a day exactly', () => {
    expect(
      totalNutrition([
        { calories: 200, proteinG: 150, carbsG: 200, fatG: 80, fiberG: 25 },
        { calories: 150, proteinG: 90, carbsG: 120, fatG: 40, fiberG: 10 },
      ]),
    ).toEqual({ calories: 350, proteinG: 240, carbsG: 320, fatG: 120, fiberG: 35 });
  });

  it('totals an empty day as zeroes', () => {
    expect(totalNutrition([])).toEqual(EMPTY_TOTALS);
  });

  it('converts grams to tenths, rounding once', () => {
    expect(gramsToTenths(15)).toBe(150);
    expect(gramsToTenths(2.5)).toBe(25);
    expect(gramsToTenths(2.44)).toBe(24);
    expect(gramsToTenths(-5)).toBe(0);
    expect(gramsToTenths(Number.NaN)).toBe(0);
  });

  it('computes macro calories with the 4/4/9 rule', () => {
    // 15 g protein = 60, 20 g carbs = 80, 8 g fat = 72.
    expect(macroCalories(food)).toBe(212);
  });

  it('splits calories between macros', () => {
    const split = macroSplit(food);
    expect(split.protein + split.carbs + split.fat).toBeCloseTo(1, 5);
    expect(split.fat).toBeGreaterThan(split.protein);
  });

  it('reports a zero split for an empty day rather than dividing by zero', () => {
    expect(macroSplit(EMPTY_TOTALS)).toEqual({ protein: 0, carbs: 0, fat: 0 });
    expect(macroCalories(EMPTY_TOTALS)).toBe(0);
  });
});
