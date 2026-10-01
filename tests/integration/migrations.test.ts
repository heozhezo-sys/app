/**
 * Migration runner behaviour.
 *
 * These tests execute the production migration SQL against a real SQLite engine.
 */

import { NodeSqliteDriver } from '../support/nodeSqliteDriver';
import { MIGRATIONS } from '@/database/migrations';
import { LATEST_SCHEMA_VERSION } from '@/database/migrations/types';
import { MigrationError, runMigrations } from '@/database/migrator';

async function userVersion(driver: NodeSqliteDriver): Promise<number> {
  const row = await driver.first<{ user_version: number }>('PRAGMA user_version;');
  return row?.user_version ?? 0;
}

async function tableNames(driver: NodeSqliteDriver): Promise<string[]> {
  const rows = await driver.all<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;`,
  );
  return rows.map((r) => r.name);
}

describe('migration list integrity', () => {
  it('has strictly increasing, gap-free versions starting at 1', () => {
    MIGRATIONS.forEach((m, index) => {
      expect(m.version).toBe(index + 1);
    });
  });

  it('declares a name for every migration', () => {
    for (const m of MIGRATIONS) {
      expect(m.name).toMatch(/^[a-z_]+$/);
      expect(m.statements.length).toBeGreaterThan(0);
    }
  });

  it('has no migration that opts into data loss', () => {
    for (const m of MIGRATIONS) {
      expect(m.allowDataLoss).toBeUndefined();
    }
  });

  it('keeps LATEST_SCHEMA_VERSION in sync with the list', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(MIGRATIONS.length);
  });

  it('contains no destructive statements', () => {
    const forbidden = /\b(DROP\s+TABLE|DROP\s+COLUMN|DELETE\s+FROM|TRUNCATE)\b/i;
    for (const m of MIGRATIONS) {
      for (const statement of m.statements) {
        expect(statement).not.toMatch(forbidden);
      }
      for (const statement of m.when?.statements ?? []) {
        expect(statement).not.toMatch(forbidden);
      }
    }
  });
});

describe('applying migrations to a fresh database', () => {
  it('runs every migration and reaches the latest version', async () => {
    const driver = new NodeSqliteDriver();
    const result = await runMigrations(driver);

    expect(result.from).toBe(0);
    expect(result.to).toBe(LATEST_SCHEMA_VERSION);
    expect(result.applied).toHaveLength(MIGRATIONS.length);
    expect(await userVersion(driver)).toBe(LATEST_SCHEMA_VERSION);

    await driver.close();
  });

  it('creates every table the architecture depends on', async () => {
    const driver = new NodeSqliteDriver();
    await runMigrations(driver);

    const tables = await tableNames(driver);

    for (const expected of [
      'app_meta', 'preferences', 'habits', 'habit_logs', 'goals', 'milestones', 'tasks',
      'workouts', 'workout_sets', 'exercises', 'sports', 'sport_sessions', 'body_metrics',
      'books', 'reading_sessions', 'bookmarks', 'highlights', 'book_notes',
      'focus_sessions', 'reviews', 'water_logs', 'foods', 'nutrition_entries', 'sleep_logs',
      'journal_entries', 'finance_accounts', 'finance_categories', 'finance_transactions',
      'budgets', 'achievements', 'sync_queue',
    ]) {
      expect(tables).toContain(expected);
    }

    await driver.close();
  });

  it('leaves the database structurally sound', async () => {
    const driver = new NodeSqliteDriver();
    await runMigrations(driver);
    const rows = await driver.all<{ integrity_check: string }>('PRAGMA integrity_check;');
    expect(rows[0]?.integrity_check).toBe('ok');
    await driver.close();
  });

  it('is idempotent: a second run changes nothing', async () => {
    const driver = new NodeSqliteDriver();
    await runMigrations(driver);

    const second = await runMigrations(driver);

    expect(second.applied).toHaveLength(0);
    expect(second.from).toBe(LATEST_SCHEMA_VERSION);
    expect(second.to).toBe(LATEST_SCHEMA_VERSION);
    await driver.close();
  });
});

describe('upgrading an existing database', () => {
  it('applies only the migrations that are missing', async () => {
    // Model a genuine partial install: the database stopped at version 3.
    const driver = new NodeSqliteDriver();
    await runMigrations(driver, { migrations: MIGRATIONS.slice(0, 3) });
    expect(await userVersion(driver)).toBe(3);

    const result = await runMigrations(driver);

    expect(result.from).toBe(3);
    expect(result.applied.map((a) => a.version)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(await userVersion(driver)).toBe(LATEST_SCHEMA_VERSION);
    await driver.close();
  });

  it('preserves rows written before the upgrade', async () => {
    const driver = new NodeSqliteDriver();
    await runMigrations(driver, { migrations: MIGRATIONS.slice(0, 3) });

    await driver.run(
      `INSERT INTO habits (id, title, cadence, created_at, updated_at)
       VALUES ('h1', 'Read', 'daily', 1, 1);`,
    );

    await runMigrations(driver);

    const rows = await driver.all<{ title: string }>('SELECT title FROM habits;');
    expect(rows).toEqual([{ title: 'Read' }]);
    await driver.close();
  });

  it('runs the pre-migration hook before touching anything', async () => {
    const driver = new NodeSqliteDriver();
    const order: string[] = [];

    await runMigrations(driver, {
      onBeforeMigrate: async (version) => {
        order.push(`before:${version}`);
      },
      onMigrated: async (version) => {
        order.push(`after:${version}`);
      },
    });

    expect(order[0]).toBe('before:0');
    expect(order[1]).toBe('after:1');
    expect(order.at(-1)).toBe(`after:${LATEST_SCHEMA_VERSION}`);
    await driver.close();
  });

  it('aborts before any change when the pre-migration hook fails', async () => {
    const driver = new NodeSqliteDriver();

    await expect(
      runMigrations(driver, {
        onBeforeMigrate: async () => {
          throw new Error('backup failed: out of space');
        },
      }),
    ).rejects.toThrow('backup failed');

    expect(await userVersion(driver)).toBe(0);
    expect(await tableNames(driver)).toEqual([]);
    await driver.close();
  });
});

describe('refusing to damage the database', () => {
  it('refuses a schema newer than the binary without touching it', async () => {
    const driver = new NodeSqliteDriver();
    await runMigrations(driver);
    await driver.run(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 5};`);

    await expect(runMigrations(driver)).rejects.toMatchObject({ code: 'FUTURE_SCHEMA' });

    // Untouched: still the future version, tables intact.
    expect(await userVersion(driver)).toBe(LATEST_SCHEMA_VERSION + 5);
    expect(await tableNames(driver)).toContain('habits');
    await driver.close();
  });

  it('rolls a failing migration back and leaves the version unchanged', async () => {
    const driver = new NodeSqliteDriver();
    await runMigrations(driver, { migrations: MIGRATIONS.slice(0, 11) });

    // Append a deliberately broken migration to simulate a bad upgrade.
    const broken = {
      version: 12,
      name: 'broken',
      statements: [`CREATE TABLE temp_probe (a);`, `CREATE TABLE oops (`],
    };

    await expect(runMigrations(driver, { migrations: [...MIGRATIONS.slice(0, 11), broken] })).rejects.toBeInstanceOf(
      MigrationError,
    );

    // Version still 11 — the failed migration did not advance it.
    expect(await userVersion(driver)).toBe(11);

    // The failed table must not exist, and the database must still be usable.
    const tables = await tableNames(driver);
    expect(tables).not.toContain('oops');
    const rows = await driver.all<{ integrity_check: string }>('PRAGMA integrity_check;');
    expect(rows[0]?.integrity_check).toBe('ok');
    await driver.close();
  });

  it('rolls back only the failing migration, keeping earlier ones applied', async () => {
    const driver = new NodeSqliteDriver();
    await runMigrations(driver, { migrations: MIGRATIONS.slice(0, 11) });

    await expect(
      runMigrations(driver, {
        migrations: [
          ...MIGRATIONS.slice(0, 11),
          { version: 12, name: 'ok', statements: ['CREATE TABLE good_table (a);'] },
          { version: 13, name: 'broken', statements: ['CREATE TABLE bad_table ('] },
        ],
      }),
    ).rejects.toBeInstanceOf(MigrationError);

    expect(await userVersion(driver)).toBe(12);
    expect(await tableNames(driver)).toContain('good_table');
    expect(await tableNames(driver)).not.toContain('bad_table');
    await driver.close();
  });
});
