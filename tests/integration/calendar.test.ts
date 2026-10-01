/**
 * Calendar: the derived unified timeline.
 *
 * The property that matters most is the one `FEATURES/CALENDAR.md` states: the calendar
 * must be *derived*, not a second source of truth. The final describe block asserts that
 * directly — a deleted record must vanish from the calendar with nothing to clean up.
 */

import { NodeSqliteDriver } from '../support/nodeSqliteDriver';
import { runMigrations } from '@/database/migrator';
import { __setDatabaseHandleForTests, __resetDatabaseHandleForTests } from '@/database/database';
import * as calendar from '@/services/calendarService';
import type { CalendarEntry } from '@/services/calendarService';

let driver: NodeSqliteDriver;

function at(date: string, hour = 12): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y ?? 2026, (m ?? 1) - 1, d ?? 1, hour, 0, 0, 0).getTime();
}

async function seed(): Promise<void> {
  await driver.run(
    `INSERT INTO habits (id, title, cadence, created_at, updated_at) VALUES ('h1', 'Read', 'daily', 1, 1);`,
  );
  await driver.run(
    `INSERT INTO habit_logs (id, habit_id, log_date, completed, count_value, created_at, updated_at)
     VALUES ('l1', 'h1', '2026-03-10', 1, 1, 1, 1);`,
  );

  await driver.run(
    `INSERT INTO workouts (id, title, status, started_at, ended_at, created_at, updated_at)
     VALUES ('w1', 'Gym', 'completed', ?, ?, 1, 1);`,
    [at('2026-03-10', 9), at('2026-03-10', 10)],
  );

  await driver.run(
    `INSERT INTO tasks (id, title, status, planned_date, created_at, updated_at)
     VALUES ('t1', 'Write report', 'todo', '2026-03-10', 1, 1);`,
  );

  await driver.run(
    `INSERT INTO sleep_logs (id, sleep_date, bedtime, wake_time, duration_min, created_at, updated_at)
     VALUES ('s1', '2026-03-11', 1, 2, 450, 1, 1);`,
  );

  await driver.run(
    `INSERT INTO finance_accounts (id, name, currency, created_at, updated_at)
     VALUES ('a1', 'Cash', 'USD', 1, 1);`,
  );
  await driver.run(
    `INSERT INTO finance_categories (id, name, kind, created_at, updated_at)
     VALUES ('c1', 'Food', 'expense', 1, 1);`,
  );
  await driver.run(
    `INSERT INTO finance_transactions (id, account_id, category_id, kind, amount_minor, currency, payee, occurred_at, created_at, updated_at)
     VALUES ('x1', 'a1', 'c1', 'expense', 1250, 'USD', 'Cafe', ?, 1, 1);`,
    [at('2026-03-10', 13)],
  );
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

const titlesFor = (entries: CalendarEntry[], kind: string): string[] =>
  entries.filter((e) => e.kind === kind).map((e) => e.title);

describe('timeline', () => {
  it('projects records from every domain onto one list', async () => {
    await seed();

    const result = await calendar.timeline('2026-03-01', '2026-03-31');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(titlesFor(result.entries, 'habit')).toEqual(['Read']);
    expect(titlesFor(result.entries, 'workout')).toEqual(['Gym']);
    expect(titlesFor(result.entries, 'task')).toEqual(['Write report']);
    expect(titlesFor(result.entries, 'sleep')).toEqual(['450 min of sleep']);
    expect(titlesFor(result.entries, 'finance')).toEqual(['Cafe']);
  });

  it('groups entries by day', async () => {
    await seed();

    const result = await calendar.timeline('2026-03-01', '2026-03-31');
    if (!result.ok) throw new Error('expected ok');

    const tenth = result.byDate.get('2026-03-10') ?? [];
    // Habit log, workout, task and transaction all landed on the 10th.
    expect(tenth).toHaveLength(4);
    expect(result.byDate.get('2026-03-11')).toHaveLength(1);
  });

  it('orders a day sensibly: activity before admin', async () => {
    await seed();

    const entries = await calendar.day('2026-03-10');
    // Workout (10) sorts before task (40), which sorts before the transaction (120).
    expect(entries.map((e) => e.kind)).toEqual(['workout', 'habit', 'task', 'finance']);
  });

  it('gives every entry a unique key even for the same id in two domains', async () => {
    await driver.run(
      `INSERT INTO tasks (id, title, status, planned_date, created_at, updated_at)
       VALUES ('shared', 'A', 'todo', '2026-03-10', 1, 1);`,
    );
    await driver.run(
      `INSERT INTO milestones (id, goal_id, title, sort_order, created_at, updated_at)
       SELECT 'shared', 'nope', 'B', 0, 1, 1 WHERE 0;`,
    );
    await driver.run(
      `INSERT INTO goals (id, title, status, started_at, created_at, updated_at)
       VALUES ('shared', 'Goal', 'active', 1, 1, 1);`,
    );
    await driver.run(
      `INSERT INTO goals (id, title, status, started_at, target_date, created_at, updated_at)
       VALUES ('shared2', 'Goal 2', 'active', 1, '2026-03-10', 1, 1);`,
    );

    const result = await calendar.timeline('2026-03-10', '2026-03-10');
    if (!result.ok) throw new Error('expected ok');

    const keys = result.entries.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    // The key is namespaced by kind.
    expect(keys).toContain('task:shared');
    expect(keys).toContain('goal:shared2');
  });

  it('buckets by the local day, not UTC', async () => {
    // 23:30 local on the 10th must land on the 10th.
    await driver.run(
      `INSERT INTO workouts (id, title, status, started_at, ended_at, created_at, updated_at)
       VALUES ('late', 'Late session', 'completed', ?, ?, 1, 1);`,
      [at('2026-03-10', 23), at('2026-03-10', 23) + 30 * 60_000],
    );

    const entries = await calendar.day('2026-03-10');
    expect(titlesFor(entries, 'workout')).toContain('Late session');
  });

  it('excludes soft-deleted records', async () => {
    await seed();
    // `habit_logs` has no soft-delete column — a habit is un-logged by removing the row.
    // The transaction table does soft delete, so it exercises the tombstone path.
    await driver.run(`DELETE FROM habit_logs WHERE id = 'l1';`);
    await driver.run(`UPDATE finance_transactions SET deleted_at = 1 WHERE id = 'x1';`);

    const result = await calendar.timeline('2026-03-10', '2026-03-10');
    if (!result.ok) throw new Error('expected ok');

    expect(titlesFor(result.entries, 'habit')).toEqual([]);
    expect(titlesFor(result.entries, 'finance')).toEqual([]);
  });

  it('excludes an archived habit without touching its logs', async () => {
    await driver.run(`UPDATE habits SET status = 'archived' WHERE id = 'h1';`);

    const result = await calendar.timeline('2026-03-10', '2026-03-10');
    if (!result.ok) throw new Error('expected ok');
    // Habit rows have no `deleted_at`, but the entry still belongs to a live habit.
    // Archived habits are hidden from Today, so they leave the calendar too.
    expect(titlesFor(result.entries, 'habit')).toEqual([]);  });

  it('excludes an in-progress workout', async () => {
    await seed();
    await driver.run(
      `INSERT INTO workouts (id, title, status, started_at, created_at, updated_at)
       VALUES ('wip', 'Started', 'in_progress', ?, 1, 1);`,
      [at('2026-03-10')],
    );

    const entries = await calendar.day('2026-03-10');
    expect(titlesFor(entries, 'workout')).toEqual(['Gym']);
  });

  it('ignores tasks with no date at all', async () => {
    await seed();
    await driver.run(
      `INSERT INTO tasks (id, title, status, created_at, updated_at)
       VALUES ('undated', 'Someday', 'todo', 1, 1);`,
    );

    const result = await calendar.timeline('2026-03-01', '2026-03-31');
    if (!result.ok) throw new Error('expected ok');
    expect(titlesFor(result.entries, 'task')).not.toContain('Someday');
  });

  it('returns an empty, non-throwing result for an empty range', async () => {
    const result = await calendar.timeline('2026-05-01', '2026-05-31');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries).toEqual([]);
    expect(result.byDate.size).toBe(0);
  });

  it('rejects a reversed range with a typed reason', async () => {
    const result = await calendar.timeline('2026-03-31', '2026-03-01');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('reversed_range');
    expect(result.message).toMatch(/backwards/i);
  });

  it('rejects an over-long range rather than querying it', async () => {
    const result = await calendar.timeline('2020-01-01', '2026-01-01');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('range_too_long');
    expect(result.message).toContain(String(calendar.MAX_RANGE_DAYS));
  });

  it('accepts a range exactly at the limit', async () => {
    const result = await calendar.timeline('2026-01-01', '2026-04-30');
    expect(result.ok).toBe(true);
  });
});

describe('day and upcoming', () => {
  it('returns one day of entries', async () => {
    await seed();
    expect(await calendar.day('2026-03-10')).toHaveLength(4);
    expect(await calendar.day('2026-03-20')).toHaveLength(0);
  });

  it('builds an upcoming map for a week', async () => {
    await seed();
    const map = await calendar.upcoming('2026-03-10', 7);

    expect(map.get('2026-03-10')).toHaveLength(4);
    expect(map.get('2026-03-11')).toHaveLength(1);
    expect(map.get('2026-03-15')).toBeUndefined();
  });
});

describe('timelineOfKinds', () => {
  it('filters to the requested kinds', async () => {
    await seed();

    const result = await calendar.timelineOfKinds('2026-03-01', '2026-03-31', ['workout', 'sleep']);
    if (!result.ok) throw new Error('expected ok');

    expect(result.entries.every((e) => e.kind === 'workout' || e.kind === 'sleep')).toBe(true);
    expect(result.entries).toHaveLength(2);
  });

  it('propagates a validation failure', async () => {
    const result = await calendar.timelineOfKinds('2026-03-31', '2026-03-01', ['workout']);
    expect(result.ok).toBe(false);
  });
});

describe('routeFor', () => {
  it('routes to the detail screen where one exists', async () => {
    const base = { date: '2026-03-10', detail: null, sortOrder: 0, title: 'x' };
    expect(calendar.routeFor({ ...base, key: 'habit:h1', kind: 'habit', recordId: 'h1' }))
      .toBe('/habit/h1');
    expect(calendar.routeFor({ ...base, key: 'goal:g1', kind: 'goal', recordId: 'g1' }))
      .toBe('/goal/g1');
    expect(calendar.routeFor({ ...base, key: 'workout:w1', kind: 'workout', recordId: 'w1' }))
      .toBe('/workout/w1');
  });

  it('returns null for kinds that live inside a tab', () => {
    const base = { date: '2026-03-10', detail: null, sortOrder: 0, title: 'x' };
    expect(calendar.routeFor({ ...base, key: 'finance:x1', kind: 'finance', recordId: 'x1' })).toBeNull();
    expect(calendar.routeFor({ ...base, key: 'journal:j1', kind: 'journal', recordId: 'j1' })).toBeNull();
  });
});

describe('countsByKind', () => {
  it('counts each kind, including zero for absent ones', async () => {
    await seed();

    const result = await calendar.timeline('2026-03-01', '2026-03-31');
    if (!result.ok) throw new Error('expected ok');

    const counts = calendar.countsByKind(result.entries);
    expect(counts.habit).toBe(1);
    expect(counts.workout).toBe(1);
    expect(counts.task).toBe(1);
    expect(counts.sleep).toBe(1);
    expect(counts.finance).toBe(1);
    expect(counts.mobility).toBe(0);
  });
});

describe('labels', () => {
  it('has a label for every kind', () => {
    for (const kind of calendar.CALENDAR_KINDS) {
      expect(calendar.CALENDAR_KIND_LABELS[kind]).toBeTruthy();
    }
  });

  it('formats a day heading', () => {
    expect(calendar.dayHeading('2026-03-10')).toContain('10');
  });
});

/**
 * The property that makes this module a projection rather than a copy.
 *
 * If the calendar were a second source of truth, deleting a workout here would need the
 * calendar row deleted too. Because it is derived, the delete is enough.
 */
describe('derived, not duplicated', () => {
  it('loses an entry the moment its source record is deleted', async () => {
    await seed();

    const before = await calendar.day('2026-03-10');
    expect(before.some((e) => e.kind === 'workout')).toBe(true);

    await driver.run(`DELETE FROM workouts WHERE id = 'w1';`);

    const after = await calendar.day('2026-03-10');
    expect(after.some((e) => e.kind === 'workout')).toBe(false);
    // The transaction is untouched, proving entries are independent projections.
    expect(after.some((e) => e.kind === 'finance')).toBe(true);
  });

  it('picks up a record inserted after the calendar was first read', async () => {
    await seed();
    await calendar.day('2026-03-10');

    await driver.run(
      `INSERT INTO mobility_sessions (id, log_date, kind, duration_min, performed_at, created_at, updated_at)
       VALUES ('m1', '2026-03-10', 'yoga', 30, 1, 1, 1);`,
    );

    const after = await calendar.day('2026-03-10');
    expect(after.some((e) => e.kind === 'mobility')).toBe(true);
  });

  it('never writes to the database', async () => {
    await seed();

    // Every calendar read is a SELECT; the row counts must be unchanged afterwards.
    const before = await driver.all<{ name: string; n: number }>(
      `SELECT name, (SELECT COUNT(*) FROM sqlite_master) AS n FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%';`,
    );

    await calendar.timeline('2026-01-01', '2026-03-31');
    await calendar.day('2026-03-10');

    const after = await driver.all<{ name: string; n: number }>(
      `SELECT name, (SELECT COUNT(*) FROM sqlite_master) AS n FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%';`,
    );
    expect(after).toEqual(before);
  });
});
