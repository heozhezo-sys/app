/**
 * Habits end-to-end through service -> repository -> real SQLite.
 *
 * This is the vertical-slice test: it exercises the same code path the app uses,
 * minus the React layer. If this passes, a habit created in the UI is really stored,
 * really validated and really queryable.
 */

import { NodeSqliteDriver } from '../support/nodeSqliteDriver';
import {
  __resetDatabaseHandleForTests,
  __setDatabaseHandleForTests,
} from '@/database/database';
import { runMigrations } from '@/database/migrator';
import { LATEST_SCHEMA_VERSION } from '@/database/migrations/types';
import * as service from '@/services/habitsService';
import { addDays, todayKey } from '@/utils/dates';

let driver: NodeSqliteDriver;

beforeEach(async () => {
  driver = new NodeSqliteDriver();
  await runMigrations(driver);
  __setDatabaseHandleForTests(driver, LATEST_SCHEMA_VERSION);
});

afterEach(async () => {
  __resetDatabaseHandleForTests();
  await driver.close();
});

const FIXED_NOW = new Date(2026, 0, 15, 10, 0, 0, 0); // Thursday 15 Jan 2026
const TODAY = todayKey(FIXED_NOW);

describe('creating habits', () => {
  it('persists a valid habit and reads it back', async () => {
    const habit = await service.createHabit({ title: 'Read 20 minutes' });

    expect(habit.id).toBeTruthy();
    expect(habit.title).toBe('Read 20 minutes');
    expect(habit.status).toBe('active');
    expect(habit.cadence).toBe('daily');

    const forDay = await service.listHabitsForDate(TODAY);
    expect(forDay.map((h) => h.id)).toContain(habit.id);
  });

  it('refuses an empty title with a field-level error', async () => {
    expect.assertions(2);
    try {
      await service.createHabit({ title: '' });
    } catch (error) {
      expect(error).toBeInstanceOf(service.ValidationError);
      expect((error as service.ValidationError).fields.title).toBe('Required');
    }
  });

  it('trims the stored title', async () => {
    const habit = await service.createHabit({ title: '  Stretch  ' });
    expect(habit.title).toBe('Stretch');
  });

  it('rejects a non-positive target', async () => {
    await expect(
      service.createHabit({ title: 'Push-ups', targetPerPeriod: 0 }),
    ).rejects.toBeInstanceOf(service.ValidationError);
  });

  it('requires at least one day for a specific-day cadence', async () => {
    await expect(
      service.createHabit({ title: 'Gym', cadence: 'specific_days', cadenceDays: [] }),
    ).rejects.toBeInstanceOf(service.ValidationError);
  });

  it('rejects an invalid reminder time', async () => {
    await expect(
      service.createHabit({ title: 'Wake up', reminderTime: '99:99' }),
    ).rejects.toBeInstanceOf(service.ValidationError);
  });

  it('appends new habits to the end of the list', async () => {
    const first = await service.createHabit({ title: 'First' });
    const second = await service.createHabit({ title: 'Second' });
    expect(second.sortOrder).toBeGreaterThan(first.sortOrder);
  });
});

describe('completing habits', () => {
  it('toggles on then off', async () => {
    const habit = await service.createHabit({ title: 'Meditate' });

    expect((await service.toggleCompletion(habit.id, TODAY)).completed).toBe(true);
    expect((await service.toggleCompletion(habit.id, TODAY)).completed).toBe(false);
  });

  it('is idempotent under rapid duplicate taps', async () => {
    const habit = await service.createHabit({ title: 'Water' });

    // Five taps landing before any re-read.
    await Promise.all([
      service.setCompletion(habit.id, TODAY, true),
      service.setCompletion(habit.id, TODAY, true),
      service.setCompletion(habit.id, TODAY, true),
      service.setCompletion(habit.id, TODAY, true),
      service.setCompletion(habit.id, TODAY, true),
    ]);

    const logs = await driver.all('SELECT * FROM habit_logs WHERE habit_id = ?;', [habit.id]);
    expect(logs).toHaveLength(1);
  });

  it('records the correct local day, not the UTC day', async () => {
    const habit = await service.createHabit({ title: 'Journal' });
    await service.setCompletion(habit.id, TODAY, true);

    const rows = await driver.all<{ log_date: string }>(
      'SELECT log_date FROM habit_logs WHERE habit_id = ?;',
      [habit.id],
    );
    expect(rows[0]?.log_date).toBe('2026-01-15');
  });

  it('is read from the database, not from cached state', async () => {
    const habit = await service.createHabit({ title: 'Journal' });
    await service.setCompletion(habit.id, TODAY, true);

    // Drop every in-memory handle; the next read must come from storage.
    __resetDatabaseHandleForTests();
    __setDatabaseHandleForTests(driver, LATEST_SCHEMA_VERSION);

    const entry = (await service.listHabitsForDate(TODAY)).find((h) => h.id === habit.id);
    expect(entry?.completedToday).toBe(true);
  });
});

describe('streaks', () => {
  it('counts consecutive scheduled days', async () => {
    const habit = await service.createHabit({ title: 'Stretch' });

    for (let i = 0; i < 5; i += 1) {
      await service.setCompletion(habit.id, addDays(TODAY, -i), true);
    }

    const stats = await service.getStats(habit, FIXED_NOW);
    expect(stats.currentStreak).toBe(5);
  });

  it('breaks the streak on a missed past day', async () => {
    const habit = await service.createHabit({ title: 'Stretch' });

    await service.setCompletion(habit.id, TODAY, true);
    await service.setCompletion(habit.id, addDays(TODAY, -1), true);
    await service.setCompletion(habit.id, addDays(TODAY, -3), true);

    const stats = await service.getStats(habit, FIXED_NOW);
    expect(stats.currentStreak).toBe(2);
  });

  it('is not broken by today still being in progress', async () => {
    const habit = await service.createHabit({ title: 'Stretch' });

    await service.setCompletion(habit.id, addDays(TODAY, -1), true);
    await service.setCompletion(habit.id, addDays(TODAY, -2), true);

    // Today is NOT done; the streak must still read 2, not 0.
    const stats = await service.getStats(habit, FIXED_NOW);
    expect(stats.currentStreak).toBe(2);
  });

  it('recomputes from history when a past entry is corrected', async () => {
    const habit = await service.createHabit({ title: 'Stretch' });

    for (let i = 0; i < 3; i += 1) {
      await service.setCompletion(habit.id, addDays(TODAY, -i), true);
    }
    expect((await service.getStats(habit, FIXED_NOW)).currentStreak).toBe(3);

    // Removing the middle day correctly breaks the streak: today and -2 remain, but
    // they are no longer consecutive. The point is that 3 becomes 1 immediately,
    // which proves the number is derived, not stored.
    await service.setCompletion(habit.id, addDays(TODAY, -1), false);
    expect((await service.getStats(habit, FIXED_NOW)).currentStreak).toBe(1);

    // Re-adding it restores the streak, again purely from history.
    await service.setCompletion(habit.id, addDays(TODAY, -1), true);
    expect((await service.getStats(habit, FIXED_NOW)).currentStreak).toBe(3);
  });

  it('ignores unscheduled days when computing streaks', async () => {
    // Mondays and Wednesdays only. 2026-01-15 is a Thursday, so the habit is not due.
    const habit = await service.createHabit({
      title: 'Swim',
      cadence: 'specific_days',
      cadenceDays: [1, 3],
    });

    await service.setCompletion(habit.id, '2026-01-12', true);
    await service.setCompletion(habit.id, '2026-01-14', true);

    const stats = await service.getStats(habit, FIXED_NOW);
    expect(stats.currentStreak).toBe(2);
  });

  it('hides an unscheduled habit from that day', async () => {
    await service.createHabit({
      title: 'Swim',
      cadence: 'specific_days',
      cadenceDays: [1],
    });

    expect(await service.listHabitsForDate('2026-01-15')).toHaveLength(0);
    expect(await service.listHabitsForDate('2026-01-12')).toHaveLength(1);
  });
});

describe('archiving and deleting', () => {
  it('archives without losing history', async () => {
    const habit = await service.createHabit({ title: 'Old habit' });
    await service.setCompletion(habit.id, TODAY, true);

    await service.archiveHabit(habit.id);

    expect(await service.listHabitsForDate(TODAY)).toHaveLength(0);
    expect((await service.getStats(habit, FIXED_NOW)).totalCompletions).toBe(1);
  });

  it('restores an archived habit back to Today', async () => {
    const habit = await service.createHabit({ title: 'Old habit' });
    await service.archiveHabit(habit.id);
    await service.restoreHabit(habit.id);

    expect(await service.listHabitsForDate(TODAY)).toHaveLength(1);
  });

  it('keeps logs after a soft delete', async () => {
    const habit = await service.createHabit({ title: 'Deleted' });
    await service.setCompletion(habit.id, TODAY, true);

    await service.deleteHabit(habit.id);

    const rows = await driver.all('SELECT * FROM habit_logs WHERE habit_id = ?;', [habit.id]);
    expect(rows).toHaveLength(1);
    expect(await service.listHabitsForDate(TODAY)).toHaveLength(0);
  });
});
