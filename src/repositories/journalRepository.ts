/**
 * Journal persistence.
 *
 * **Privacy.** Journal entries are the most private data in the app. They are stored
 * unencrypted in the app sandbox, alongside every other record, and never leave the device.
 * The in-app lock is a UI gate backed by SecureStore; nothing here claims at-rest
 * encryption. `FEATURES/JOURNAL.md` requires that contents are never transmitted
 * silently, which this layer upholds by containing no network call at all.
 *
 * Attachments follow the same pattern as books: the row references a filename and the
 * bytes live in app storage via the `StorageAdapter`, so the database stays small and a
 * backup can be restored onto another device.
 */

import type { SqlDriver, SqlValue } from '@/database/driver';
import { getDatabase, notify, CHANNELS } from '@/database/database';
import { createId } from '@/utils/id';
import type { DateKey } from '@/utils/dates';
import { parseTags } from '@/journal/tags';
import { escapeLike, searchJournal, type SearchOutcome } from '@/journal/search';

export interface JournalEntry {
  id: string;
  entryDate: DateKey;
  title: string | null;
  body: string;
  /** Free-text mood label, e.g. "Calm". */
  mood: string | null;
  /** 1..10, or null when the user did not rate it. */
  moodScore: number | null;
  isFavorite: boolean;
  /** Parsed from the stored JSON column; never a raw string at the boundary. */
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface JournalAttachment {
  id: string;
  entryId: string;
  /** Documents-relative path. The bytes are in app storage. */
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  createdAt: number;
}

/** Longest body accepted, to bound what a single entry can hold. */
export const MAX_BODY_LENGTH = 200_000;
export const MAX_TITLE_LENGTH = 200;
export const MAX_MOOD_LENGTH = 40;

interface EntryRow {
  /** SQLite's implicit rowid, selected by `rowid` in search queries. */
  rowid?: number;
  id: string;
  entry_date: DateKey;
  title: string | null;
  body: string;
  mood: string | null;
  mood_score: number | null;
  is_favorite: number;
  tags: string | null;
  created_at: number;
  updated_at: number;
}

function toEntry(row: EntryRow): JournalEntry {
  return {
    id: row.id,
    entryDate: row.entry_date,
    title: row.title,
    body: row.body,
    mood: row.mood,
    moodScore: row.mood_score,
    isFavorite: row.is_favorite === 1,
    tags: parseTags(row.tags),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function driver(): Promise<SqlDriver> {
  return (await getDatabase()).driver;
}

function announce(): void {
  notify(CHANNELS.journal);
  notify(CHANNELS.today);
}

/* ----------------------------------------------------------------- entries */

export async function insertEntry(input: {
  entryDate: DateKey;
  title: string | null;
  body: string;
  mood: string | null;
  moodScore: number | null;
  isFavorite: boolean;
  /** Already serialised by the caller. */
  tags: string | null;
}): Promise<JournalEntry> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO journal_entries
       (id, entry_date, title, body, mood, mood_score, is_favorite, tags,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.entryDate,
      input.title,
      input.body,
      input.mood,
      input.moodScore,
      input.isFavorite ? 1 : 0,
      input.tags,
      now,
      now,
    ],
  );

  announce();
  const created = await getEntry(id);
  if (!created) throw new Error(`Journal entry ${id} vanished immediately after insert`);
  return created;
}

export async function getEntry(id: string): Promise<JournalEntry | null> {
  const db = await driver();
  const row = await db.first<EntryRow>(
    'SELECT * FROM journal_entries WHERE id = ? AND deleted_at IS NULL;',
    [id],
  );
  return row ? toEntry(row) : null;
}

/**
 * Entries in a date range, newest first.
 *
 * Bounded by default: a journal grows to thousands of entries, and an unbounded read would
 * eventually stutter on a low-end Android device (EDGE-0009).
 */
export async function listEntries(
  options: { from?: DateKey; to?: DateKey; limit?: number } = {},
): Promise<JournalEntry[]> {
  const db = await driver();
  const limit = Math.min(Math.max(1, options.limit ?? 50), 500);

  const rows = await db.all<EntryRow>(
    `SELECT * FROM journal_entries
      WHERE deleted_at IS NULL
        AND (? IS NULL OR entry_date >= ?)
        AND (? IS NULL OR entry_date <= ?)
      ORDER BY entry_date DESC, created_at DESC
      LIMIT ?;`,
    [options.from ?? null, options.from ?? null, options.to ?? null, options.to ?? null, limit],
  );
  return rows.map(toEntry);
}

/** Favourites only, for the favourites filter. */
export async function listFavorites(limit = 50): Promise<JournalEntry[]> {
  const db = await driver();
  const rows = await db.all<EntryRow>(
    `SELECT * FROM journal_entries
      WHERE deleted_at IS NULL AND is_favorite = 1
      ORDER BY entry_date DESC, created_at DESC
      LIMIT ?;`,
    [Math.min(Math.max(1, limit), 500)],
  );
  return rows.map(toEntry);
}
export async function updateEntry(
  id: string,
  patch: Partial<{
    entryDate: DateKey;
    title: string | null;
    body: string;
    mood: string | null;
    moodScore: number | null;
    isFavorite: boolean;
    tags: string | null;
  }>,
): Promise<JournalEntry | null> {
  const db = await driver();
  const columns: string[] = [];
  const params: SqlValue[] = [];

  const set = (column: string, value: SqlValue): void => {
    columns.push(`${column} = ?`);
    params.push(value);
  };

  if (patch.entryDate !== undefined) set('entry_date', patch.entryDate);
  if (patch.title !== undefined) set('title', patch.title);
  if (patch.body !== undefined) set('body', patch.body);
  if (patch.mood !== undefined) set('mood', patch.mood);
  if (patch.moodScore !== undefined) set('mood_score', patch.moodScore);
  if (patch.isFavorite !== undefined) set('is_favorite', patch.isFavorite ? 1 : 0);
  if (patch.tags !== undefined) set('tags', patch.tags);

  if (columns.length === 0) return getEntry(id);

  set('updated_at', Date.now());
  params.push(id);
  await db.run(
    `UPDATE journal_entries SET ${columns.join(', ')} WHERE id = ? AND deleted_at IS NULL;`,
    params,
  );
  announce();
  return getEntry(id);
}

/** Flips the favourite flag without the caller having to know its current value. */
export async function toggleFavorite(id: string): Promise<JournalEntry | null> {
  const db = await driver();
  // A CASE expression rather than read-then-write, so two rapid taps cannot both write the
  // same value and leave the flag stuck.
  await db.run(
    `UPDATE journal_entries
        SET is_favorite = CASE is_favorite WHEN 1 THEN 0 ELSE 1 END, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL;`,
    [Date.now(), id],
  );
  announce();
  return getEntry(id);
}

export async function softDeleteEntry(id: string): Promise<void> {
  const db = await driver();
  await db.run('UPDATE journal_entries SET deleted_at = ? WHERE id = ?;', [Date.now(), id]);
  announce();
}

/**
 * Entries sharing at least one tag with the given entry, newest first.
 *
 * Computed in SQL rather than by reading every entry into memory. It is a small feature
 * and a linear scan is acceptable; it is deliberately not indexed.
 */
export async function listRelated(id: string, limit = 5): Promise<JournalEntry[]> {
  const entry = await getEntry(id);
  if (!entry || entry.tags.length === 0) return [];

  const db = await driver();
  const rows = await db.all<EntryRow>(
    `SELECT * FROM journal_entries
      WHERE deleted_at IS NULL AND id != ?
        AND (${entry.tags.map(() => 'tags LIKE ?').join(' OR ')})
      ORDER BY entry_date DESC
      LIMIT ?;`,
    [id, ...entry.tags.map((tag) => `%"${escapeLike(tag.toLowerCase())}"%`), limit],
  );
  return rows.map(toEntry);
}

/**
 * Searches entries, locally.
 *
 * Delegates the query to `journal/search`, which picks the FTS5 index or the `LIKE`
 * fallback based on what the database build actually supports. Row ids from either path are
 * turned back into whole entries here, so a soft-deleted entry is excluded regardless of
 * which strategy matched it.
 */
export async function searchEntries(
  query: string,
  options: { limit?: number; favouritesOnly?: boolean } = {},
): Promise<SearchOutcome<JournalEntry>> {
  const trimmed = query.trim();
  if (trimmed === '') {
    return { results: await listEntries({ limit: options.limit }), strategy: 'like' };
  }

  const db = await driver();
  const outcome = await searchJournal(db, trimmed, {
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.favouritesOnly !== undefined ? { favouritesOnly: options.favouritesOnly } : {}),
  });

  if (outcome.results.length === 0) return { results: [], strategy: outcome.strategy };

  // `rowid` is listed explicitly. SQLite's rowid is implicit, so `SELECT *` does NOT
  // include it, and a `SELECT *` here returns rows with no rowid to join on.
  const placeholders = outcome.results.map(() => '?').join(', ');
  const rows = await db.all<EntryRow>(
    `SELECT rowid, * FROM journal_entries
      WHERE deleted_at IS NULL AND rowid IN (${placeholders})`,
    outcome.results.map((hit) => hit.rowid),
  );

  // Preserve the search engine's ranking rather than re-sorting by rowid.
  const byRowid = new Map(rows.map((row) => [row.rowid, row]));
  const ordered: EntryRow[] = [];
  for (const hit of outcome.results) {
    const row = byRowid.get(hit.rowid);
    if (row) ordered.push(row);
  }

  const results = ordered.map(toEntry);
  return {
    // FTS5 cannot filter by favourite after the fact, so the filter is applied here when
    // that path was used.
    results: options.favouritesOnly ? results.filter((entry) => entry.isFavorite) : results,
    strategy: outcome.strategy,
  };
}

/* -------------------------------------------------------------- attachments */

interface AttachmentRow {
  id: string;
  entry_id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  created_at: number;
}

function toAttachment(row: AttachmentRow): JournalAttachment {
  return {
    id: row.id,
    entryId: row.entry_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

export async function insertAttachment(input: {
  entryId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
}): Promise<JournalAttachment> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO journal_attachments
       (id, entry_id, file_name, mime_type, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?);`,
    [id, input.entryId, input.fileName, input.mimeType, input.sizeBytes, now],
  );

  announce();
  const created = await getAttachment(id);
  if (!created) throw new Error(`Attachment ${id} vanished immediately after insert`);
  return created;
}

export async function getAttachment(id: string): Promise<JournalAttachment | null> {
  const db = await driver();
  const row = await db.first<AttachmentRow>(
    'SELECT * FROM journal_attachments WHERE id = ? AND deleted_at IS NULL;',
    [id],
  );
  return row ? toAttachment(row) : null;
}

export async function listAttachments(entryId: string): Promise<JournalAttachment[]> {
  const db = await driver();
  const rows = await db.all<AttachmentRow>(
    'SELECT * FROM journal_attachments WHERE entry_id = ? AND deleted_at IS NULL ORDER BY created_at ASC;',
    [entryId],
  );
  return rows.map(toAttachment);
}

/**
 * Removes the row and returns the stored path.
 *
 * The caller deletes the file afterwards, so the row is hidden before the bytes go: a
 * crash in between leaves an orphaned file rather than a row pointing at nothing. Same
 * ordering as book deletion (ADR-0017).
 */
export async function softDeleteAttachment(id: string): Promise<string | null> {
  const db = await driver();
  const row = await db.first<{ file_name: string }>(
    'SELECT file_name FROM journal_attachments WHERE id = ? AND deleted_at IS NULL;',
    [id],
  );
  await db.run('UPDATE journal_attachments SET deleted_at = ? WHERE id = ?;', [Date.now(), id]);
  announce();
  return row?.file_name ?? null;
}

