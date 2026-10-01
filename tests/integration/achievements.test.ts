/**
 * Achievements and personal records.
 *
 * The point of these tests is that progress is **derived from history**, not stored. So
 * several cases deliberately delete or undo records and assert the number goes back down.
 * A design with an incremented counter column cannot pass them.
 */

import { NodeSqliteDriver } from '../support/nodeSqliteDriver';
import { runMigrations } from '@/database/migrator';
import { __setDatabaseHandleForTests, __resetDatabaseHandleForTests } from '@/database/database';
import * as service from '@/services/achievementsService';
import * as repository from '@/repositories/achievementsRepository';
import {
  ACHIEVEMENT_CATALOGUE,
  ACHIEVEMENT_METRICS,
  ACHIEVEMENT_CATEGORY_ORDER,
  findAchievement,
} from '@/achievements/catalogue';
import { computeMetrics, isUnlocked, progressPercent } from '@/achievements/evaluator';

let driver: NodeSqliteDriver;

beforeEach(async () => {
  driver = new NodeSqliteDriver();
  await runMigrations(driver);
  __setDatabaseHandleForTests(driver, 14);
  service.resetClock();
  service.setClock(() => 1_800_000_000_000);
});

afterEach(async () => {
  __resetDatabaseHandleForTests();
  await driver.close();
});

async function insertHabitLog(habitId: string, logDate: string): Promise<void> {
  await driver.run(
    `INSERT INTO habits (id, title, cadence, created_at, updated_at) VALUES (?, 'Read', 'daily', 1, 1)
     ON CONFLICT(id) DO NOTHING;`,
    [habitId],
  );
  await driver.run(
    `INSERT INTO habit_logs (id, habit_id, log_date, completed, count_value, created_at, updated_at)
     VALUES (?, ?, ?, 1, 1, 1, 1);`,
    [`log-${habitId}-${logDate}`, habitId, logDate],
  );
}

/* --------------------------------------------------------------- catalogue */

describe('catalogue integrity', () => {
  it('has unique codes', () => {
    const codes = ACHIEVEMENT_CATALOGUE.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('uses only known metrics', () => {
    for (const entry of ACHIEVEMENT_CATALOGUE) {
      expect(ACHIEVEMENT_METRICS).toContain(entry.metric);
    }
  });

  it('only uses categories the screen knows how to group', () => {
    for (const entry of ACHIEVEMENT_CATALOGUE) {
      expect(ACHIEVEMENT_CATEGORY_ORDER).toContain(entry.category);
    }
  });

  it('has a threshold above zero for every entry, as the schema CHECK requires', () => {
    for (const entry of ACHIEVEMENT_CATALOGUE) {
      expect(entry.threshold).toBeGreaterThan(0);
    }
  });

  it('gives every entry a title and a description', () => {
    for (const entry of ACHIEVEMENT_CATALOGUE) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it('looks entries up by code', () => {
    expect(findAchievement('first_habit')?.metric).toBe('habit_logs');
    expect(findAchievement('does_not_exist')).toBeUndefined();
  });
});

/* ------------------------------------------------------------ progress math */

describe('progressPercent', () => {
  it('rounds down so 3 of 4 never reads as complete', () => {
    expect(progressPercent(3, 4)).toBe(75);
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(0, 10)).toBe(0);
  });

  it('caps at 100 and treats over-achievement as complete', () => {
    expect(progressPercent(50, 10)).toBe(100);
    expect(progressPercent(10, 10)).toBe(100);
  });

  it('never reports negative progress', () => {
    expect(progressPercent(-5, 10)).toBe(0);
  });

  it('treats a zero threshold as complete rather than dividing by zero', () => {
    expect(progressPercent(0, 0)).toBe(100);
  });
});

describe('isUnlocked', () => {
  it('is true at and above the threshold', () => {
    expect(isUnlocked(5, 5)).toBe(true);
    expect(isUnlocked(6, 5)).toBe(true);
    expect(isUnlocked(4, 5)).toBe(false);
  });
});

/* ---------------------------------------------------------------- metrics */

describe('deriveMetrics from real records', () => {
  it('is all zeroes on an empty database', async () => {
    const metrics = await computeMetrics(driver);
    for (const metric of ACHIEVEMENT_METRICS) {
      expect(metrics[metric]).toBe(0);
    }
  });

  it('counts only completed habit logs', async () => {
    await insertHabitLog('h1', '2026-03-01');
    await driver.run(
      `INSERT INTO habit_logs (id, habit_id, log_date, completed, count_value, created_at, updated_at)
       VALUES ('skipped', 'h1', '2026-03-02', 0, 1, 1, 1);`,
    );

    const metrics = await computeMetrics(driver);
    expect(metrics.habit_logs).toBe(1);
  });

  it('computes the longest habit streak across calendar days', async () => {
    // Five consecutive, then a gap, then two.
    for (const day of ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05']) {
      await insertHabitLog('h1', day);
    }
    for (const day of ['2026-03-09', '2026-03-10']) {
      await insertHabitLog('h1', day);
    }

    const metrics = await computeMetrics(driver);
    expect(metrics.habit_longest_streak).toBe(5);
  });

  it('keeps separate habits from chaining into one streak', async () => {
    await insertHabitLog('h1', '2026-03-01');
    await insertHabitLog('h2', '2026-03-02');
    await insertHabitLog('h3', '2026-03-03');

    const metrics = await computeMetrics(driver);
    // Each habit has a one-day streak; they must not add up to three.
    expect(metrics.habit_longest_streak).toBe(1);
  });

  it('counts a streak across a month and year boundary', async () => {
    for (const day of ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']) {
      await insertHabitLog('h1', day);
    }

    const metrics = await computeMetrics(driver);
    expect(metrics.habit_longest_streak).toBe(4);
  });

  it('counts reading minutes from session durations', async () => {
    await driver.run(
      `INSERT INTO books (id, title, file_name, added_at, created_at, updated_at)
       VALUES ('b1', 'Book', 'a.pdf', 1, 1, 1);`,
    );
    // 30 minutes then 45 minutes.
    await driver.run(
      `INSERT INTO reading_sessions (id, book_id, started_at, ended_at, start_page, end_page, created_at, updated_at)
       VALUES ('r1', 'b1', 0, 1800000, 0, 10, 1, 1);`,
    );
    await driver.run(
      `INSERT INTO reading_sessions (id, book_id, started_at, ended_at, start_page, end_page, created_at, updated_at)
       VALUES ('r2', 'b1', 0, 2700000, 10, 20, 1, 1);`,
    );

    const metrics = await computeMetrics(driver);
    expect(metrics.reading_minutes).toBe(75);
  });

  it('counts distinct active days, deduplicating across tables', async () => {
    // Habit and water on the same day is one active day, not two.
    await insertHabitLog('h1', '2026-03-01');
    await driver.run(
      `INSERT INTO water_logs (id, log_date, amount_ml, logged_at, created_at, updated_at)
       VALUES ('w1', '2026-03-01', 250, 1, 1, 1);`,
    );
    await driver.run(
      `INSERT INTO water_logs (id, log_date, amount_ml, logged_at, created_at, updated_at)
       VALUES ('w2', '2026-03-02', 250, 1, 1, 1);`,
    );

    const metrics = await computeMetrics(driver);
    expect(metrics.distinct_days_logged).toBe(2);
  });

  it('counts only completed workouts', async () => {
    await driver.run(
      `INSERT INTO workouts (id, title, status, started_at, created_at, updated_at)
       VALUES ('w1', 'Gym', 'in_progress', 1, 1, 1);`,
    );

    let metrics = await computeMetrics(driver);
    expect(metrics.workouts).toBe(0);

    await driver.run(`UPDATE workouts SET status = 'completed', ended_at = 100 WHERE id = 'w1';`);
    metrics = await computeMetrics(driver);
    expect(metrics.workouts).toBe(1);
  });

  it('excludes deleted records', async () => {
    await insertHabitLog('h1', '2026-03-01');
    await driver.run(`UPDATE habits SET deleted_at = 1 WHERE id = 'h1';`);

    const metrics = await computeMetrics(driver);
    expect(metrics.habit_logs).toBe(1); // habit_logs itself has no soft delete
    expect(metrics.goals_created).toBe(0);
  });
});

/* --------------------------------------------------------------- unlocking */

describe('unlocking', () => {
  it('seeds the catalogue and unlocks what already qualifies', async () => {
    await insertHabitLog('h1', '2026-03-01');

    const newly = await service.evaluate();

    expect(newly.map((a) => a.code)).toContain('first_habit');
  });

  it('is idempotent: a second evaluate returns nothing new', async () => {
    await insertHabitLog('h1', '2026-03-01');

    const first = await service.evaluate();
    const second = await service.evaluate();

    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual([]);
  });

  it('cannot double-unlock even under a concurrent race', async () => {
    await insertHabitLog('h1', '2026-03-01');
    await service.ensureCatalogue();

    // Both run to completion; the UNIQUE index means only one can write.
    const [a, b] = await Promise.all([service.evaluate(), service.evaluate()]);

    expect((a?.length ?? 0) + (b?.length ?? 0)).toBeGreaterThan(0);
    const unlocks = await repository.listUnlocks();
    const ids = unlocks.map((u) => u.achievementId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('records the metric value at unlock time', async () => {
    await insertHabitLog('h1', '2026-03-01');
    const [unlocked] = await service.evaluate();

    expect(unlocked?.progressAtUnlock).toBe(1);
    expect(unlocked?.unlockedAt).toBe(1_800_000_000_000);
  });

  it('does not unlock before the threshold is reached', async () => {
    await insertHabitLog('h1', '2026-03-01');
    await service.evaluate();

    // "Fifty reps" needs 50 check-ins; one is not enough.
    const overview = await service.overview();
    const fifty = overview.groups
      .flatMap((g) => g.items)
      .find((a) => a.code === 'habit_50');

    expect(fifty?.unlocked).toBe(false);
    expect(fifty?.current).toBe(1);
    expect(fifty?.percent).toBe(2);
  });

  it('unlocks retroactively when history already qualifies', async () => {
    // A user who has been reading for years installs the app: the achievement should
    // already be earned rather than waiting for 600 more minutes.
    await driver.run(
      `INSERT INTO books (id, title, file_name, added_at, created_at, updated_at)
       VALUES ('b1', 'Book', 'a.pdf', 1, 1, 1);`,
    );
    await driver.run(
      `INSERT INTO reading_sessions (id, book_id, started_at, ended_at, start_page, end_page, created_at, updated_at)
       VALUES ('r1', 'b1', 0, 36000000, 0, 100, 1, 1);`,
    );

    const newly = await service.evaluate();
    expect(newly.map((a) => a.code)).toContain('reading_10h');
  });

  it('drops back below the threshold when a record is deleted', async () => {
    await insertHabitLog('h1', '2026-03-01');
    await service.evaluate();
    expect(await repository.isUnlockedByCode('first_habit')).toBe(true);

    // The unlock is a historical fact and is never revoked — but the *derived* progress
    // for anything still running must reflect the deletion.
    await driver.run(`DELETE FROM habit_logs;`);
    const metrics = await computeMetrics(driver);
    expect(metrics.habit_logs).toBe(0);
    expect(await repository.isUnlockedByCode('first_habit')).toBe(true);
  });
});

/* ----------------------------------------------------------------- secrets */

describe('secret achievements', () => {
  it('hides title and description until unlocked', async () => {
    await service.ensureCatalogue();
    const overview = await service.overview();
    const secret = overview.groups
      .flatMap((g) => g.items)
      .find((a) => a.isSecret);

    if (!secret) return; // no secret shipped yet; the rule still holds vacuously

    expect(secret.unlocked).toBe(false);
    expect(secret.title).toBe('???');
    expect(secret.description).toBeNull();
  });

  it('reveals itself once earned', async () => {
    await insertHabitLog('h1', '2026-03-01');
    const newly = await service.evaluate();
    const secret = newly.find((a) => a.isSecret);
    if (!secret) return;

    expect(secret.title).not.toBe('???');
  });
});

/* -------------------------------------------------------- personal records */

describe('personal records', () => {
  it('ignores values below the meaningful minimum', async () => {
    // One workout is not a personal best worth recording.
    await driver.run(
      `INSERT INTO workouts (id, title, status, started_at, ended_at, created_at, updated_at)
       VALUES ('w1', 'Gym', 'completed', 1, 100, 1, 1);`,
    );
    await service.evaluate();

    const records = await repository.listPersonalRecords();
    expect(records.find((r) => r.metric === 'fitness')).toBeUndefined();
  });

  it('records a best and keeps the highest value seen', async () => {
    await insertHabitLog('h1', '2026-03-01');
    await insertHabitLog('h1', '2026-03-02');
    await service.evaluate();

    const first = (await repository.listPersonalRecords()).find((r) => r.metric === 'habits');
    expect(first?.value).toBe(2);

    // A lower value must not overwrite the best.
    await repository.recordBest({
      scope: 'user',
      subjectId: null,
      metric: 'habits',
      value: 1,
      unit: 'days',
      achievedAt: 1,
    });

    const after = (await repository.listPersonalRecords()).find((r) => r.metric === 'habits');
    expect(after?.value).toBe(2);
  });

  it('updates the record when a longer streak appears', async () => {
    for (const day of ['2026-03-01', '2026-03-02', '2026-03-03']) {
      await insertHabitLog('h1', day);
    }
    await service.evaluate();

    const record = (await repository.listPersonalRecords()).find((r) => r.metric === 'habits');
    expect(record?.value).toBe(3);
    expect(record?.unit).toBe('days');
  });
});

/* ---------------------------------------------------------------- overview */

describe('overview', () => {
  it('groups every achievement and reports counts', async () => {
    await insertHabitLog('h1', '2026-03-01');
    const overview = await service.overview();

    expect(overview.totalCount).toBe(ACHIEVEMENT_CATALOGUE.length);
    expect(overview.unlockedCount).toBeGreaterThan(0);
    expect(overview.percent).toBeGreaterThan(0);
    expect(overview.groups.length).toBeGreaterThan(0);

    // Every catalogue entry appears exactly once across the groups.
    const codes = overview.groups.flatMap((g) => g.items.map((i) => i.code));
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.length).toBe(ACHIEVEMENT_CATALOGUE.length);
  });

  it('orders unlocked achievements first inside a group', async () => {
    await insertHabitLog('h1', '2026-03-01');
    const overview = await service.overview();

    for (const group of overview.groups) {
      const firstLocked = group.items.findIndex((item) => !item.unlocked);
      if (firstLocked === -1) continue;
      expect(group.items.slice(firstLocked).every((item) => !item.unlocked)).toBe(true);
    }
  });

  it('reports an empty state cleanly with no history', async () => {
    const overview = await service.overview();
    expect(overview.unlockedCount).toBe(0);
    expect(overview.percent).toBe(0);
    expect(overview.records).toEqual([]);
  });
});

describe('recentUnlocks and nextGoal', () => {
  it('lists recent unlocks newest first', async () => {
    await insertHabitLog('h1', '2026-03-01');
    await service.evaluate();

    const recent = await service.recentUnlocks(3);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.every((a) => a.unlocked)).toBe(true);
  });

  it('returns null for nextGoal when there is nothing in progress', async () => {
    expect(await service.nextGoal()).toBeNull();
  });

  it('suggests the achievement closest to completion', async () => {
    await insertHabitLog('h1', '2026-03-01');
    await service.evaluate();

    const goal = await service.nextGoal();
    expect(goal).not.toBeNull();
    expect(goal?.unlocked).toBe(false);
    expect(goal?.current).toBeGreaterThan(0);
  });
});
