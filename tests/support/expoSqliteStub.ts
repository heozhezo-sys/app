/**
 * Stand-in for `expo-sqlite` in the Node test environment.
 *
 * The real module wraps native code and cannot be imported outside a device runtime.
 * No test ever routes SQL through this: repositories receive a real SQLite handle via
 * `__setDatabaseHandleForTests`. If something did try to use it, the throw is loud
 * rather than silently returning empty results.
 */

export class SQLiteDatabase {
  async openDatabaseAsync(): Promise<SQLiteDatabase> {
    throw new Error('expo-sqlite stub: install a test driver before using the database');
  }
}

export async function openDatabaseAsync(): Promise<SQLiteDatabase> {
  throw new Error('expo-sqlite stub: install a test driver before using the database');
}

export type SQLiteBindValue = string | number | null | boolean | Uint8Array;

export interface SQLiteRunResult {
  changes: number;
  lastInsertRowId: number;
}

export interface Transaction {
  executeAsync(sql: string): Promise<void>;
}
