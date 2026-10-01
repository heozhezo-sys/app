/**
 * SQL driver abstraction.
 *
 * LifeOS never talks to a database API directly. Repositories and migrations only
 * see this interface, which lets the identical migration SQL run against
 * `expo-sqlite` on device and against Node 22's built-in `node:sqlite` in tests.
 * That is what makes "migrations are tested" a true statement rather than a hope.
 *
 * Conventions used by every implementation:
 *  - parameters are always bound, never interpolated (SQL-injection safety);
 *  - `run` returns change counts so services can detect no-op writes;
 *  - `transaction` is exclusive and rolls back on any thrown error.
 */

/** Values SQLite can bind. `boolean` is normalised to 0/1 by implementations. */
export type SqlValue = string | number | null | Uint8Array;

export interface SqlRunResult {
  /** Rows inserted/updated/deleted by the statement. */
  changes: number;
  /** Rowid of the last inserted row. */
  lastInsertRowId: number;
}

export interface SqlDriver {
  /** Execute a single statement that returns no rows. */
  run(sql: string, params?: readonly SqlValue[]): Promise<SqlRunResult>;

  /** Execute a query and return every row. */
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;

  /** Execute a query and return the first row, or `null`. */
  first<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;

  /**
   * Execute a script containing any number of statements, with no bindings.
   * Used exclusively for DDL (migrations, PRAGMA setup).
   */
  exec(sql: string): Promise<void>;

  /** Run `fn` inside an exclusive transaction, committing on resolve. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;

  /** Release the underlying handle. Safe to call more than once. */
  close(): Promise<void>;
}

/** Error raised when SQL fails. Wraps driver-specific error text. */
export class SqlError extends Error {
  constructor(
    message: string,
    readonly sql: string,
    readonly params: readonly SqlValue[],
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SqlError';
  }
}
