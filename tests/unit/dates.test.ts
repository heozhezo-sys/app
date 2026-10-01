/**
 * Local calendar-date behaviour.
 *
 * The failure mode this file exists to prevent: a habit logged at 23:30 in UTC+13
 * being stored as the previous day, or a streak silently breaking because the user
 * changed timezone.
 */

import {
  addDays,
  dateRange,
  diffDays,
  endOfWeek,
  fromDateKey,
  isDateKey,
  isoWeekKey,
  monthKey,
  startOfWeek,
  toDateKey,
} from '@/utils/dates';

describe('date keys', () => {
  it('round-trips a key', () => {
    expect(toDateKey(fromDateKey('2026-01-15'))).toBe('2026-01-15');
  });

  it('pads single-digit months and days', () => {
    expect(toDateKey(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
  });

  it('rejects impossible calendar dates', () => {
    expect(() => fromDateKey('2026-02-31')).toThrow(RangeError);
    expect(() => fromDateKey('2026-13-01')).toThrow(RangeError);
    expect(() => fromDateKey('nonsense')).toThrow(RangeError);
  });

  it('validates keys without throwing', () => {
    expect(isDateKey('2026-02-28')).toBe(true);
    expect(isDateKey('2026-02-31')).toBe(false);
    expect(isDateKey('2026-2-8')).toBe(false);
    expect(isDateKey('')).toBe(false);
  });
});

describe('day arithmetic', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('does NOT treat a leap year as a leap year', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('computes signed day differences', () => {
    expect(diffDays('2026-01-01', '2026-01-31')).toBe(30);
    expect(diffDays('2026-01-31', '2026-01-01')).toBe(-30);
    expect(diffDays('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('builds inclusive ranges', () => {
    expect(dateRange('2026-01-01', '2026-01-04')).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
    ]);
    expect(dateRange('2026-01-01', '2026-01-01')).toEqual(['2026-01-01']);
  });

  it('crosses a DST transition without losing or duplicating a day', () => {
    // Northern-hemisphere spring forward. With a noon anchor the span stays exact.
    const days = dateRange('2026-03-28', '2026-03-31');
    expect(days).toEqual(['2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);
  });
});

describe('weeks', () => {
  it('finds the start of a week for both conventions', () => {
    // 2026-01-15 is a Thursday.
    expect(startOfWeek('2026-01-15', 1)).toBe('2026-01-12');
    expect(startOfWeek('2026-01-15', 0)).toBe('2026-01-11');
  });

  it('keeps a Sunday-only week starting on Sunday', () => {
    // 2026-01-18 is a Sunday.
    expect(startOfWeek('2026-01-18', 0)).toBe('2026-01-18');
    expect(startOfWeek('2026-01-18', 1)).toBe('2026-01-12');
  });

  it('ends the week six days after it starts', () => {
    expect(endOfWeek('2026-01-15', 1)).toBe('2026-01-18');
  });

  it('produces ISO week keys', () => {
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01');
    expect(isoWeekKey('2026-12-31')).toBe('2026-W53');
  });
});

/**
 * Exact ISO-8601 week numbers.
 *
 * These previously asserted only the *shape* of the key, which let an off-by-one pass.
 * `isoWeekKey` files weekly reviews and budgets, so a week filed under the wrong number
 * is data the user cannot find again.
 */
describe('ISO week numbering', () => {
  const cases: [string, string][] = [
    // 2026-01-01 is a Thursday, so it is itself the first Thursday of the year.
    ['2026-01-01', '2026-W01'],
    ['2026-01-02', '2026-W01'],
    ['2026-01-04', '2026-W01'], // Sunday still belongs to week 1.
    ['2026-01-05', '2026-W02'], // Monday starts week 2.
    ['2026-01-08', '2026-W02'],
    ['2026-01-11', '2026-W02'], // Sunday of week 2.
    ['2026-01-12', '2026-W03'],
    // A year with 53 ISO weeks: 2026 starts on a Thursday, so 31 Dec is W53.
    ['2026-12-28', '2026-W53'],
    ['2026-12-31', '2026-W53'],
    // 2025 starts on a Wednesday and its first Thursday is 2 January, so ISO week 1 of
    // 2025 begins on Monday 30 December 2024.
    ['2024-12-30', '2025-W01'],
    ['2025-01-01', '2025-W01'],
    ['2025-01-05', '2025-W01'], // Sunday of week 1.
    ['2025-01-06', '2025-W02'],
    // 2024 started on a Monday, so it has 52 ISO weeks and no week 53.
    ['2024-12-29', '2024-W52'],
  ];

  it.each(cases)('%s is %s', (date, expected) => {
    expect(isoWeekKey(date)).toBe(expected);
  });

  it('gives every day of one week the same key', () => {
    // Monday to Sunday of ISO week 2 are all W02.
    const keys = [
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
      '2026-01-08',
      '2026-01-09',
      '2026-01-10',
      '2026-01-11',
    ].map(isoWeekKey);

    expect(new Set(keys)).toEqual(new Set(['2026-W02']));
  });
});

describe('period keys', () => {
  it('derives month and year keys', () => {
    expect(monthKey('2026-01-15')).toBe('2026-01');
    expect(monthKey('2026-12-31')).toBe('2026-12');
  });
});

describe('local-vs-UTC safety', () => {
  it('formats a late-evening local time as the same calendar day', () => {
    // 23:30 local must stay on the same day regardless of the runner's timezone,
    // which is exactly what using toISOString() would break.
    const lateEvening = new Date(2026, 4, 10, 23, 30, 0, 0);
    expect(toDateKey(lateEvening)).toBe('2026-05-10');
  });

  it('formats an early-morning local time as the same calendar day', () => {
    const earlyMorning = new Date(2026, 4, 10, 0, 15, 0, 0);
    expect(toDateKey(earlyMorning)).toBe('2026-05-10');
  });
});
