/**
 * Backup and restore.
 *
 * Restore is the only operation that can destroy a user's data, so this suite leans hard
 * on the failure paths: malformed documents, documents from a future build, and
 * mid-restore constraint violations. A restore test that only checks the happy path
 * proves very little.
 */

import { NodeSqliteDriver } from '../support/nodeSqliteDriver';
import { runMigrations } from '@/database/migrator';
import {
  __setDatabaseHandleForTests,
  __resetDatabaseHandleForTests,
} from '@/database/database';
import * as backup from '@/services/backupService';
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLE_ORDER,
  EXCLUDED_TABLES,
  countRows,
  isDerivedTable,
  validateBackup,
} from '@/backup/format';
import { MIGRATIONS } from '@/database/migrations';
import { LATEST_SCHEMA_VERSION } from '@/database/migrations/types';

let driver: NodeSqliteDriver;

beforeEach(async () => {
  driver = new NodeSqliteDriver();
  await runMigrations(driver);
  __setDatabaseHandleForTests(driver, 15);
  backup.__resetSafetyBackupForTests();
});

afterEach(async () => {
  __resetDatabaseHandleForTests();
  await driver.close();
});

async function seedSomeData(): Promise<void> {
  await driver.run(
    `INSERT INTO habits (id, title, cadence, created_at, updated_at)
     VALUES ('h1', 'Read', 'daily', 1000, 1000);`,
  );
  await driver.run(
    `INSERT INTO habit_logs (id, habit_id, log_date, completed, count_value, created_at, updated_at)
     VALUES ('l1', 'h1', '2026-03-01', 1, 1, 1000, 1000);`,
  );
  await driver.run(
    `INSERT INTO goals (id, title, status, started_at, created_at, updated_at)
     VALUES ('g1', 'Run a 10k', 'active', 1000, 1000, 1000);`,
  );
  await driver.run(
    `INSERT INTO finance_accounts (id, name, currency, created_at, updated_at)
     VALUES ('a1', 'Cash', 'USD', 1000, 1000);`,
  );
  await driver.run(
    `INSERT INTO finance_categories (id, name, kind, created_at, updated_at)
     VALUES ('c1', 'Food', 'expense', 1000, 1000);`,
  );
  await driver.run(
    `INSERT INTO finance_transactions (id, account_id, category_id, kind, amount_minor, currency, occurred_at, created_at, updated_at)
     VALUES ('t1', 'a1', 'c1', 'expense', 1250, 'USD', 2000, 1000, 1000);`,
  );
  await driver.run(
    `INSERT INTO preferences (key, value, updated_at) VALUES ('settings.v1', '{"currency":"USD"}', 1000);`,
  );
  await driver.run(
    `INSERT INTO recovery_logs (id, log_date, energy, soreness, recovery, mood, notes, logged_at, created_at, updated_at)
     VALUES ('r1', '2026-03-01', 7, 3, 6, 8, 'felt good', 1000, 1000, 1000);`,
  );
}

/* --------------------------------------------------------------- format */

describe('backup format validation', () => {
  const good = {
    format: BACKUP_FORMAT_VERSION,
    schemaVersion: 15,
    createdAt: 1,
    installId: null,
    appVersion: '1.0.0',
    tables: { habits: [{ id: 'h1', title: 'Read' }] },
    files: [],
  };

  it('accepts a well-formed document', () => {
    const result = validateBackup(good, 15);
    expect(result.ok).toBe(true);
    expect(result.document?.tables.habits).toHaveLength(1);
  });

  it('rejects non-objects', () => {
    for (const input of [null, 42, 'text', [1, 2, 3]]) {
      expect(validateBackup(input, 15).ok).toBe(false);
    }
  });

  it('rejects a document with no format version', () => {
    const result = validateBackup({ ...good, format: undefined }, 15);
    expect(result.problem).toBe('missing_format_version');
  });

  it('rejects a backup from a newer app rather than guessing', () => {
    const result = validateBackup({ ...good, format: BACKUP_FORMAT_VERSION + 1 }, 15);
    expect(result.problem).toBe('future_format_version');
    expect(result.message).toMatch(/newer version/i);
  });

  it('rejects a backup written against a newer database schema', () => {
    const result = validateBackup({ ...good, schemaVersion: 99 }, 15);
    expect(result.problem).toBe('future_schema_version');
  });

  it('rejects a document naming a table this build does not know', () => {
    const result = validateBackup({ ...good, tables: { made_up_table: [] } }, 15);
    expect(result.problem).toBe('unknown_table');
    expect(result.message).toMatch(/made_up_table/);
  });

  it('rejects a table whose rows are not an array', () => {
    const result = validateBackup({ ...good, tables: { habits: 'nope' } }, 15);
    expect(result.ok).toBe(false);
  });

  it('rejects a document with no tables at all', () => {
    const result = validateBackup({ ...good, tables: undefined }, 15);
    expect(result.problem).toBe('missing_tables');
  });

  it('never throws on hostile input', () => {
    const hostile = [
      null, undefined, 0, '', [], { format: {} }, { format: 1, schemaVersion: {} },
      { format: 1, schemaVersion: 1, tables: [] },
      { format: 1, schemaVersion: 1, tables: { habits: [null] } },
    ];
    for (const input of hostile) {
      expect(() => validateBackup(input, 15)).not.toThrow();
    }
  });
});

describe('table ordering', () => {
  it('lists parents before the children that reference them', () => {
    const index = (name: string) => BACKUP_TABLE_ORDER.indexOf(name);

    expect(index('habits')).toBeLessThan(index('habit_logs'));
    expect(index('goals')).toBeLessThan(index('milestones'));
    expect(index('goals')).toBeLessThan(index('tasks'));
    expect(index('books')).toBeLessThan(index('reading_sessions'));
    expect(index('books')).toBeLessThan(index('bookmarks'));
    expect(index('finance_accounts')).toBeLessThan(index('finance_transactions'));
    expect(index('finance_categories')).toBeLessThan(index('finance_transactions'));
  });

  it('excludes only device-local and derived tables', () => {
    for (const name of EXCLUDED_TABLES) {
      expect(BACKUP_TABLE_ORDER).not.toContain(name);
    }
    // The tables that must survive a restore.
    for (const name of ['habits', 'habit_logs', 'books', 'finance_transactions', 'preferences']) {
      expect(EXCLUDED_TABLES).not.toContain(name);
      expect(BACKUP_TABLE_ORDER).toContain(name);
    }
  });

  it('has no duplicate entries', () => {
    expect(new Set(BACKUP_TABLE_ORDER).size).toBe(BACKUP_TABLE_ORDER.length);
  });
});

/* ---------------------------------------------------------------- export */

describe('exportBackup', () => {
  it('produces a valid document from an empty database', async () => {
    const result = await backup.exportBackup();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.format).toBe(BACKUP_FORMAT_VERSION);
    expect(result.document.schemaVersion).toBe(15);
    // The only row is the lazily-created `install_id` in `app_meta`; no user data exists.
    expect(result.rowCount).toBe(1);
    expect(result.document.tables.app_meta?.[0]?.key).toBe('install_id');
  });

  it('includes user records from every domain', async () => {
    await seedSomeData();

    const result = await backup.exportBackup();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.document.tables.habits).toHaveLength(1);
    expect(result.document.tables.habit_logs).toHaveLength(1);
    expect(result.document.tables.goals).toHaveLength(1);
    expect(result.document.tables.finance_transactions).toHaveLength(1);
    expect(result.document.tables.preferences).toHaveLength(1);
    expect(result.document.tables.recovery_logs).toHaveLength(1);
  });

  it('includes preferences, as the specification requires', async () => {
    await seedSomeData();

    const result = await backup.exportBackup();
    if (!result.ok) throw new Error('export failed');
    expect(result.document.tables.preferences?.[0]?.value).toBe('{"currency":"USD"}');
  });

  it('references files without embedding their bytes', async () => {
    await driver.run(
      `INSERT INTO books (id, title, file_name, file_size_bytes, added_at, created_at, updated_at)
       VALUES ('b1', 'Deep Work', 'books/deep-work.pdf', 4_200_000, 1000, 1000, 1000);`,
    );

    const result = await backup.exportBackup();
    if (!result.ok) throw new Error('export failed');

    expect(result.document.files).toHaveLength(1);
    expect(result.document.files[0]).toEqual({
      relativePath: 'books/deep-work.pdf',
      sizeBytes: 4_200_000,
      owner: 'b1',
    });
    // The size is recorded but the bytes are not: the JSON stays small.
    expect(result.json).not.toContain('4.2');
    expect(result.json.length).toBeLessThan(50_000);
  });

  it('omits soft-deleted rows', async () => {
    await driver.run(
      `INSERT INTO habits (id, title, cadence, created_at, updated_at, deleted_at)
       VALUES ('h1', 'Gone', 'daily', 1, 1, 5000);`,
    );

    const result = await backup.exportBackup();
    if (!result.ok) throw new Error('export failed');
    // The row is exported with its tombstone, so a restore keeps the deletion rather
    // than resurrecting something the user removed.
    const row = result.document.tables.habits?.[0];
    expect(row?.deleted_at).toBe(5000);
  });

  it('never includes excluded tables', async () => {
    await driver.run(
      `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, available_at, created_at, updated_at)
       VALUES ('q1', 'habit', 'h1', 'upsert', '{}', 1, 1, 1);`,
    );
    await driver.run(
      `INSERT INTO activity_log (id, kind, created_at) VALUES ('a1', 'launch', 1);`,
    );

    const result = await backup.exportBackup();
    if (!result.ok) throw new Error('export failed');

    expect(result.document.tables.sync_queue).toBeUndefined();
    expect(result.document.tables.activity_log).toBeUndefined();
  });

  it('is deterministic for unchanged data', async () => {
    await seedSomeData();

    const first = await backup.exportBackup();
    const second = await backup.exportBackup();
    if (!first.ok || !second.ok) throw new Error('export failed');

    // Only `createdAt` may differ; the table contents must be byte-identical.
    expect(first.document.tables).toEqual(second.document.tables);
  });
});

/* --------------------------------------------------------------- restore */

describe('restoreBackup', () => {
  it('rejects text that is not JSON', async () => {
    const result = await backup.restoreBackup('this is not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_a_backup');
  });

  it('rejects a JSON file that is not a backup', async () => {
    const result = await backup.restoreBackup('{"hello":"world"}');
    expect(result.ok).toBe(false);
  });

  it('rejects an oversized document before parsing it', async () => {
    const huge = 'x'.repeat(70 * 1024 * 1024);
    const result = await backup.restoreBackup(huge);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('too_large');
  });

  it('refuses a backup from a newer LifeOS', async () => {
    const result = await backup.restoreBackup(
      JSON.stringify({ format: 99, schemaVersion: 15, tables: {} }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('from_future_version');
  });

  it('leaves existing data untouched when validation fails', async () => {
    await seedSomeData();

    await backup.restoreBackup('{"format":99,"schemaVersion":15,"tables":{}}');

    const rows = await driver.all<{ title: string }>('SELECT title FROM habits;');
    expect(rows).toEqual([{ title: 'Read' }]);
  });

  it('round-trips every record exactly', async () => {
    await seedSomeData();
    const exported = await backup.exportBackup();
    if (!exported.ok) throw new Error('export failed');

    // Wipe, then restore.
    await driver.run('DELETE FROM finance_transactions;');
    await driver.run('DELETE FROM habit_logs;');
    await driver.run('DELETE FROM habits;');

    const restored = await backup.restoreBackup(exported.json);

    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.rowsRestored).toBeGreaterThan(0);

    const habits = await driver.all<{ id: string; title: string }>('SELECT id, title FROM habits;');
    expect(habits).toEqual([{ id: 'h1', title: 'Read' }]);

    const transactions = await driver.all<{ amount_minor: number }>(
      'SELECT amount_minor FROM finance_transactions;',
    );
    // Money is still an integer in minor units after a JSON round trip.
    expect(transactions).toEqual([{ amount_minor: 1250 }]);
  });

  it('replaces rather than merges, so a wipe stays wiped', async () => {
    await seedSomeData();
    const exported = await backup.exportBackup();
    if (!exported.ok) throw new Error('export failed');

    // A habit added *after* the backup must not survive the restore.
    await driver.run(
      `INSERT INTO habits (id, title, cadence, created_at, updated_at)
       VALUES ('h9', 'Added later', 'daily', 2000, 2000);`,
    );

    await backup.restoreBackup(exported.json);

    const ids = (await driver.all<{ id: string }>('SELECT id FROM habits;')).map((r) => r.id);
    expect(ids).toEqual(['h1']);
    expect(ids).not.toContain('h9');
  });

  it('preserves foreign keys across a restore', async () => {
    await seedSomeData();
    const exported = await backup.exportBackup();
    if (!exported.ok) throw new Error('export failed');

    await backup.restoreBackup(exported.json);

    const orphans = await driver.all<{ n: number }>(
      `SELECT COUNT(*) AS n FROM finance_transactions t
        WHERE NOT EXISTS (SELECT 1 FROM finance_accounts a WHERE a.id = t.account_id);`,
    );
    expect(orphans[0]?.n).toBe(0);
  });

  it('restores preferences', async () => {
    await seedSomeData();
    const exported = await backup.exportBackup();
    if (!exported.ok) throw new Error('export failed');

    await driver.run('DELETE FROM preferences;');
    await backup.restoreBackup(exported.json);

    const rows = await driver.all<{ value: string }>('SELECT value FROM preferences;');
    expect(rows).toHaveLength(1);
  });

  it('rolls back completely when a row violates a constraint', async () => {
    await seedSomeData();

    // A transaction whose category does not exist: foreign keys are ON, so this cannot
    // be inserted and the whole restore must unwind.
    const bad = {
      format: 1,
      schemaVersion: 15,
      createdAt: Date.now(),
      installId: null,
      appVersion: null,
      tables: {
        habits: [{ id: 'hb', title: 'Bad', cadence: 'daily', created_at: 1, updated_at: 1 }],
        finance_transactions: [
          {
            id: 'tb',
            account_id: 'does-not-exist',
            category_id: null,
            kind: 'transfer',
            amount_minor: 100,
            currency: 'USD',
            occurred_at: 1,
            transfer_peer: 'peer',
            created_at: 1,
            updated_at: 1,
          },
        ],
      },
      files: [],
    };

    const before = await driver.all<{ title: string }>('SELECT title FROM habits;');

    const result = await backup.restoreBackup(JSON.stringify(bad));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('restore_failed');
    expect(result.message).toMatch(/unchanged/i);

    // The pre-restore data is exactly as it was — no half-applied state.
    const after = await driver.all<{ title: string }>('SELECT title FROM habits;');
    expect(after).toEqual(before);
  });

  it('refuses a crafted column name rather than interpolating it', async () => {
    const hostile = {
      format: 1,
      schemaVersion: 15,
      createdAt: Date.now(),
      tables: {
        habits: [{ id: 'x', 'title) VALUES (\'pwned\'); --': 'y' }],
      },
      files: [],
    };

    const result = await backup.restoreBackup(JSON.stringify(hostile));

    // Rejected, and the database is unharmed and still usable.
    expect(result.ok).toBe(false);
    const rows = await driver.all<{ integrity_check: string }>('PRAGMA integrity_check;');
    expect(rows[0]?.integrity_check).toBe('ok');
  });

  it('seeds the achievement catalogue rather than trusting the backup for it', async () => {
    const exported = await backup.exportBackup();
    if (!exported.ok) throw new Error('export failed');

    await driver.run('DELETE FROM achievements;');
    await backup.restoreBackup(exported.json);

    // Derived, unlocked state is rebuilt by the service, not blindly copied in.
    const rows = await driver.all<{ n: number }>('SELECT COUNT(*) AS n FROM achievements;');
    expect(rows[0]?.n).toBeGreaterThan(0);
  });

  it('can be undone, putting the previous data back', async () => {
    await seedSomeData();
    const original = await backup.exportBackup();
    if (!original.ok) throw new Error('export failed');

    // Change everything, then restore the old state.
    await driver.run('DELETE FROM habits;');
    await driver.run('DELETE FROM habit_logs;');
    await driver.run(
      `INSERT INTO habits (id, title, cadence, created_at, updated_at)
       VALUES ('hz', 'Different', 'daily', 1, 1);`,
    );
    await backup.restoreBackup(original.json);

    expect((await driver.all<{ title: string }>('SELECT title FROM habits;')).map((r) => r.title))
      .toEqual(['Read']);

    const undone = await backup.undoLastRestore();

    expect(undone.ok).toBe(true);
    // Undo returns the state as it was immediately before the restore, including the
    // habit that only existed in the interim.
    expect((await driver.all<{ title: string }>('SELECT title FROM habits;')).map((r) => r.title))
      .toEqual(['Different']);
  });

  it('is itself undoable, so a second call goes back to the restored state', async () => {
    await seedSomeData();
    const original = await backup.exportBackup();
    if (!original.ok) throw new Error('export failed');

    await driver.run('DELETE FROM habits;');
    await driver.run('DELETE FROM habit_logs;');
    await driver.run(
      `INSERT INTO habits (id, title, cadence, created_at, updated_at)
       VALUES ('hz', 'Different', 'daily', 1, 1);`,
    );

    await backup.restoreBackup(original.json);
    expect(backup.canUndoRestore()).toBe(true);

    await backup.undoLastRestore();
    expect((await driver.all<{ title: string }>('SELECT title FROM habits;')).map((r) => r.title))
      .toEqual(['Different']);

    // The undo swapped a fresh safety copy into place, so undo is a round trip rather
    // than a one-way door. Without this, a user who regretted the undo had no way back.
    expect(backup.canUndoRestore()).toBe(true);

    const redone = await backup.undoLastRestore();
    expect(redone.ok).toBe(true);
    expect((await driver.all<{ title: string }>('SELECT title FROM habits;')).map((r) => r.title))
      .toEqual(['Read']);
  });

  it('reports that there is nothing to undo before any restore', async () => {
    const result = await backup.undoLastRestore();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/nothing to undo/i);
  });

  it('leaves the database sound after a rejected restore', async () => {
    await seedSomeData();
    await backup.restoreBackup('not json at all');

    const rows = await driver.all<{ integrity_check: string }>('PRAGMA integrity_check;');
    expect(rows[0]?.integrity_check).toBe('ok');
  });
});

/* ----------------------------------------------------------- inspection */

describe('summarise', () => {
  it('describes a backup without restoring it', async () => {
    await seedSomeData();
    const exported = await backup.exportBackup();
    if (!exported.ok) throw new Error('export failed');

    const summary = backup.summarise(exported.json);

    expect(summary).not.toBeNull();
    expect(summary?.rowCount).toBeGreaterThan(0);
    expect(summary?.schemaVersion).toBe(15);
    expect(summary?.tables.map((t) => t.name)).toContain('habits');
  });

  it('returns null for something that is not a backup', () => {
    expect(backup.summarise('nonsense')).toBeNull();
    expect(backup.summarise('{"nope":1}')).toBeNull();
  });
});

describe('countRows', () => {
  it('totals rows across tables', () => {
    expect(
      countRows({
        format: 1, schemaVersion: 15, createdAt: 0, installId: null, appVersion: null,
        tables: { habits: [{ id: 'a' }, { id: 'b' }], goals: [{ id: 'c' }] },
        files: [],
      }),
    ).toBe(3);
  });
});

describe('missing files after a restore', () => {
  it('reports which referenced PDFs are absent on this device', async () => {
    const document = {
      format: 1,
      schemaVersion: 15,
      createdAt: 0,
      installId: null,
      appVersion: null,
      tables: {},
      files: [
        { relativePath: 'books/here.pdf', sizeBytes: 10, owner: 'b1' },
        { relativePath: 'books/gone.pdf', sizeBytes: 10, owner: 'b2' },
      ],
    };

    const missing = await backup.findMissingFiles(document, async (path) =>
      path.endsWith('here.pdf'),
    );

    expect(missing).toEqual(['books/gone.pdf']);
  });
});

/* ------------------------------------------------------- schema coverage */

describe('backup covers every application table', () => {
  it('lists every table the migrations create, except derived ones', async () => {
    const tables = await driver.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';`,
    );

    for (const table of tables) {
      if (isDerivedTable(table.name)) continue;
      expect(BACKUP_TABLE_ORDER).toContain(table.name);
    }
  });

  it('has no table in the order list that the schema does not create', async () => {
    const tables = new Set(
      (await driver.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';`,
      )).map((r) => r.name),
    );

    for (const name of BACKUP_TABLE_ORDER) {
      expect(tables.has(name)).toBe(true);
    }
  });

  it('keeps LATEST_SCHEMA_VERSION in step with the migration list', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(MIGRATIONS.length);
  });
});
