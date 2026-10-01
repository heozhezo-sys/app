/**
 * Analytics: period arithmetic and derived reports.
 *
 * These run against real SQLite, because the point of the feature is that its numbers
 * come from the same records the rest of the app writes.
 */

import { NodeSqliteDriver } from '../support/nodeSqliteDriver';
import { runMigrations } from '@/database/migrator';
import { __setDatabaseHandleForTests, __resetDatabaseHandleForTests } from '@/database/database';
import {
  compareToPrevious,
  dailySeries,
  meanOf,
  periodContaining,
  periodsBetween,
  previousPeriod,
  sumOf,
  trailingPeriod,
} from '@/analytics/periods';
import * as analytics from '@/services/analyticsService';

let driver: NodeSqliteDriver;

/** Local noon on a date, for inserting timestamped rows. */
function at(date: string, hour = 12): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y ?? 2026, (m ?? 1) - 1, d ?? 1, hour, 0, 0, 0).getTime();
}

beforeEach(async () => {
  driver = new NodeSqliteDriver();
  await runMigrations(driver);
  __setDatabaseHandleForTests(driver, 15);
});

afterEach(async () => {
  __resetDatabaseHandleForTests();
  await driver.close();
});

/* ------------------------------------------------------------------ pure */

describe('periodContaining', () => {
  it('spans a single day', () => {
    const period = periodContaining('2026-03-14', 'day');
    expect(period).toMatchObject({ from: '2026-03-14', to: '2026-03-14', days: 1, key: '2026-03-14' });
  });

  it('spans Monday to Sunday by default', () => {
    // 2026-03-14 is a Saturday.
    const period = periodContaining('2026-03-14', 'week');
    expect(period.from).toBe('2026-03-09');
    expect(period.to).toBe('2026-03-15');
    expect(period.days).toBe(7);
    expect(period.key).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('honours a Sunday week start', () => {
    const period = periodContaining('2026-03-14', 'week', { weekStartsOn: 0 });
    expect(period.from).toBe('2026-03-08');
    expect(period.to).toBe('2026-03-14');
  });

  it('spans the whole month, including days that have not happened yet', () => {
    const period = periodContaining('2026-03-14', 'month');
    expect(period.from).toBe('2026-03-01');
    expect(period.to).toBe('2026-03-31');
    expect(period.days).toBe(31);
    expect(period.key).toBe('2026-03');
  });

  it('handles February in a leap year', () => {
    const period = periodContaining('2026-02-10', 'month');
    expect(period.days).toBe(28);
    expect(period.to).toBe('2026-02-28');
  });

  it('handles February in a non-leap year', () => {
    expect(periodContaining('2027-02-10', 'month').days).toBe(28);
  });

  it('handles a 30-day month', () => {
    const period = periodContaining('2026-04-10', 'month');
    expect(period.days).toBe(30);
    expect(period.to).toBe('2026-04-30');
  });

  it('spans the whole year', () => {
    const period = periodContaining('2026-07-04', 'year');
    expect(period.from).toBe('2026-01-01');
    expect(period.to).toBe('2026-12-31');
    expect(period.days).toBe(365);
    expect(period.key).toBe('2026');
  });
});

describe('previousPeriod', () => {
  it('steps back a day', () => {
    expect(previousPeriod(periodContaining('2026-03-14', 'day'))).toMatchObject({
      from: '2026-03-13', to: '2026-03-13',
    });
  });

  it('steps back a week', () => {
    const current = periodContaining('2026-03-14', 'week');
    const previous = previousPeriod(current);
    expect(previous.from).toBe('2026-03-02');
    expect(previous.to).toBe('2026-03-08');
  });

  it('steps back a month across a year boundary', () => {
    const previous = previousPeriod(periodContaining('2026-01-15', 'month'));
    expect(previous.from).toBe('2025-12-01');
    expect(previous.to).toBe('2025-12-31');
    expect(previous.days).toBe(31);
  });

  it('steps back a year', () => {
    const previous = previousPeriod(periodContaining('2026-07-04', 'year'));
    expect(previous.from).toBe('2025-01-01');
    expect(previous.to).toBe('2025-12-31');
  });

  it('reports a different day count for a shorter previous month', () => {
    const current = periodContaining('2026-03-15', 'month');
    const previous = previousPeriod(current);
    expect(current.days).toBe(31);
    expect(previous.days).toBe(28);
  });

  it('never returns a period that overlaps the current one', () => {
    for (const anchor of ['2026-01-31', '2026-03-01', '2026-12-31', '2027-02-28']) {
      for (const type of ['day', 'week', 'month', 'year'] as const) {
        const current = periodContaining(anchor, type);
        const previous = previousPeriod(current);
        expect(previous.to < current.from).toBe(true);
      }
    }
  });
});

describe('trailingPeriod', () => {
  it('covers the requested number of days inclusive', () => {
    const period = trailingPeriod('2026-03-14', 30);
    expect(period.days).toBe(30);
    expect(period.to).toBe('2026-03-14');
    expect(period.from).toBe('2026-02-13');
  });

  it('never produces a zero or negative span', () => {
    expect(trailingPeriod('2026-03-14', 0).days).toBe(1);
    expect(trailingPeriod('2026-03-14', -5).days).toBe(1);
  });
});

describe('periodsBetween', () => {
  it('lists whole months covering the span, oldest first', () => {
    const periods = periodsBetween('2026-01-15', '2026-03-20', 'month');
    expect(periods.map((p) => p.key)).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('lists whole days for a short span', () => {
    const periods = periodsBetween('2026-03-01', '2026-03-05', 'day');
    expect(periods).toHaveLength(5);
    expect(periods[0]?.from).toBe('2026-03-01');
    expect(periods[4]?.to).toBe('2026-03-05');
  });
});

describe('compareToPrevious', () => {
  it('returns null when there is no previous figure', () => {
    expect(compareToPrevious(10, null)).toBeNull();
    expect(compareToPrevious(10, undefined)).toBeNull();
  });

  it('reports direction and delta', () => {
    expect(compareToPrevious(12, 10)).toMatchObject({ delta: 2, direction: 'up' });
    expect(compareToPrevious(8, 10)).toMatchObject({ delta: -2, direction: 'down' });
    expect(compareToPrevious(10, 10)).toMatchObject({ delta: 0, direction: 'flat' });
  });

  it('reports a percentage change', () => {
    expect(compareToPrevious(15, 10)?.percentChange).toBe(50);
  });

  it('does not invent a percentage from zero', () => {
    expect(compareToPrevious(15, 0)?.percentChange).toBeNull();
    expect(compareToPrevious(0, 0)?.percentChange).toBeNull();
  });

  it('treats a decrease in spending as a decrease, without judging it', () => {
    // Direction is arithmetic. Whether spending less is welcome is not this function's call.
    expect(compareToPrevious(40, 100)?.direction).toBe('down');
  });
});

describe('series helpers', () => {
  it('keeps gaps as null rather than zero', () => {
    const series = dailySeries(['2026-03-01', '2026-03-02', '2026-03-03'], (date) =>
      date === '2026-03-02' ? 5 : null,
    );
    expect(series).toEqual([
      { date: '2026-03-01', value: null },
      { date: '2026-03-02', value: 5 },
      { date: '2026-03-03', value: null },
    ]);
  });

  it('sums present values and ignores nulls', () => {
    expect(sumOf([1, null, 2])).toBe(3);
    expect(sumOf([null, null])).toBe(0);
  });

  it('averages present values only', () => {
    expect(meanOf([4, null, 6])).toBe(5);
    expect(meanOf([null])).toBeNull();
  });
});

/* ---------------------------------------------------------------- report */

async function seedMonth(): Promise<void> {
  await driver.run(
    `INSERT INTO habits (id, title, cadence, created_at, updated_at) VALUES ('h1', 'Read', 'daily', 1, 1);`,
  );
  for (const day of ['2026-03-01', '2026-03-02', '2026-03-03']) {
    await driver.run(
      `INSERT INTO habit_logs (id, habit_id, log_date, completed, count_value, created_at, updated_at)
       VALUES (?, 'h1', ?, 1, 1, 1, 1);`,
      [`l-${day}`, day],
    );
  }

  // Two finished workouts, 45 and 30 minutes.
  await driver.run(
    `INSERT INTO workouts (id, title, status, started_at, ended_at, created_at, updated_at)
     VALUES ('w1', 'Gym', 'completed', ?, ?, 1, 1);`,
    [at('2026-03-01', 9), at('2026-03-01', 9) + 45 * 60_000],
  );
  await driver.run(
    `INSERT INTO workouts (id, title, status, started_at, ended_at, created_at, updated_at)
     VALUES ('w2', 'Run', 'completed', ?, ?, 1, 1);`,
    [at('2026-03-02', 18), at('2026-03-02', 18) + 30 * 60_000],
  );

  await driver.run(
    `INSERT INTO water_logs (id, log_date, amount_ml, logged_at, created_at, updated_at)
     VALUES ('wa1', '2026-03-01', 500, 1, 1, 1);`,
  );
  await driver.run(
    `INSERT INTO sleep_logs (id, sleep_date, bedtime, wake_time, duration_min, created_at, updated_at)
     VALUES ('s1', '2026-03-02', 1, 2, 450, 1, 1);`,
  );
}

describe('reportFor', () => {
  it('returns an all-zero report for an empty month, without throwing', async () => {
    const report = await analytics.reportFor('2026-03-14', 'month');

    expect(report.period.key).toBe('2026-03');
    expect(report.metrics['habits.checkIns']?.value).toBe(0);
    expect(report.activeDays).toBe(0);
    expect(report.coveragePercent).toBe(0);
  });

  it('derives habit check-ins from the logs', async () => {
    await seedMonth();

    const report = await analytics.reportFor('2026-03-14', 'month');
    expect(report.metrics['habits.checkIns']?.value).toBe(3);
  });

  it('derives workout totals and minutes', async () => {
    await seedMonth();

    const report = await analytics.reportFor('2026-03-14', 'month');
    expect(report.metrics['fitness.workouts']?.value).toBe(2);
    expect(report.metrics['fitness.workouts']?.summary).toContain('1h 15m');
  });

  it('derives water and sleep', async () => {
    await seedMonth();

    const report = await analytics.reportFor('2026-03-14', 'month');
    expect(report.metrics['health.waterMl']?.value).toBe(500);
    expect(report.metrics['health.sleepMinutes']?.value).toBe(450);
  });

  it('computes coverage from days with any record', async () => {
    await seedMonth();

    const report = await analytics.reportFor('2026-03-14', 'month');
    // Habit logs on 1st-3rd; water on the 1st; sleep on the 2nd.
    expect(report.activeDays).toBe(3);
    expect(report.coveragePercent).toBe(10); // 3 of 31
  });

  it('excludes records outside the period', async () => {
    await seedMonth();
    await driver.run(
      `INSERT INTO habit_logs (id, habit_id, log_date, completed, count_value, created_at, updated_at)
       VALUES ('l-apr', 'h1', '2026-04-01', 1, 1, 1, 1);`,
    );

    const march = await analytics.reportFor('2026-03-14', 'month');
    const april = await analytics.reportFor('2026-04-02', 'month');

    expect(march.metrics['habits.checkIns']?.value).toBe(3);
    expect(april.metrics['habits.checkIns']?.value).toBe(1);
  });

  it('excludes soft-deleted records', async () => {
    await driver.run(
      `INSERT INTO water_logs (id, log_date, amount_ml, logged_at, created_at, updated_at, deleted_at)
       VALUES ('wd', '2026-03-05', 999, 1, 1, 1, 5000);`,
    );

    const report = await analytics.reportFor('2026-03-14', 'month');
    expect(report.metrics['health.waterMl']?.value).toBe(0);
  });

  it('excludes an in-progress workout from completed totals', async () => {
    await driver.run(
      `INSERT INTO workouts (id, title, status, started_at, created_at, updated_at)
       VALUES ('wip', 'Started', 'in_progress', ?, 1, 1);`,
      [at('2026-03-05')],
    );

    const report = await analytics.reportFor('2026-03-14', 'month');
    expect(report.metrics['fitness.workouts']?.value).toBe(0);
  });

  it('reports a trend against the previous month', async () => {
    // February: two check-ins. `seedMonth` creates the habit, so seed that first.
    await seedMonth();
    await driver.run(
      `INSERT INTO habit_logs (id, habit_id, log_date, completed, count_value, created_at, updated_at)
       VALUES ('f1', 'h1', '2026-02-01', 1, 1, 1, 1),
              ('f2', 'h1', '2026-02-02', 1, 1, 1, 1);`,
    );

    const report = await analytics.reportFor('2026-03-14', 'month');
    const metric = report.metrics['habits.checkIns'];

    expect(metric?.value).toBe(3);
    expect(metric?.trend).toMatchObject({ previous: 2, direction: 'up', delta: 1 });
  });

  it('reports a zero previous period as a real value, not a missing one', async () => {
    await seedMonth();

    const report = await analytics.reportFor('2026-03-14', 'month');
    // February had no habit logs, so the comparison is legitimate: 3 vs 0.
    expect(report.metrics['habits.checkIns']?.trend).toMatchObject({ previous: 0, delta: 3 });
    expect(report.metrics['habits.checkIns']?.trend?.percentChange).toBeNull();
  });

  it('keeps gaps in a series as null, not zero', async () => {
    await seedMonth();

    const report = await analytics.reportFor('2026-03-14', 'month');
    const series = report.metrics['habits.checkIns']?.series ?? [];

    expect(series).toHaveLength(31);
    expect(series[0]?.value).toBe(1);
    expect(series[1]?.value).toBe(1);
    // The 5th has no record at all.
    expect(series[4]?.value).toBeNull();
  });

  it('reports finance as integer minor units', async () => {
    await driver.run(
      `INSERT INTO finance_accounts (id, name, currency, created_at, updated_at)
       VALUES ('a1', 'Cash', 'USD', 1, 1);`,
    );
    await driver.run(
      `INSERT INTO finance_categories (id, name, kind, created_at, updated_at)
       VALUES ('c1', 'Food', 'expense', 1, 1);`,
    );
    await driver.run(
      `INSERT INTO finance_transactions (id, account_id, category_id, kind, amount_minor, currency, occurred_at, created_at, updated_at)
       VALUES ('t1', 'a1', 'c1', 'expense', 1250, 'USD', ?, 1, 1);`,
      [at('2026-03-10')],
    );

    const report = await analytics.reportFor('2026-03-14', 'month');
    expect(report.metrics['finance.expensesMinor']?.value).toBe(1250);
    expect(report.metrics['finance.netMinor']?.value).toBe(-1250);
    expect(analytics.formatMetric(report.metrics['finance.expensesMinor']!)).toBe('12.50');
  });

  it('never interprets a number as good or bad', async () => {
    await driver.run(
      `INSERT INTO sleep_logs (id, sleep_date, bedtime, wake_time, duration_min, created_at, updated_at)
       VALUES ('s1', '2026-03-02', 1, 2, 120, 1, 1);`,
    );

    const report = await analytics.reportFor('2026-03-14', 'month');
    const summaries = Object.values(report.metrics).map((m) => m.summary).join(' ').toLowerCase();

    for (const word of ['good', 'bad', 'great', 'poor', 'healthy', 'unhealthy', 'should']) {
      expect(summaries).not.toContain(word);
    }
  });

  it('handles a year period without exceeding the cap', async () => {
    const report = await analytics.reportFor('2026-07-04', 'year');
    expect(report.period.days).toBe(365);
    expect(report.metrics['habits.checkIns']?.series).toHaveLength(365);
  });
});

describe('comparePeriods', () => {
  it('lines each metric up against its predecessor', async () => {
    await seedMonth();

    const comparison = await analytics.comparePeriods('2026-03-14', 'month');
    const habits = comparison.metrics.find((m) => m.key === 'habits.checkIns');

    expect(comparison.period.key).toBe('2026-03');
    expect(comparison.previous.key).toBe('2026-02');
    expect(habits?.current).toBe(3);
    expect(habits?.previous).toBe(0);
  });
});

describe('formatting', () => {
  it('formats minutes past an hour', () => {
    expect(analytics.formatMinutes(45)).toBe('45 min');
    expect(analytics.formatMinutes(60)).toBe('1h');
    expect(analytics.formatMinutes(95)).toBe('1h 35m');
    expect(analytics.formatMinutes(0)).toBe('0 min');
  });

  it('formats litres and money', () => {
    const litres = { key: 'health.waterMl', label: 'x', value: 2500, trend: null, series: [], summary: '' };
    expect(analytics.formatMetric(litres)).toBe('2.5 L');

    const money = { key: 'finance.netMinor', label: 'x', value: -450, trend: null, series: [], summary: '' };
    expect(analytics.formatMetric(money)).toBe('-4.50');
  });
});

describe('PRIMARY_METRIC_KEYS', () => {
  it('names metrics the report actually produces', async () => {
    const report = await analytics.reportFor('2026-03-14', 'month');
    for (const key of analytics.PRIMARY_METRIC_KEYS) {
      expect(report.metrics[key]).toBeDefined();
    }
  });
});
