/**
 * Node `node:sqlite` implementation of {@link SqlDriver}, for tests only.
 *
 * This is what makes LifeOS migration tests meaningful: the *same* SQL strings that
 * ship to iOS and Android are executed by a real SQLite engine on every `npm test`.
 * A typo in a migration fails CI, not a user's phone.
 *
 * Never imported by application code.
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  SqlError,
  type SqlDriver,
  type SqlRunResult,
  type SqlValue,
} from '../../src/database/driver';

type Bindable = null | number | bigint | string | Uint8Array;

function toBindable(value: SqlValue): Bindable {
  return value as Bindable;
}

export class NodeSqliteDriver implements SqlDriver {
  private readonly db: DatabaseSync;
  private inTransaction = false;
  private closed = false;

  constructor(filename = ':memory:') {
    this.db = new DatabaseSync(filename);
    // The app enables these per connection; tests must match so constraint behaviour
    // (ON DELETE CASCADE / SET NULL / RESTRICT) is identical.
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = MEMORY;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
  }

  private prepare(sql: string): StatementSync {
    try {
      return this.db.prepare(sql);
    } catch (error) {
      throw new SqlError(`prepare failed: ${sql}`, sql, [], error);
    }
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<SqlRunResult> {
    try {
      const result = this.prepare(sql).run(...params.map(toBindable));
      return {
        changes: Number(result.changes ?? 0),
        lastInsertRowId: Number(result.lastInsertRowid ?? 0),
      };
    } catch (error) {
      throw new SqlError(`run failed: ${sql}`, sql, params, error);
    }
  }

  async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    try {
      return this.prepare(sql).all(...params.map(toBindable)) as T[];
    } catch (error) {
      throw new SqlError(`query failed: ${sql}`, sql, params, error);
    }
  }

  async first<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | null> {
    try {
      const row = this.prepare(sql).get(...params.map(toBindable));
      return (row ?? null) as T | null;
    } catch (error) {
      throw new SqlError(`query failed: ${sql}`, sql, params, error);
    }
  }

  async exec(sql: string): Promise<void> {
    try {
      this.db.exec(sql);
    } catch (error) {
      throw new SqlError('exec failed', sql, [], error);
    }
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inTransaction) {
      throw new SqlError('nested transactions are not supported', '<transaction>', []);
    }
    this.inTransaction = true;
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const result = await fn();
      this.db.exec('COMMIT;');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        /* already unwound */
      }
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

/** Escape hatch for assertions that need raw access (integrity_check, table dumps). */
export function raw(db: DatabaseSync) {
  return db;
}
