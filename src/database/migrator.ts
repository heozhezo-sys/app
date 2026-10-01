import { MIGRATIONS } from './migrations';
import type { Migration } from './migrations/types';
import type { SqlDriver } from './driver';
/** Raised for any condition that must stop the app from using the database. */
export class MigrationError extends Error {
  constructor(
    message: string,
    readonly code: 'FUTURE_SCHEMA' | 'STATEMENT_FAILED' | 'TRANSACTION_FAILED',
    readonly migrationVersion?: number,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

export interface MigrationOutcome {
  version: number;
  name: string;
  statementsExecuted: number;
}

export interface MigrationResult {
  /** Schema version before this run. */
  from: number;
  /** Schema version after this run. */
  to: number;
  applied: MigrationOutcome[];
  /** Optional capabilities actually available on this database build. */
  capabilities: { fts5: boolean };
}

export interface RunMigrationsOptions {
  /**
   * Called once before any migration is applied, with the current version.
   * The app uses this to copy the database file so a failed upgrade is recoverable.
   * A throwing hook aborts the run before any change is made.
   */
  onBeforeMigrate?: (currentVersion: number) => Promise<void>;
  /** Called after each migration commits. */
  onMigrated?: (version: number, migration: Migration) => Promise<void>;
  /**
   * Overrides the migration list. Production code never sets this; tests use it to
   * simulate a future, partial or deliberately broken schema.
   */
  migrations?: readonly Migration[];
  /** Injected in tests. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * SQLite keeps the schema version in `PRAGMA user_version`, which lives in the
 * database header rather than a user table, so it is read and written outside the
 * migration transaction.
 */
async function readUserVersion(driver: SqlDriver): Promise<number> {
  const row = await driver.first<{ user_version: number }>('PRAGMA user_version;');
  const value = row?.user_version;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

async function writeUserVersion(driver: SqlDriver, version: number): Promise<void> {
  await driver.run(`PRAGMA user_version = ${version};`);
}

/**
 * Detects FTS5 without leaving anything behind.
 *
 * The probe creates a virtual table inside a savepoint that is always rolled back, so
 * a database without FTS5 is left untouched.
 */
async function detectFts5(driver: SqlDriver): Promise<boolean> {
  try {
    await driver.exec(
      `SAVEPOINT lifeos_fts_probe;
       CREATE VIRTUAL TABLE temp.lifeos_fts_probe USING fts5(x);
       ROLLBACK TO lifeos_fts_probe;
       RELEASE lifeos_fts_probe;`,
    );
    return true;
  } catch {
    try {
      await driver.exec('ROLLBACK TO lifeos_fts_probe; RELEASE lifeos_fts_probe;');
    } catch {
      /* probe already unwound */
    }
    return false;
  }
}

/**
 * Applies pending migrations in order, each in its own transaction.
 *
 * Guarantees:
 *  - A failure rolls that migration back completely; earlier migrations stay applied.
 *  - `user_version` is only advanced after the transaction commits.
 *  - A database newer than the binary is refused, never downgraded or wiped.
 */
export async function runMigrations(
  driver: SqlDriver,
  options: RunMigrationsOptions = {},
): Promise<MigrationResult> {
  const all = options.migrations ?? MIGRATIONS;
  const latest = all[all.length - 1]?.version ?? 0;
  const from = await readUserVersion(driver);

  if (from > latest) {
    throw new MigrationError(
      `Database schema version ${from} is newer than this app supports (${latest}). ` +
        'The app will not touch the database. Update LifeOS instead of downgrading.',
      'FUTURE_SCHEMA',
      from,
    );
  }

  const pending = all.filter((m) => m.version > from);
  const capabilities = { fts5: false };

  if (pending.length > 0 && options.onBeforeMigrate) {
    await options.onBeforeMigrate(from);
  }

  const applied: MigrationOutcome[] = [];

  for (const migration of pending) {
    const statements = [...migration.statements];
    if (migration.when?.capability === 'fts5') {
      capabilities.fts5 = await detectFts5(driver);
      if (capabilities.fts5) statements.push(...migration.when.statements);
    }

    try {
      await driver.exec('BEGIN IMMEDIATE;');
      for (const statement of statements) {
        try {
          await driver.exec(statement);
        } catch (error) {
          throw new MigrationError(
            `Migration ${migration.version} (${migration.name}) failed on statement: ` +
              `${statement.slice(0, 120)}`,
            'STATEMENT_FAILED',
            migration.version,
            error,
          );
        }
      }
      await driver.exec('COMMIT;');
    } catch (error) {
      try {
        await driver.exec('ROLLBACK;');
      } catch {
        // If SQLite already unwound the transaction there is nothing to undo.
      }
      if (error instanceof MigrationError) throw error;
      throw new MigrationError(
        `Migration ${migration.version} (${migration.name}) was rolled back; the database is unchanged.`,
        'TRANSACTION_FAILED',
        migration.version,
        error,
      );
    }

    // Only now, after a successful commit, does the schema version advance.
    await writeUserVersion(driver, migration.version);
    applied.push({
      version: migration.version,
      name: migration.name,
      statementsExecuted: statements.length,
    });

    if (migration.when?.capability === 'fts5') {
      await persistCapability(driver, 'fts5', capabilities.fts5, options.now?.() ?? Date.now());
    }

    if (options.onMigrated) {
      await options.onMigrated(migration.version, migration);
    }
  }

  return { from, to: latest, applied, capabilities };
}

async function persistCapability(
  driver: SqlDriver,
  name: string,
  enabled: boolean,
  at: number,
): Promise<void> {
  try {
    await driver.run(
      `INSERT INTO search_capabilities (name, enabled, detected_at)
       VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         enabled = excluded.enabled, detected_at = excluded.detected_at;`,
      [name, enabled ? 1 : 0, at],
    );
  } catch {
    // Capability bookkeeping must never be able to fail a completed migration.
  }
}
