/**
 * Analytics use cases.
 *
 * `FEATURES/ANALYTICS.md`: "Track habits, workouts, reading, focus, sleep, hydration,
 * goals, sports and finance. Use derived metrics from historical records. Prefer useful
 * trends over excessive charts."
 *
 * Every number here is a `SELECT` over stored records, computed on read. There is no
 * rollup table and no cached aggregate anywhere, which follows ARCHITECTURE.md ("Historical
 * events are the source of truth. Derive totals from logs/sessions where practical") and
 * means a report can never disagree with the history it summarises.
 *
 * Two structural choices worth stating, because both are load-bearing:
 *
 *  - **Named bindings, not one big `Promise.all` tuple.** A 38-element tuple of
 *    same-typed values is silent-until-it-isn't: remove one query and every later value
 *    shifts by one with no error. Named consts make a query/metric mismatch a compile
 *    error and the mapping obvious.
 *  - **No interpretation.** Nothing here says a month was good, that sleep was too short,
 *    or that spending rose. It reports totals, coverage and direction. Whether a number
 *    is welcome depends on what the user was trying to do.
 */

import { getDatabase } from '@/database/database';
import type { SqlDriver, SqlValue } from '@/database/driver';
import { dateRange, type DateKey } from '@/utils/dates';
import {
  PERIOD_TYPES,
  compareToPrevious,
  dailySeries,
  periodContaining,
  previousPeriod,
  sumOf,
  type Period,
  type PeriodType,
  type Trend,
} from '@/analytics/periods';

/** Hard ceiling on any single report, so a bad input cannot become a memory problem. */
export const MAX_PERIOD_DAYS = 800;

/* ------------------------------------------------------------- primitives */

interface CountRow {
  n: number | null;
}

async function count(
  db: SqlDriver,
  sql: string,
  params: readonly SqlValue[] = [],
): Promise<number> {
  const row = await db.first<CountRow>(sql, params);
  // `COUNT(*)`/`SUM()` over no rows yields NULL, which means zero, not "unknown".
  return row?.n ?? 0;
}

/** Inclusive local-day bounds for a period, widened to the whole day at each end. */
function epochBounds(period: Period): { from: number; to: number } {
  const [fy, fm, fd] = period.from.split('-').map(Number);
  const [ty, tm, td] = period.to.split('-').map(Number);
  return {
    from: new Date(fy ?? 1970, (fm ?? 1) - 1, fd ?? 1, 0, 0, 0, 0).getTime(),
    to: new Date(ty ?? 1970, (tm ?? 1) - 1, td ?? 1, 23, 59, 59, 999).getTime(),
  };
}

/**
 * SQLite expression for the local calendar day of a timestamp column.
 *
 * `'localtime'` is deliberate. Analytics buckets must group by the day the *user* lived
 * through; a UTC bucket would move a late-evening workout into the following day for
 * anyone east of Greenwich.
 */
const LOCAL_DAY = (column: string): string =>
  `date(${column} / 1000, 'unixepoch', 'localtime')`;

/**
 * Per-day counts for one table within a period.
 *
 * One query per domain rather than a single `UNION` across everything, because the
 * per-domain map is what each metric's sparkline needs, and a user who logged only water
 * must see zero active workout days — which is the honest answer, not a missing metric.
 */
async function dayCoverage(
  db: SqlDriver,
  table: string,
  dateExpression: string,
  period: Period,
  extraWhere = '',
): Promise<Map<DateKey, number>> {
  const rows = await db.all<{ day: string; n: number }>(
    `SELECT ${dateExpression} AS day, COUNT(*) AS n FROM ${table}
      WHERE ${dateExpression} >= ? AND ${dateExpression} <= ?
        ${extraWhere ? `AND ${extraWhere}` : ''}
      GROUP BY ${dateExpression};`,
    [period.from, period.to],
  );

  return new Map(rows.map((row) => [row.day, row.n]));
}

/** `SUM(amount_column)` over a date-key range. */
async function sumAmount(
  db: SqlDriver,
  table: string,
  dateColumn: string,
  amountColumn: string,
  period: Period,
): Promise<number> {
  return count(
    db,
    `SELECT COALESCE(SUM(${amountColumn}), 0) AS n FROM ${table}
      WHERE ${dateColumn} >= ? AND ${dateColumn} <= ? AND deleted_at IS NULL;`,
    [period.from, period.to],
  );
}

/** Total minutes for the sleep/mobility tables, which share a `duration_min` column. */
async function sumMinutes(
  db: SqlDriver,
  table: string,
  dateColumn: string,
  period: Period,
): Promise<number> {
  return sumAmount(db, table, dateColumn, 'duration_min', period);
}

/** Money in or out, in integer minor units. */
async function sumKind(
  db: SqlDriver,
  kind: 'income' | 'expense',
  bounds: { from: number; to: number },
): Promise<number> {
  return count(
    db,
    `SELECT COALESCE(SUM(amount_minor), 0) AS n FROM finance_transactions
      WHERE deleted_at IS NULL AND kind = ? AND occurred_at >= ? AND occurred_at <= ?;`,
    [kind, bounds.from, bounds.to],
  );
}

/**
 * Days on which *anything at all* was recorded.
 *
 * This is coverage, not a score: "you recorded something on 12 of 31 days" is a fact,
 * while a blended "engagement" number would be an invention.
 */
async function activeDayRows(
  db: SqlDriver,
  period: Period,
  bounds: { from: number; to: number },
): Promise<{ day: string }[]> {
  return db.all<{ day: string }>(
    `SELECT DISTINCT day FROM (
       SELECT log_date AS day FROM habit_logs
         WHERE completed = 1 AND log_date >= ? AND log_date <= ?
       UNION SELECT log_date AS day FROM water_logs
         WHERE deleted_at IS NULL AND log_date >= ? AND log_date <= ?
       UNION SELECT sleep_date AS day FROM sleep_logs
         WHERE deleted_at IS NULL AND sleep_date >= ? AND sleep_date <= ?
       UNION SELECT log_date AS day FROM recovery_logs
         WHERE deleted_at IS NULL AND log_date >= ? AND log_date <= ?
       UNION SELECT log_date AS day FROM mobility_sessions
         WHERE deleted_at IS NULL AND log_date >= ? AND log_date <= ?
       UNION SELECT entry_date AS day FROM journal_entries
         WHERE deleted_at IS NULL AND entry_date >= ? AND entry_date <= ?
       UNION SELECT ${LOCAL_DAY('started_at')} AS day FROM sport_sessions
         WHERE deleted_at IS NULL AND ended_at IS NOT NULL AND started_at >= ? AND started_at <= ?
       UNION SELECT ${LOCAL_DAY('ended_at')} AS day FROM workouts
         WHERE deleted_at IS NULL AND ended_at IS NOT NULL AND ended_at >= ? AND ended_at <= ?
     );`,
    [
      period.from, period.to,
      period.from, period.to,
      period.from, period.to,
      period.from, period.to,
      period.from, period.to,
      period.from, period.to,
      bounds.from, bounds.to,
      bounds.from, bounds.to,
    ],
  );
}

/* ----------------------------------------------------------------- shape */

/** One metric line: the value, its trend, and a per-day series for a sparkline. */
export interface Metric {
  key: string;
  label: string;
  value: number;
  /** Null when there is no comparable previous period. */
  trend: Trend | null;
  /** Per-day points. A `null` value means "no record", never zero. */
  series: { date: DateKey; value: number | null }[];
  /** One line of plain-English context. Describes, never judges. */
  summary: string;
}

export interface AnalyticsReport {
  period: Period;
  metrics: Record<string, Metric>;
  /** Days in the period carrying at least one record of any kind. */
  activeDays: number;
  /** Out of `period.days`. */
  coveragePercent: number;
}

export interface ReportOptions {
  weekStartsOn?: 0 | 1;
}

/* ---------------------------------------------------------------- report */

/**
 * The full report for the period containing `anchor`.
 *
 * Totals rather than averages, because calendar periods are not all the same length
 * (28/29/30/31 days) and an average would quietly hide that. The day count is right there
 * on `period` for any caller that wants a rate.
 */
export async function reportFor(
  anchor: DateKey,
  type: PeriodType = 'month',
  options: ReportOptions = {},
): Promise<AnalyticsReport> {
  const { driver } = await getDatabase();

  const period = periodContaining(anchor, type, { weekStartsOn: options.weekStartsOn });
  const previous = previousPeriod(period);
  const days = period.days <= MAX_PERIOD_DAYS ? dateRange(period.from, period.to) : [];
  const bounds = epochBounds(period);
  const previousBounds = epochBounds(previous);

  /* ---- habits ---- */
  const habitDays = await dayCoverage(driver, 'habit_logs', 'log_date', period, 'completed = 1');
  const habitDaysBefore = await dayCoverage(driver, 'habit_logs', 'log_date', previous, 'completed = 1');
  const habitCheckIns = sumOf([...habitDays.values()]);
  const habitCheckInsBefore = sumOf([...habitDaysBefore.values()]);

  /* ---- fitness ---- */
  const workoutDays = await dayCoverage(
    driver, 'workouts', LOCAL_DAY('started_at'), period, "status = 'completed'",
  );
  const workoutDaysBefore = await dayCoverage(
    driver, 'workouts', LOCAL_DAY('started_at'), previous, "status = 'completed'",
  );
  const workoutMinutes = await count(
    driver,
    `SELECT COALESCE(SUM(ended_at - started_at), 0) / 60000 AS n FROM workouts
      WHERE deleted_at IS NULL AND status = 'completed' AND started_at >= ? AND started_at <= ?;`,
    [bounds.from, bounds.to],
  );
  const workouts = sumOf([...workoutDays.values()]);
  const workoutsBefore = sumOf([...workoutDaysBefore.values()]);

  const sportDays = await dayCoverage(
    driver, 'sport_sessions', LOCAL_DAY('started_at'), period, 'ended_at IS NOT NULL',
  );
  const sportDaysBefore = await dayCoverage(
    driver, 'sport_sessions', LOCAL_DAY('started_at'), previous, 'ended_at IS NOT NULL',
  );
  const sportMinutes = await count(
    driver,
    `SELECT COALESCE(SUM(duration_sec), 0) / 60 AS n FROM sport_sessions
      WHERE deleted_at IS NULL AND started_at >= ? AND started_at <= ?;`,
    [bounds.from, bounds.to],
  );
  const sportSessions = sumOf([...sportDays.values()]);
  const sportSessionsBefore = sumOf([...sportDaysBefore.values()]);

  const mobilityDays = await dayCoverage(driver, 'mobility_sessions', 'log_date', period);
  const mobilityMinutes = await sumMinutes(driver, 'mobility_sessions', 'log_date', period);
  const mobilityMinutesBefore = await sumMinutes(driver, 'mobility_sessions', 'log_date', previous);

  /* ---- books ---- */
  const readingMinutes = await count(
    driver,
    'SELECT COALESCE(SUM(ended_at - started_at), 0) / 60000 AS n FROM reading_sessions WHERE started_at >= ? AND started_at <= ?;',
    [bounds.from, bounds.to],
  );
  const readingMinutesBefore = await count(
    driver,
    'SELECT COALESCE(SUM(ended_at - started_at), 0) / 60000 AS n FROM reading_sessions WHERE started_at >= ? AND started_at <= ?;',
    [previousBounds.from, previousBounds.to],
  );
  const readingSessions = await count(
    driver,
    'SELECT COUNT(*) AS n FROM reading_sessions WHERE started_at >= ? AND started_at <= ?;',
    [bounds.from, bounds.to],
  );
  const booksFinished = await count(
    driver,
    `SELECT COUNT(*) AS n FROM books
      WHERE deleted_at IS NULL AND status = 'finished' AND finished_at >= ? AND finished_at <= ?;`,
    [bounds.from, bounds.to],
  );

  /* ---- focus ---- */
  const focusSessions = await count(
    driver,
    `SELECT COUNT(*) AS n FROM focus_sessions
      WHERE deleted_at IS NULL AND status = 'completed' AND completed_at >= ? AND completed_at <= ?;`,
    [bounds.from, bounds.to],
  );
  const focusSessionsBefore = await count(
    driver,
    `SELECT COUNT(*) AS n FROM focus_sessions
      WHERE deleted_at IS NULL AND status = 'completed' AND completed_at >= ? AND completed_at <= ?;`,
    [previousBounds.from, previousBounds.to],
  );
  const focusMinutes = await count(
    driver,
    `SELECT COALESCE(SUM(actual_sec), 0) / 60 AS n FROM focus_sessions
      WHERE deleted_at IS NULL AND status = 'completed' AND completed_at >= ? AND completed_at <= ?;`,
    [bounds.from, bounds.to],
  );

  /* ---- journal ---- */
  const journalDays = await dayCoverage(driver, 'journal_entries', 'entry_date', period);
  const journalDaysBefore = await dayCoverage(driver, 'journal_entries', 'entry_date', previous);
  const journalEntries = sumOf([...journalDays.values()]);
  const journalEntriesBefore = sumOf([...journalDaysBefore.values()]);

  /* ---- health ---- */
  const waterDays = await dayCoverage(driver, 'water_logs', 'log_date', period);
  const waterMl = await sumAmount(driver, 'water_logs', 'log_date', 'amount_ml', period);
  const waterMlBefore = await sumAmount(driver, 'water_logs', 'log_date', 'amount_ml', previous);

  const sleepDays = await dayCoverage(driver, 'sleep_logs', 'sleep_date', period);
  const sleepMinutes = await sumMinutes(driver, 'sleep_logs', 'sleep_date', period);
  const sleepMinutesBefore = await sumMinutes(driver, 'sleep_logs', 'sleep_date', previous);

  const recoveryDays = await dayCoverage(driver, 'recovery_logs', 'log_date', period);
  const recoveryDaysBefore = await dayCoverage(driver, 'recovery_logs', 'log_date', previous);
  const recoveryRated = sumOf([...recoveryDays.values()]);
  const recoveryRatedBefore = sumOf([...recoveryDaysBefore.values()]);

  /* ---- goals ---- */
  const goalsCompleted = await count(
    driver,
    `SELECT COUNT(*) AS n FROM goals
      WHERE deleted_at IS NULL AND status = 'completed' AND completed_at >= ? AND completed_at <= ?;`,
    [bounds.from, bounds.to],
  );
  const goalsCompletedBefore = await count(
    driver,
    `SELECT COUNT(*) AS n FROM goals
      WHERE deleted_at IS NULL AND status = 'completed' AND completed_at >= ? AND completed_at <= ?;`,
    [previousBounds.from, previousBounds.to],
  );
  const tasksCompleted = await count(
    driver,
    `SELECT COUNT(*) AS n FROM tasks
      WHERE deleted_at IS NULL AND status = 'done' AND completed_at >= ? AND completed_at <= ?;`,
    [bounds.from, bounds.to],
  );

  /* ---- finance ---- */
  const income = await sumKind(driver, 'income', bounds);
  const expenses = await sumKind(driver, 'expense', bounds);
  const incomeBefore = await sumKind(driver, 'income', previousBounds);
  const expensesBefore = await sumKind(driver, 'expense', previousBounds);
  const budgetTotal = await count(
    driver,
    'SELECT COALESCE(SUM(amount_minor), 0) AS n FROM budgets WHERE deleted_at IS NULL AND period_key = ?;',
    [period.key],
  );

  const series = (coverage: Map<DateKey, number>) =>
    dailySeries(days, (date) => coverage.get(date) ?? null);

  const metrics: Record<string, Metric> = {
    'habits.checkIns': {
      key: 'habits.checkIns',
      label: 'Habit check-ins',
      value: habitCheckIns,
      trend: compareToPrevious(habitCheckIns, habitCheckInsBefore),
      series: series(habitDays),
      summary: describeDays(habitDays, period.days),
    },
    'fitness.workouts': {
      key: 'fitness.workouts',
      label: 'Workouts',
      value: workouts,
      trend: compareToPrevious(workouts, workoutsBefore),
      series: series(workoutDays),
      summary: workouts === 0 ? 'No workouts recorded.' : `${formatMinutes(workoutMinutes)} of training.`,
    },
    'fitness.sportSessions': {
      key: 'fitness.sportSessions',
      label: 'Sport sessions',
      value: sportSessions,
      trend: compareToPrevious(sportSessions, sportSessionsBefore),
      series: series(sportDays),
      summary: sportSessions === 0 ? 'No sport logged.' : `${formatMinutes(sportMinutes)} of logged sport.`,
    },
    'fitness.mobilityMinutes': {
      key: 'fitness.mobilityMinutes',
      label: 'Mobility minutes',
      value: mobilityMinutes,
      trend: compareToPrevious(mobilityMinutes, mobilityMinutesBefore),
      series: series(mobilityDays),
      summary: describeDays(mobilityDays, period.days),
    },
    'books.readingMinutes': {
      key: 'books.readingMinutes',
      label: 'Reading minutes',
      value: readingMinutes,
      trend: compareToPrevious(readingMinutes, readingMinutesBefore),
      series: [],
      summary: `${readingSessions} session${readingSessions === 1 ? '' : 's'} · ${booksFinished} book${booksFinished === 1 ? '' : 's'} finished.`,
    },
    'focus.sessions': {
      key: 'focus.sessions',
      label: 'Focus sessions',
      value: focusSessions,
      trend: compareToPrevious(focusSessions, focusSessionsBefore),
      series: [],
      summary: `${formatMinutes(focusMinutes)} of focused work.`,
    },
    'journal.entries': {
      key: 'journal.entries',
      label: 'Journal entries',
      value: journalEntries,
      trend: compareToPrevious(journalEntries, journalEntriesBefore),
      series: series(journalDays),
      summary: describeDays(journalDays, period.days),
    },
    'health.waterMl': {
      key: 'health.waterMl',
      label: 'Water logged',
      value: waterMl,
      trend: compareToPrevious(waterMl, waterMlBefore),
      series: series(waterDays),
      summary: waterDays.size === 0
        ? 'No water logged.'
        : `${(waterMl / 1000).toFixed(1)} L across ${waterDays.size} day${waterDays.size === 1 ? '' : 's'}.`,
    },
    'health.sleepMinutes': {
      key: 'health.sleepMinutes',
      label: 'Sleep minutes',
      value: sleepMinutes,
      trend: compareToPrevious(sleepMinutes, sleepMinutesBefore),
      series: series(sleepDays),
      summary: describeDays(sleepDays, period.days),
    },
    'health.recoveryDays': {
      key: 'health.recoveryDays',
      label: 'Recovery rated',
      value: recoveryRated,
      trend: compareToPrevious(recoveryRated, recoveryRatedBefore),
      series: series(recoveryDays),
      summary: describeDays(recoveryDays, period.days),
    },
    'goals.completed': {
      key: 'goals.completed',
      label: 'Goals completed',
      value: goalsCompleted,
      trend: compareToPrevious(goalsCompleted, goalsCompletedBefore),
      series: [],
      summary: `${tasksCompleted} task${tasksCompleted === 1 ? '' : 's'} completed.`,
    },
    'finance.incomeMinor': {
      key: 'finance.incomeMinor',
      label: 'Income',
      value: income,
      trend: compareToPrevious(income, incomeBefore),
      series: [],
      summary: 'Money in, in minor units.',
    },
    'finance.expensesMinor': {
      key: 'finance.expensesMinor',
      label: 'Expenses',
      value: expenses,
      trend: compareToPrevious(expenses, expensesBefore),
      series: [],
      summary: budgetTotal > 0
        ? `${pct(expenses, budgetTotal)}% of this period's budget used.`
        : 'No budget set for this period.',
    },
    'finance.netMinor': {
      key: 'finance.netMinor',
      label: 'Net',
      value: income - expenses,
      trend: compareToPrevious(income - expenses, incomeBefore - expensesBefore),
      series: [],
      summary: income - expenses >= 0 ? 'More in than out.' : 'More out than in.',
    },
  };

  const activeDays = (await activeDayRows(driver, period, bounds)).length;

  return {
    period,
    metrics,
    activeDays,
    coveragePercent: pct(activeDays, period.days),
  };
}

/**
 * "Recorded on 12 of 31 days."
 *
 * Contains no adjective on purpose. Whether 12 of 31 is enough depends entirely on what
 * the user was trying to do, which is not this app's call.
 */
function describeDays(coverage: Map<DateKey, number>, daysInPeriod: number): string {
  const recorded = coverage.size;
  if (recorded === 0) return `Nothing recorded in ${daysInPeriod} days.`;
  return `Recorded on ${recorded} of ${daysInPeriod} days.`;
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.round((part / whole) * 100));
}

/** `95 min`, `1h 35m`. */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** Renders a metric for display, formatted per its kind. */
export function formatMetric(metric: Metric): string {
  switch (metric.key) {
    case 'health.waterMl':
      return `${(metric.value / 1000).toFixed(1)} L`;
    case 'finance.incomeMinor':
    case 'finance.expensesMinor':
    case 'finance.netMinor':
      // Minor units; the currency symbol is the caller's to add.
      return (metric.value / 100).toFixed(2);
    default:
      return metric.value.toLocaleString();
  }
}

/* ------------------------------------------------------------- comparison */

export interface PeriodComparison {
  period: Period;
  previous: Period;
  metrics: {
    key: string;
    label: string;
    current: number;
    previous: number;
    trend: Trend | null;
  }[];
}

/** Side-by-side totals for a period and the one before it. */
export async function comparePeriods(
  anchor: DateKey,
  type: PeriodType = 'month',
): Promise<PeriodComparison> {
  const current = await reportFor(anchor, type);
  const before = previousPeriod(current.period);
  const previous = await reportFor(before.to, type);

  return {
    period: current.period,
    previous: previous.period,
    metrics: Object.values(current.metrics).map((metric) => ({
      key: metric.key,
      label: metric.label,
      current: metric.value,
      previous: previous.metrics[metric.key]?.value ?? 0,
      trend: metric.trend,
    })),
  };
}

/** The metrics worth showing first, in reading order. Anything else is opt-in. */
export const PRIMARY_METRIC_KEYS: readonly string[] = [
  'habits.checkIns',
  'fitness.workouts',
  'health.sleepMinutes',
  'health.waterMl',
  'focus.sessions',
  'books.readingMinutes',
];

export { PERIOD_TYPES, periodContaining, previousPeriod, compareToPrevious };
export type { Period, PeriodType, Trend };
