/**
 * `expo-sqlite` implementation of {@link SqlDriver}.
 *
 * Responsibilities kept here (and nowhere else):
 *  - connection creation and the pragmas that make SQLite safe for this app;
 *  - translating between `SqlValue` and `SQLiteBindValue`;
 *  - translating driver errors into {@link SqlError}.
 */

import * as SQLite from 'expo-sqlite';

import { SqlError, type SqlDriver, type SqlRunResult, type SqlValue } from './driver';

export const DATABASE_NAME = 'lifeos.db';

/**
 * Pragmas applied to every connection.
 *
 * `journal_mode = WAL`  : concurrent readers during writes; survives app kill
 *                         without losing committed transactions.
 * `foreign_keys = ON`   : required for our ON DELETE rules to be enforced at all.
 * `busy_timeout`        : wait rather than immediately throwing SQLITE_BUSY when a
 *                         migration and a screen read collide.
 */
const CONNECTION_PRAGMAS = [
  'PRAGMA journal_mode = WAL;',
  'PRAGMA foreign_keys = ON;',
  'PRAGMA busy_timeout = 5000;',
  'PRAGMA synchronous = NORMAL;',
];

function normaliseParams(params: readonly SqlValue[]): SQLite.SQLiteBindValue[] {
  return params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p)) as SQLite.SQLiteBindValue[];
}

export class ExpoSqlDriver implements SqlDriver {
  private handle: SQLite.SQLiteDatabase | null = null;
  private closed = false;

  constructor(private readonly databaseName: string = DATABASE_NAME) {}

  private async db(): Promise<SQLite.SQLiteDatabase> {
    if (this.handle) return this.handle;
    const handle = await SQLite.openDatabaseAsync(this.databaseName);
    for (const pragma of CONNECTION_PRAGMAS) {
      await handle.execAsync(pragma);
    }
    this.handle = handle;
    return handle;
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<SqlRunResult> {
    try {
      const handle = await this.db();
      const result = await handle.runAsync(sql, normaliseParams(params));
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowId };
    } catch (error) {
      throw new SqlError(`run failed: ${sql}`, sql, params, error);
    }
  }

  async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    try {
      const handle = await this.db();
      return (await handle.getAllAsync<T>(sql, normaliseParams(params))) as T[];
    } catch (error) {
      throw new SqlError(`query failed: ${sql}`, sql, params, error);
    }
  }

  async first<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | null> {
    try {
      const handle = await this.db();
      return ((await handle.getFirstAsync<T>(sql, normaliseParams(params))) as T | null) ?? null;
    } catch (error) {
      throw new SqlError(`query failed: ${sql}`, sql, params, error);
    }
  }

  async exec(sql: string): Promise<void> {
    try {
      const handle = await this.db();
      await handle.execAsync(sql);
    } catch (error) {
      throw new SqlError('exec failed', sql, [], error);
    }
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const handle = await this.db();
    try {
      // expo-sqlite's transaction helper is typed as `Promise<void>`; capture the
      // result ourselves so callers keep a useful return value.
      let result: T;
      await handle.withExclusiveTransactionAsync(async () => {
        result = await fn();
      });
      return result!;
    } catch (error) {
      throw new SqlError('transaction failed', '<transaction>', [], error);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.handle) {
      await this.handle.closeAsync();
      this.handle = null;
    }
  }
}
