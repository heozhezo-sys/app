/**
 * Backup and restore.
 *
 * A restore is the only operation in LifeOS that can destroy a user's data, so this
 * module is written defensively and in a fixed order:
 *
 * 1. **Export.** Dump every application table to a versioned JSON document. Files are
 *    referenced, never embedded (`DATA/BACKUP_RESTORE.md`: "Large personal documents are
 *    handled separately to avoid unnecessary duplication").
 * 2. **Validate.** Refuse a document that is not a LifeOS backup, is from a newer app, or
 *    names a table this build does not know. Nothing is written before this passes.
 * 3. **Safety backup.** Take a fresh local backup of the current state *before* touching
 *    anything. A restore the user regrets must be undoable.
 * 4. **Restore, in a transaction.** Replace table contents in dependency order. A failure
 *    mid-way rolls back and leaves the user's data exactly as it was.
 *
 * The restore is a *replace*, not a merge, and the UI says so before doing it. Merging
 * would require deciding which of two conflicting rows wins, which is not a decision this
 * app should make on the user's behalf.
 */

import { CHANNELS, getDatabase, notifyAll } from '@/database/database';
import type { SqlDriver, SqlValue } from '@/database/driver';
import { LATEST_SCHEMA_VERSION } from '@/database/migrations/types';
import { MigrationError } from '@/database/migrator';
import { getInstallId } from '@/repositories/settingsRepository';
import { ensureCatalogue } from '@/services/achievementsService';
import { logger } from '@/utils/logger';
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLE_ORDER,
  EXCLUDED_TABLES,
  MAX_BACKUP_BYTES,
  isDerivedTable,
  validateBackup,
  type BackupDocument,
  type BackupRow,
  type BackupValidation,
} from '@/backup/format';

export type BackupFailureReason =
  | 'not_a_backup'
  | 'from_future_version'
  | 'too_large'
  | 'unreadable'
  | 'write_failed'
  | 'restore_failed';

export interface BackupSuccess {
  ok: true;
  /** JSON text of the document, for writing to a file or sharing. */
  json: string;
  document: BackupDocument;
  /** Rows written across all tables. */
  rowCount: number;
}

export interface BackupFailure {
  ok: false;
  reason: BackupFailureReason;
  /** Written for the user. */
  message: string;
  /** The specific validation problem, when there was one. */
  problem: string | null;
}

export type BackupResult = BackupSuccess | BackupFailure;

export interface RestoreSuccess {
  ok: true;
  rowsRestored: number;
  tablesRestored: number;
  /** Whether the pre-restore safety copy was captured and can be rolled back to. */
  safetyBackupTaken: boolean;
  /** Files referenced by the backup that are not present on this device. */
  missingFiles: string[];
}

export interface RestoreFailure {
  ok: false;
  reason: BackupFailureReason;
  message: string;
  problem: string | null;
}

export type RestoreResult = RestoreSuccess | RestoreFailure;

/** App version reported in the document. Diagnostic only. */
function appVersion(): string | null {
  try {
    // Resolved lazily and defensively: `expo-constants` is available on device but this
    // module is also exercised in a bare Node test process.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require('expo-constants') as { default?: { expoConfig?: { version?: string } } };
    return Constants.default?.expoConfig?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Dumps every application table.
 *
 * Row order is made deterministic with `ORDER BY rowid`, so exporting the same database
 * twice produces byte-identical output. That makes a backup diffable and lets a test
 * assert that an export/restore round trip changed nothing.
 */
export async function exportBackup(): Promise<BackupResult> {
  const { driver } = await getDatabase();

  try {
    const tables: Record<string, BackupRow[]> = {};

    // Read the install id *before* dumping: `getInstallId` lazily writes an `app_meta`
    // row on first call, so dumping first would make the first export differ from every
    // later one purely because of that side effect.
    const installId = await safeInstallId();

    for (const name of BACKUP_TABLE_ORDER) {
      const exists = await driver.first<{ n: number | null }>(
        `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?;`,
        [name],
      );
      // A table absent from this build is skipped rather than failing the export: the
      // backup format lists the union of all tables so an older app can export a database
      // it has just upgraded past. Derived tables are never exported — see FTS_TABLES.
      if (!exists || exists.n === 0) continue;
      if (isDerivedTable(name)) continue;

      const rows = await driver.all<Record<string, SqlValue>>(`SELECT * FROM ${name} ORDER BY rowid;`);
      tables[name] = rows.map(normaliseRow);
    }

    const document: BackupDocument = {
      format: BACKUP_FORMAT_VERSION,
      schemaVersion: await currentSchemaVersion(driver),
      createdAt: Date.now(),
      installId,
      appVersion: appVersion(),
      tables,
      files: await listFileReferences(driver),
    };

    const json = JSON.stringify(document, null, 2);
    const rowCount = Object.values(tables).reduce((sum, rows) => sum + rows.length, 0);

    return { ok: true, json, document, rowCount };
  } catch (error) {
    logger.error('Backup export failed', error);
    return {
      ok: false,
      reason: 'write_failed',
      message: 'Your data could not be exported. Nothing has been changed.',
      problem: null,
    };
  }
}

/**
 * Normalises a row for JSON.
 *
 * `Uint8Array` (a BLOB) has no JSON representation, so it becomes an array of byte
 * values. No table in this schema stores a BLOB today — they are all TEXT and INTEGER —
 * but the conversion keeps a future blob column from producing `[object Object]` in a
 * backup rather than data.
 */
function normaliseRow(row: Record<string, SqlValue>): BackupRow {
  const out: BackupRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Uint8Array) {
      out[key] = Array.from(value);
    } else if (value === undefined) {
      out[key] = null;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * File references, listed but not embedded.
 *
 * Each stored book contributes its path and size so a user can see what a restore will
 * *not* bring back, and so the reader can explain a missing file instead of appearing
 * broken.
 */
async function listFileReferences(
  driver: SqlDriver,
): Promise<BackupDocument['files']> {
  const rows = await driver.all<{
    id: string;
    file_name: string;
    file_size_bytes: number;
  }>('SELECT id, file_name, file_size_bytes FROM books WHERE deleted_at IS NULL;');

  return rows.map((row) => ({
    relativePath: row.file_name,
    sizeBytes: row.file_size_bytes,
    owner: row.id,
  }));
}

async function currentSchemaVersion(driver: SqlDriver): Promise<number> {
  const row = await driver.first<{ user_version: number }>('PRAGMA user_version;');
  return row?.user_version ?? LATEST_SCHEMA_VERSION;
}

async function safeInstallId(): Promise<string | null> {
  try {
    return await getInstallId();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ restore */

/**
 * Restores from a backup.
 *
 * The order below is the safety contract and must not be rearranged:
 * parse -> validate -> safety backup -> transactional replace -> rehydrate derived data.
 */
export async function restoreBackup(json: string): Promise<RestoreResult> {
  if (json.length > MAX_BACKUP_BYTES) {
    return {
      ok: false,
      reason: 'too_large',
      message: 'That backup file is too large to be a LifeOS backup.',
      problem: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      ok: false,
      reason: 'not_a_backup',
      message: "That file isn't a readable LifeOS backup.",
      problem: 'not_json',
    };
  }

  const { driver } = await getDatabase();
  const validation = validateBackup(parsed, await currentSchemaVersion(driver));

  if (!validation.ok || !validation.document) {
    return {
      ok: false,
      reason: validation.problem === 'future_format_version' || validation.problem === 'future_schema_version'
        ? 'from_future_version'
        : 'not_a_backup',
      message: validation.message ?? 'That file is not a valid LifeOS backup.',
      problem: validation.problem,
    };
  }

  const document = validation.document;

  try {
    // ---- 3. Safety backup, before anything is destroyed ---------------------
    // Held in memory for the rest of this session so `undoLastRestore` can put the user
    // back exactly where they were. Deliberately in-memory rather than written to disk:
    // a safety copy of the database sitting in app storage is itself private data, and
    // it is only useful for the minutes after a mistaken restore.
    const safety = await exportBackup();
    if (safety.ok) {
      lastSafetyBackup = safety.json;
    } else {
      // Best effort by design: refusing to restore would be a worse outcome than
      // restoring without an undo. The failure is logged, not silently swallowed.
      logger.warn('Could not take a safety backup before restoring');
      lastSafetyBackup = null;
    }

    // ---- 4. Replace contents inside one transaction -------------------------
    const { rowsRestored, tablesRestored } = await replaceAllTables(driver, document);

    logger.info(`Restored ${rowsRestored} rows across ${tablesRestored} tables`);

    // Anything derived from history is rebuilt rather than trusted from the backup, so
    // unlocks cannot disagree with the records that justify them.
    await ensureCatalogue();

    // Every channel, not a curated list. A restore replaces *all* data, and any screen
    // still showing pre-restore rows would be displaying records that no longer exist.
    // The connection stays open — only the subscribers are told to re-read.
    notifyAll(Object.values(CHANNELS));

    return {
      ok: true,
      rowsRestored,
      tablesRestored,
      safetyBackupTaken: safety.ok,
      missingFiles: [],
    };
  } catch (error) {
    if (error instanceof MigrationError) {
      return {
        ok: false,
        reason: 'restore_failed',
        message:
          'The backup could not be applied because it does not match this version of LifeOS. Your existing data is unchanged.',
        problem: error.code,
      };
    }

    logger.error('Restore failed', error);
    return {
      ok: false,
      reason: 'restore_failed',
      message: 'The backup could not be restored. Your existing data is unchanged.',
      problem: null,
    };
  }
}

/**
 * Replaces every table's contents with the document's rows.
 *
 * Runs inside a single transaction so a constraint violation halfway through cannot
 * leave the user with half a backup applied. `PRAGMA foreign_keys` cannot be changed
 * inside a transaction, so the deletes go in child-to-parent order and the deferred
 * foreign key check is what enforces referential integrity.
 */
async function replaceAllTables(
  driver: SqlDriver,
  document: BackupDocument,
): Promise<{ rowsRestored: number; tablesRestored: number }> {
  let rowsRestored = 0;
  let tablesRestored = 0;

  await driver.transaction(async () => {
    // Delete in reverse dependency order: children first, so RESTRICT constraints on
    // history (e.g. `finance_transactions -> finance_accounts`) do not block the wipe.
    // Derived tables are wiped too when they exist, because their triggers repopulate
    // them from the base tables as rows are re-inserted.
    for (const name of [...BACKUP_TABLE_ORDER].reverse()) {
      await driver.run(`DELETE FROM ${name};`);
    }

    // Insert in dependency order so every foreign key target already exists.
    for (const name of BACKUP_TABLE_ORDER) {
      const rows = document.tables[name];
      if (!rows || rows.length === 0) continue;

      for (const row of rows) {
        await insertRow(driver, name, row);
        rowsRestored += 1;
      }
      tablesRestored += 1;
    }
  });

  return { rowsRestored, tablesRestored };
}

/**
 * Inserts one row, building the statement from the row's own keys.
 *
 * Column names come from the backup document, which is untrusted input. They are
 * therefore validated against a strict identifier pattern and rejected outright rather
 * than interpolated, so a crafted backup cannot inject SQL through a column name.
 * *Values* are always bound.
 */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function insertRow(driver: SqlDriver, table: string, row: BackupRow): Promise<void> {
  const columns = Object.keys(row);
  if (columns.length === 0) return;

  for (const column of columns) {
    if (!SAFE_IDENTIFIER.test(column)) {
      throw new Error(`Refusing to restore column name "${column}" in table ${table}`);
    }
  }

  if (!SAFE_IDENTIFIER.test(table)) {
    throw new Error(`Refusing to restore table name "${table}"`);
  }

  const placeholders = columns.map(() => '?').join(', ');
  const values: SqlValue[] = columns.map((column) => {
    const value = row[column];
    // A JSON array from a normalised BLOB comes back as plain numbers.
    if (Array.isArray(value)) return Uint8Array.from(value);
    // `undefined` cannot be bound; a column absent from the row means "use the default",
    // and the row was validated to be an object, so null is the safe stand-in.
    if (value === undefined) return null;
    return value;
  });

  await driver.run(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders});`,
    values,
  );
}

/* -------------------------------------------------------------- undo */

/**
 * The pre-restore state, captured by the most recent {@link restoreBackup}.
 *
 * Module-level rather than passed around because the only consumer is the settings
 * screen immediately after a restore, and threading a rollback token through the UI would
 * be more machinery than the feature warrants. It holds at most one document and is
 * cleared as soon as it is used or superseded.
 */
let lastSafetyBackup: string | null = null;

/** True when a restore can be undone in this session. */
export function canUndoRestore(): boolean {
  return lastSafetyBackup !== null;
}

/**
 * Test-only: drops the in-memory rollback point.
 *
 * Production code never calls this. It exists because the slot is module state, and
 * without a reset one test's restore would leave an undo available to the next.
 */
export function __resetSafetyBackupForTests(): void {
  lastSafetyBackup = null;
}

/**
 * Puts back the data that was there before the last restore.
 *
 * Returns a failure rather than throwing when there is nothing to undo, so the UI can
 * simply disable the button instead of handling an exception.
 */
export async function undoLastRestore(): Promise<RestoreResult> {
  const snapshot = lastSafetyBackup;
  if (!snapshot) {
    return {
      ok: false,
      reason: 'not_a_backup',
      message: 'There is nothing to undo.',
      problem: null,
    };
  }

  // Take a copy of the *current* (post-restore) state and put it in the undo slot before
  // writing anything, so calling undo twice returns to where the first undo started.
  // The slot is cleared and refilled deliberately: leaving it pointing at `snapshot`
  // would mean the second undo re-applied the very state just rolled back.
  const current = await exportBackup();
  lastSafetyBackup = current.ok ? current.json : null;

  return restoreFromSnapshot(snapshot);
}

/**
 * Applies a snapshot without touching the undo slot.
 *
 * Split out from `restoreBackup` so `undoLastRestore` can apply one without overwriting
 * the rollback target it is itself reading from.
 */
async function restoreFromSnapshot(json: string): Promise<RestoreResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      ok: false,
      reason: 'unreadable',
      message: 'The saved copy could not be read.',
      problem: null,
    };
  }

  const { driver } = await getDatabase();
  const validation = validateBackup(parsed, await currentSchemaVersion(driver));
  if (!validation.ok || !validation.document) {
    return {
      ok: false,
      reason: 'not_a_backup',
      message: 'The saved copy could not be restored.',
      problem: validation.problem,
    };
  }

  try {
    const { rowsRestored, tablesRestored } = await replaceAllTables(driver, validation.document);
    await ensureCatalogue();
    notifyAll(Object.values(CHANNELS));
    return {
      ok: true,
      rowsRestored,
      tablesRestored,
      safetyBackupTaken: true,
      missingFiles: [],
    };
  } catch (error) {
    logger.error('Undo of restore failed', error);
    return {
      ok: false,
      reason: 'restore_failed',
      message: 'The previous data could not be put back.',
      problem: null,
    };
  }
}

/* -------------------------------------------------------------- inspection */

export interface BackupSummary {
  createdAt: number;
  schemaVersion: number;
  rowCount: number;
  fileCount: number;
  fileBytes: number;
  tables: { name: string; rows: number }[];
}

/** Inspects a backup without restoring it, for the confirmation step. */
export function summarise(json: string): BackupSummary | null {
  try {
    const validation = validateBackup(JSON.parse(json), LATEST_SCHEMA_VERSION);
    if (!validation.ok || !validation.document) return null;
    const document = validation.document;

    return {
      createdAt: document.createdAt,
      schemaVersion: document.schemaVersion,
      rowCount: Object.values(document.tables).reduce((sum, rows) => sum + rows.length, 0),
      fileCount: document.files.length,
      fileBytes: document.files.reduce((sum, file) => sum + file.sizeBytes, 0),
      tables: BACKUP_TABLE_ORDER.filter((name) => (document.tables[name]?.length ?? 0) > 0).map(
        (name) => ({ name, rows: document.tables[name]?.length ?? 0 }),
      ),
    };
  } catch {
    return null;
  }
}

/**
 * Which referenced files are absent on this device.
 *
 * Called after a restore so the UI can tell the user that their library metadata is back
 * but the PDFs themselves were not included in the backup.
 */
export async function findMissingFiles(
  document: BackupDocument,
  exists: (relativePath: string) => Promise<boolean>,
): Promise<string[]> {
  const missing: string[] = [];
  for (const file of document.files) {
    if (!(await exists(file.relativePath))) missing.push(file.relativePath);
  }
  return missing;
}

export { EXCLUDED_TABLES, BACKUP_TABLE_ORDER };
export type { BackupValidation };
