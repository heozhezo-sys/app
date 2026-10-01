/**
 * Backup document format.
 *
 * `DATA/BACKUP_RESTORE.md` is the contract:
 *
 *  - "Backups contain database records, preferences and file references."
 *  - "Large personal documents are handled separately to avoid unnecessary duplication."
 *  - "Validate backup version before restore."
 *  - "Create a safety backup before destructive restore."
 *  - "Report success or actionable errors."
 *
 * The third point drives the most of this file. A restore **replaces** the user's local
 * database, which is the single most destructive operation in the app, so the document is
 * versioned, structurally validated, and refused outright on any mismatch rather than
 * being imported on a best-effort basis.
 *
 * The second point is why this is JSON and not a copy of the database file. PDFs are the
 * bulky part of a LifeOS install by a wide margin; a backup that embedded them would be
 * hundreds of megabytes for metadata that is a few hundred kilobytes. Book rows keep a
 * *reference* to the file, and the reader reports honestly when that file is absent after a
 * restore rather than pretending the book is readable.
 */

/**
 * Version of the backup *document* format.
 *
 * Distinct from the schema version on purpose: the document's own shape changes when this
 * changes, and restoring it into a database at a different schema version is a separate
 * question answered separately.
 */
export const BACKUP_FORMAT_VERSION = 1;

/** Oldest document this build can read. Bumped only if a format breaks incompatibly. */
export const MIN_SUPPORTED_BACKUP_VERSION = 1;

/** Refuse absurd documents before parsing them, so a huge file cannot exhaust memory. */
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;

/**
 * Table export order.
 *
 * Restore inserts in this order, so a child row never lands before the parent it
 * references. This is the one list that must be kept correct by hand, and the schema test
 * asserts it covers every application table.
 */
export const BACKUP_TABLE_ORDER: readonly string[] = [
  'app_meta',
  'preferences',
  'exercises',
  'sports',
  'habits',
  'habit_logs',
  'goals',
  'milestones',
  'tasks',
  'workouts',
  'workout_sets',
  'body_metrics',
  'sport_sessions',
  'books',
  'reading_sessions',
  'bookmarks',
  'highlights',
  'book_notes',
  'focus_sessions',
  'reviews',
  'water_logs',
  'foods',
  'nutrition_entries',
  'sleep_logs',
  'journal_entries',
  'journal_attachments',
  'finance_accounts',
  'finance_categories',
  'finance_transactions',
  'budgets',
  'achievements',
  'achievement_unlocks',
  'personal_records',
  'reminders',
  'recovery_logs',
  'mobility_sessions',
  'task_recurrence',
  'recurring_transactions',
];

/**
 * Tables deliberately left out of a backup.
 *
 * Each exclusion is a decision, not an oversight:
 *
 *  - `sync_queue` / `sync_state` — device-local transport bookkeeping. Restoring a stale
 *    outbox would re-push changes the user already reconciled.
 *  - `search_capabilities` — a probe result for the machine doing the restore, not data.
 *  - `activity_log` — an audit trail of this device's history. Copying it would attribute
 *    another device's actions to this one.
 *  - `*_fts*` — FTS5 shadow tables and their triggers, when FTS5 is available. These are
 *    derived indexes; recreating them is the database's job, and writing rows directly
 *    would desynchronise them.
 */
export const EXCLUDED_TABLES: readonly string[] = [
  'sync_queue',
  'sync_state',
  'search_capabilities',
  'activity_log',
];

/**
 * FTS5 tables, which exist only when the capability probe succeeded.
 *
 * `book_search` / `journal_search` are contentless external-content virtual tables, and
 * SQLite creates `<name>_data`, `<name>_idx`, `<name>_docsize` and `<name>_config`
 * shadow tables beside them. All of them are **derived indexes** maintained by triggers:
 * writing their rows directly would leave them inconsistent with the base tables, so a
 * restore correctly leaves them alone and lets the triggers rebuild them.
 */
export const FTS_TABLES: readonly string[] = [
  'book_search',
  'book_search_data',
  'book_search_idx',
  'book_search_docsize',
  'book_search_config',
  'journal_search',
  'journal_search_data',
  'journal_search_idx',
  'journal_search_docsize',
  'journal_search_config',
];

/** True for any table a backup neither exports nor needs to. */
export function isDerivedTable(name: string): boolean {
  return EXCLUDED_TABLES.includes(name) || FTS_TABLES.includes(name);
}

/**
 * A table's rows, as a plain object keyed by column name.
 *
 * `number[]` is present for BLOB columns: a `Uint8Array` has no JSON representation, so
 * normalisation writes it as an array of byte values and `backupService` converts it back
 * on restore.
 */
export type BackupValue = string | number | null | Uint8Array | number[];

export type BackupRow = Record<string, BackupValue>;

/** Reference to a stored file, deliberately without its bytes. */
export interface BackupFileReference {
  /** Path relative to the documents directory, as stored in the database. */
  relativePath: string;
  sizeBytes: number;
  /** Which feature owns it, e.g. a book id. Used to explain a missing file on restore. */
  owner: string;
}

export interface BackupDocument {
  /** Document format version. */
  format: number;
  /** Schema version the rows were written from. */
  schemaVersion: number;
  createdAt: number;
  /** Install id of the exporting device. Diagnostic only; never an identity claim. */
  installId: string | null;
  appVersion: string | null;
  /** Table name -> rows. Order is not significant here; restore uses BACKUP_TABLE_ORDER. */
  tables: Record<string, BackupRow[]>;
  /** Files referenced by the rows, listed but not embedded. */
  files: BackupFileReference[];
}

export type BackupProblem =
  | 'not_json'
  | 'too_large'
  | 'not_an_object'
  | 'missing_format_version'
  | 'future_format_version'
  | 'too_old_format_version'
  | 'missing_schema_version'
  | 'future_schema_version'
  | 'missing_tables'
  | 'unknown_table';

export interface BackupValidation {
  ok: boolean;
  /** Set when `ok` is false. Wording is written for the user, not for a log. */
  problem: BackupProblem | null;
  message: string | null;
  document: BackupDocument | null;
}

/**
 * Structurally validates an untrusted backup document.
 *
 * Everything a restore would choke on is checked here, *before* any write happens. The
 * function is total: it never throws and never partially accepts, because a restore that
 * half-applies is worse than one that refuses.
 *
 * `currentSchemaVersion` gates the "restoring into a database newer than this backup"
 * case: a backup from a future LifeOS may contain columns this build cannot represent,
 * and silently dropping them would quietly discard the user's data.
 */
export function validateBackup(
  raw: unknown,
  currentSchemaVersion: number,
): BackupValidation {
  const reject = (problem: BackupProblem, message: string): BackupValidation => ({
    ok: false,
    problem,
    message,
    document: null,
  });

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return reject('not_an_object', "That file isn't a LifeOS backup.");
  }

  const candidate = raw as Partial<BackupDocument>;

  if (typeof candidate.format !== 'number' || !Number.isInteger(candidate.format)) {
    return reject(
      'missing_format_version',
      'That backup is missing its format version, so it cannot be restored safely.',
    );
  }

  if (candidate.format > BACKUP_FORMAT_VERSION) {
    return reject(
      'future_format_version',
      'That backup came from a newer version of LifeOS. Update the app before restoring it.',
    );
  }

  if (candidate.format < MIN_SUPPORTED_BACKUP_VERSION) {
    return reject(
      'too_old_format_version',
      'That backup is too old for this version of LifeOS to restore.',
    );
  }

  if (
    typeof candidate.schemaVersion !== 'number' ||
    !Number.isInteger(candidate.schemaVersion) ||
    candidate.schemaVersion < 1
  ) {
    return reject(
      'missing_schema_version',
      'That backup does not say which version of the database it came from.',
    );
  }

  if (candidate.schemaVersion > currentSchemaVersion) {
    return reject(
      'future_schema_version',
      `That backup was made with a newer LifeOS (database v${candidate.schemaVersion}). Update the app before restoring it.`,
    );
  }

  if (typeof candidate.tables !== 'object' || candidate.tables === null) {
    return reject('missing_tables', 'That backup does not contain any data.');
  }

  const known = new Set(BACKUP_TABLE_ORDER);
  for (const name of Object.keys(candidate.tables)) {
    if (!known.has(name)) {
      return reject(
        'unknown_table',
        `That backup contains a table this version of LifeOS does not recognise: "${name}".`,
      );
    }
    const rows = candidate.tables[name];
    if (!Array.isArray(rows)) {
      return reject('unknown_table', `That backup has malformed data for "${name}".`);
    }
  }

  const document: BackupDocument = {
    format: candidate.format,
    schemaVersion: candidate.schemaVersion,
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : 0,
    installId: typeof candidate.installId === 'string' ? candidate.installId : null,
    appVersion: typeof candidate.appVersion === 'string' ? candidate.appVersion : null,
    tables: candidate.tables,
    files: Array.isArray(candidate.files) ? candidate.files : [],
  };

  return { ok: true, problem: null, message: null, document };
}

/** Row count across every table, for the "this backup holds N records" line. */
export function countRows(document: BackupDocument): number {
  let total = 0;
  for (const rows of Object.values(document.tables)) total += rows.length;
  return total;
}

/** Tables that carry at least one row, for a pre-restore summary. */
export function populatedTables(document: BackupDocument): { name: string; rows: number }[] {
  return BACKUP_TABLE_ORDER.filter((name) => (document.tables[name]?.length ?? 0) > 0).map(
    (name) => ({ name, rows: document.tables[name]?.length ?? 0 }),
  );
}
