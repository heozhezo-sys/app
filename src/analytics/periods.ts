/**
 * Analytics period arithmetic.
 *
 * `FEATURES/ANALYTICS.md` asks for "Daily, weekly, monthly and yearly views" and to
 * "Prefer useful trends over excessive charts".
 *
 * The rule that shapes everything here: **a period is a set of local calendar days**, not
 * an instant. `src/utils/dates.ts` already insists that "today" is local, and an analytics
 * range that quietly used UTC would report a user in UTC+13 as having logged nothing on
 * the morning they logged something. So every period is expressed as a `from`/`to` pair of
 * `DateKey`s and only converted to instants at the point of querying.
 *
 * The previous period is derived by walking backwards from the start, which keeps "this
 * week vs last week" symmetric by construction — the alternative, computing each period's
 * length independently, drifts at month boundaries.
 */

import { addDays, diffDays, endOfWeek, isoWeekKey, monthKey, startOfWeek, yearKey, type DateKey, type WeekStart } from '@/utils/dates';

export const PERIOD_TYPES = ['day', 'week', 'month', 'year'] as const;

export type PeriodType = (typeof PERIOD_TYPES)[number];

export const PERIOD_LABELS: Record<PeriodType, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  year: 'Year',
};

export interface Period {
  type: PeriodType;
  /** Inclusive first local day. */
  from: DateKey;
  /** Inclusive last local day. */
  to: DateKey;
  /**
   * Stable identifier for the period, used for grouping and for `reviews.period_key`.
   *
   * `YYYY-MM-DD`, `YYYY-Www`, `YYYY-MM` and `YYYY` respectively.
   */
  key: string;
  /** Inclusive day count. */
  days: number;
}

export interface PeriodOptions {
  weekStartsOn?: WeekStart;
  /** Monday by default, matching the app's default setting. */
}

/**
 * The first day of the month *after* the month containing `key`.
 *
 * Adding 32 days and re-deriving the key handles every month length, including February
 * in a leap year, without a special case or a calendar library.
 */
function nextMonthFirst(key: DateKey): DateKey {
  return `${monthKey(addDays(key, 32))}-01`;
}

/**
 * The period of `type` containing `anchor`.
 *
 * `to` is the *end of the containing period*, not `anchor`. That is deliberate: asking for
 * "this month" means the whole month, including days that have not happened yet, so the
 * totals can legitimately be compared against the same period last month. Truncating to
 * `anchor` would make every current-period figure look like a decline.
 */
export function periodContaining(
  anchor: DateKey,
  type: PeriodType,
  options: PeriodOptions = {},
): Period {
  const weekStartsOn = options.weekStartsOn ?? 1;

  switch (type) {
    case 'day':
      return { type, from: anchor, to: anchor, key: anchor, days: 1 };

    case 'week': {
      const from = startOfWeek(anchor, weekStartsOn);
      const to = endOfWeek(anchor, weekStartsOn);
      return { type, from, to, key: isoWeekKey(anchor), days: diffDays(from, to) + 1 };
    }

    case 'month': {
      const from = `${monthKey(anchor)}-01`;
      const to = addDays(nextMonthFirst(from), -1);
      return { type, from, to, key: monthKey(anchor), days: diffDays(from, to) + 1 };
    }

    case 'year': {
      const from = `${yearKey(anchor)}-01-01`;
      const to = `${yearKey(anchor)}-12-31`;
      return { type, from, to, key: yearKey(anchor), days: diffDays(from, to) + 1 };
    }

    default:
      return { type: 'day', from: anchor, to: anchor, key: anchor, days: 1 };
  }
}

/**
 * The period immediately before `period`.
 *
 * Walks backwards from `period.from` by exactly `period.days`, which handles month and
 * year boundaries without a calendar library. Note the result can have a different day
 * count from `period` (31 days vs 28); that is correct, and the caller compares totals
 * rather than averages when the lengths differ.
 */
export function previousPeriod(period: Period): Period {
  const to = addDays(period.from, -1);

  switch (period.type) {
    case 'day': {
      // The day before, whatever month it was in.
      const from = to;
      return { type: 'day', from, to, key: from, days: 1 };
    }

    case 'week': {
      const from = addDays(period.from, -7);
      return {
        type: 'week',
        from,
        to: addDays(from, 6),
        key: isoWeekKey(from),
        days: 7,
      };
    }

    case 'month': {
      // `to` is already the last day of the previous month, so the previous period is
      // simply the whole month that contains it. Subtracting another month here would
      // land two months back (31 Dec -> 30 Nov).
      const from = `${monthKey(to)}-01`;
      const lastDay = addDays(nextMonthFirst(from), -1);
      return {
        type: 'month',
        from,
        to: lastDay,
        key: monthKey(from),
        days: diffDays(from, lastDay) + 1,
      };
    }

    case 'year': {
      // Likewise: `to` is 31 December of the year before, so its own year is the answer.
      const year = Number(yearKey(to));
      const from = `${year}-01-01`;
      const last = `${year}-12-31`;
      return { type: 'year', from, to: last, key: String(year), days: diffDays(from, last) + 1 };
    }

    default:
      return period;
  }
}

/**
 * A trailing window ending on `end`, e.g. "the last 30 days".
 *
 * Distinct from a calendar period and reported separately, because "last 30 days" and
 * "this month" are genuinely different questions and conflating them is how analytics
 * dashboards start lying.
 */
export function trailingPeriod(end: DateKey, days: number): Period {
  const span = Math.max(1, Math.trunc(days));
  const from = addDays(end, -(span - 1));
  return { type: 'day', from, to: end, key: `${from}_${end}`, days: span };
}

/** Every period of `type` between two anchors, oldest first. */
export function periodsBetween(
  from: DateKey,
  to: DateKey,
  type: PeriodType,
  options: PeriodOptions = {},
): Period[] {
  const out: Period[] = [];
  // One step per period, walked forward from the period containing `from`.
  let cursor = periodContaining(from, type, options).from;

  for (let guard = 0; guard < 500; guard += 1) {
    const period = periodContaining(cursor, type, options);
    out.push(period);
    // Step past this period to reach the next one.
    const next = addDays(period.to, 1);
    if (diffDays(next, to) < 0) break;
    if (next === cursor) break;
    cursor = next;
  }

  return out;
}

/* ------------------------------------------------------------------ trends */

export type TrendDirection = 'up' | 'down' | 'flat';

export interface Trend {
  current: number;
  previous: number;
  /** Signed difference. Never sign-flipped for metrics where "up" is not good. */
  delta: number;
  /** Percentage change, or null when the previous value was zero. */
  percentChange: number | null;
  direction: TrendDirection;
}

/**
 * Compares a period against the one before it.
 *
 * Returns `null` — not a zero delta — when there is no previous figure, so a UI can say
 * "nothing to compare yet" instead of asserting a change that never happened.
 *
 * **Direction is not goodness.** Spending more, or sleeping less, both register as
 * 'down' or 'up' according to the raw numbers. Deciding whether a direction is welcome is
 * a judgement about the metric, and it belongs at the call site, not here.
 */
export function compareToPrevious(
  current: number,
  previous: number | null | undefined,
): Trend | null {
  if (previous === null || previous === undefined) return null;

  const delta = Math.round((current - previous) * 100) / 100;
  return {
    current,
    previous,
    delta,
    // Dividing by zero would report an infinite change; a jump from nothing is simply
    // not a percentage.
    percentChange: previous === 0 ? null : Math.round((delta / Math.abs(previous)) * 100),
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
  };
}

/**
 * A sparkline-ready series.
 *
 * Returns one point per day in the range, including days with no data as `null` rather
 * than as `0`. A gap in the record is not a zero — it is an absence — and plotting it as
 * zero invents a dip that never happened.
 */
export function dailySeries(
  dates: readonly DateKey[],
  valueFor: (date: DateKey) => number | null,
): { date: DateKey; value: number | null }[] {
  return dates.map((date) => ({ date, value: valueFor(date) }));
}

/** Mean of the present values, or null when none are present. */
export function meanOf(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return null;
  const total = present.reduce((sum, value) => sum + value, 0);
  return Math.round((total / present.length) * 100) / 100;
}

/** Sum of the present values. */
export function sumOf(values: readonly (number | null)[]): number {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

export { isoWeekKey, monthKey, yearKey };
