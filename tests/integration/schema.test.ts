/**
 * Schema-level integrity guarantees.
 *
 * The specification requires that important integrity rules are not enforced only in
 * application code. These tests write directly to SQLite, bypassing every repository,
 * to prove the database itself refuses bad data.
 */

import { NodeSqliteDriver } from '../support/nodeSqliteDriver';
import { runMigrations } from '@/database/migrator';

async function freshDb(): Promise<NodeSqliteDriver> {
  const driver = new NodeSqliteDriver();
  await runMigrations(driver);
  return driver;
}

const T0 = 1_700_000_000_000;

async function insertHabit(driver: NodeSqliteDriver, id = 'habit-1'): Promise<void> {
  await driver.run(
    `INSERT INTO habits (id, title, cadence, created_at, updated_at) VALUES (?, 'Read', 'daily', ?, ?);`,
    [id, T0, T0],
  );
}

describe('foreign keys', () => {
  it('is actually enforced on the connection', async () => {
    const driver = await freshDb();
    const row = await driver.first<{ foreign_keys: number }>('PRAGMA foreign_keys;');
    expect(row?.foreign_keys).toBe(1);
    await driver.close();
  });

  it('rejects an orphan habit log', async () => {
    const driver = await freshDb();
    await expect(
      driver.run(
        `INSERT INTO habit_logs (id, habit_id, log_date, created_at, updated_at)
         VALUES ('l1', 'missing-habit', '2026-01-01', ?, ?);`,
        [T0, T0],
      ),
    ).rejects.toThrow();
    await driver.close();
  });

  it('cascades habit logs when a habit is hard-deleted', async () => {
    const driver = await freshDb();
    await insertHabit(driver);
    await driver.run(
      `INSERT INTO habit_logs (id, habit_id, log_date, created_at, updated_at)
       VALUES ('l1', 'habit-1', '2026-01-01', ?, ?);`,
      [T0, T0],
    );

    await driver.run(`DELETE FROM habits WHERE id = 'habit-1';`);

    expect(await driver.all('SELECT * FROM habit_logs;')).toHaveLength(0);
    await driver.close();
  });

  it('detaches tasks from a deleted goal rather than losing them', async () => {
    const driver = await freshDb();
    await driver.run(
      `INSERT INTO goals (id, title, started_at, created_at, updated_at)
       VALUES ('g1', 'Run 10k', ?, ?, ?);`,
      [T0, T0, T0],
    );
    await driver.run(
      `INSERT INTO tasks (id, title, goal_id, created_at, updated_at)
       VALUES ('t1', 'Buy shoes', 'g1', ?, ?);`,
      [T0, T0],
    );

    await driver.run(`DELETE FROM goals WHERE id = 'g1';`);

    const rows = await driver.all<{ goal_id: string | null }>('SELECT goal_id FROM tasks;');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.goal_id).toBeNull();
    await driver.close();
  });

  it('refuses to delete an exercise that has logged sets (RESTRICT)', async () => {
    const driver = await freshDb();
    await driver.run(
      `INSERT INTO exercises (id, name, created_at, updated_at) VALUES ('e1', 'Squat', ?, ?);`,
      [T0, T0],
    );
    await driver.run(
      `INSERT INTO workouts (id, title, status, started_at, ended_at, created_at, updated_at)
       VALUES ('w1', 'Push', 'completed', ?, ?, ?, ?);`,
      [T0, T0 + 3600_000, T0, T0],
    );
    await driver.run(
      `INSERT INTO workout_sets (id, workout_id, exercise_id, set_number, reps, created_at, updated_at)
       VALUES ('s1', 'w1', 'e1', 1, 5, ?, ?);`,
      [T0, T0],
    );

    // The catalog entry must survive while history references it.
    await expect(driver.run(`DELETE FROM exercises WHERE id = 'e1';`)).rejects.toThrow();
    await driver.close();
  });
});

describe('uniqueness guarantees', () => {
  it('makes a duplicate habit completion impossible', async () => {
    const driver = await freshDb();
    await insertHabit(driver);
    await driver.run(
      `INSERT INTO habit_logs (id, habit_id, log_date, created_at, updated_at)
       VALUES ('l1', 'habit-1', '2026-01-01', ?, ?);`,
      [T0, T0],
    );

    await expect(
      driver.run(
        `INSERT INTO habit_logs (id, habit_id, log_date, created_at, updated_at)
         VALUES ('l2', 'habit-1', '2026-01-01', ?, ?);`,
        [T0, T0],
      ),
    ).rejects.toThrow();

    expect(await driver.all('SELECT * FROM habit_logs;')).toHaveLength(1);
    await driver.close();
  });

  it('allows two different habits to be completed on the same day', async () => {
    const driver = await freshDb();
    await insertHabit(driver, 'habit-a');
    await insertHabit(driver, 'habit-b');
    await driver.run(
      `INSERT INTO habit_logs (id, habit_id, log_date, created_at, updated_at)
       VALUES ('l1', 'habit-a', '2026-01-01', ?, ?);`,
      [T0, T0],
    );
    await driver.run(
      `INSERT INTO habit_logs (id, habit_id, log_date, created_at, updated_at)
       VALUES ('l2', 'habit-b', '2026-01-01', ?, ?);`,
      [T0, T0],
    );

    expect(await driver.all('SELECT * FROM habit_logs;')).toHaveLength(2);
    await driver.close();
  });

  it('refuses two books stored at the same file path', async () => {
    const driver = await freshDb();
    await driver.run(
      `INSERT INTO books (id, title, file_name, added_at, created_at, updated_at)
       VALUES ('b1', 'Deep Work', 'a.pdf', ?, ?, ?);`,
      [T0, T0, T0],
    );
    await expect(
      driver.run(
        `INSERT INTO books (id, title, file_name, added_at, created_at, updated_at)
         VALUES ('b2', 'Duplicate', 'a.pdf', ?, ?, ?);`,
        [T0, T0, T0],
      ),
    ).rejects.toThrow();
    await driver.close();
  });

  it('allows only one active focus timer', async () => {
    const driver = await freshDb();
    await driver.run(
      `INSERT INTO focus_sessions (id, status, planned_min, started_at, ends_at, created_at, updated_at)
       VALUES ('f1', 'active', 25, ?, ?, ?, ?);`,
      [T0, T0 + 1000, T0, T0],
    );
    await expect(
      driver.run(
        `INSERT INTO focus_sessions (id, status, planned_min, started_at, ends_at, created_at, updated_at)
         VALUES ('f2', 'active', 25, ?, ?, ?, ?);`,
        [T0, T0 + 1000, T0, T0],
      ),
    ).rejects.toThrow();
    await driver.close();
  });
});

describe('check constraints', () => {
  it('rejects a completed focus session without a completion time', async () => {
    const driver = await freshDb();
    await expect(
      driver.run(
        `INSERT INTO focus_sessions (id, status, planned_min, started_at, ends_at, actual_sec, created_at, updated_at)
         VALUES ('f1', 'completed', 25, ?, ?, 60, ?, ?);`,
        [T0, T0 + 1000, T0, T0],
      ),
    ).rejects.toThrow();
    await driver.close();
  });

  it('rejects a task marked done without a completion timestamp', async () => {
    const driver = await freshDb();
    await expect(
      driver.run(
        `INSERT INTO tasks (id, title, status, created_at, updated_at)
         VALUES ('t1', 'Task', 'done', ?, ?);`,
        [T0, T0],
      ),
    ).rejects.toThrow();
    await driver.close();
  });

  it('rejects an out-of-range RPE', async () => {
    const driver = await freshDb();
    await driver.run(
      `INSERT INTO exercises (id, name, created_at, updated_at) VALUES ('e1', 'Bench', ?, ?);`,
      [T0, T0],
    );
    await driver.run(
      `INSERT INTO workouts (id, title, status, started_at, ended_at, created_at, updated_at)
       VALUES ('w1', 'Push', 'completed', ?, ?, ?, ?);`,
      [T0, T0 + 3600_000, T0, T0],
    );
    await expect(
      driver.run(
        `INSERT INTO workout_sets (id, workout_id, exercise_id, set_number, reps, rpe_x10, created_at, updated_at)
         VALUES ('s1', 'w1', 'e1', 1, 5, 110, ?, ?);`,
        [T0, T0],
      ),
    ).rejects.toThrow();
    await driver.close();
  });

  it('rejects a non-positive money amount', async () => {
    const driver = await freshDb();
    await driver.run(
      `INSERT INTO finance_accounts (id, name, currency, created_at, updated_at)
       VALUES ('a1', 'Cash', 'USD', ?, ?);`,
      [T0, T0],
    );
    await expect(
      driver.run(
        `INSERT INTO finance_transactions (id, account_id, kind, amount_minor, currency, occurred_at, transfer_peer, created_at, updated_at)
         VALUES ('t1', 'a1', 'expense', 0, 'USD', ?, NULL, ?, ?);`,
        [T0, T0, T0],
      ),
    ).rejects.toThrow();
    await driver.close();
  });

  it('rejects a transfer that is not part of a pair', async () => {
    const driver = await freshDb();
    await driver.run(
      `INSERT INTO finance_accounts (id, name, currency, created_at, updated_at)
       VALUES ('a1', 'Cash', 'USD', ?, ?);`,
      [T0, T0],
    );
    await expect(
      driver.run(
        `INSERT INTO finance_transactions (id, account_id, kind, amount_minor, currency, occurred_at, transfer_peer, created_at, updated_at)
         VALUES ('t1', 'a1', 'transfer', 500, 'USD', ?, NULL, ?, ?);`,
        [T0, T0, T0],
      ),
    ).rejects.toThrow();
    await driver.close();
  });

  it('refuses a reading page beyond the end of the document', async () => {
    const driver = await freshDb();
    await expect(
      driver.run(
        `INSERT INTO books (id, title, file_name, page_count, current_page, added_at, created_at, updated_at)
         VALUES ('b1', 'Book', 'a.pdf', 100, 250, ?, ?, ?);`,
        [T0, T0, T0],
      ),
    ).rejects.toThrow();
    await driver.close();
  });

  it('refuses a workout marked complete without an end time', async () => {
    const driver = await freshDb();
    await expect(
      driver.run(
        `INSERT INTO workouts (id, title, status, started_at, created_at, updated_at)
         VALUES ('w1', 'Push', 'completed', ?, ?, ?);`,
        [T0, T0, T0],
      ),
    ).rejects.toThrow();
    await driver.close();
  });
});
