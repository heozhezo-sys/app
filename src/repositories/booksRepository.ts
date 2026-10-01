/**
 * Book metadata and reading-history persistence.
 *
 * Only metadata lives here. The PDF binary is in app storage, referenced by a
 * documents-relative `file_name`, so a library of a thousand books costs kilobytes of
 * database rather than gigabytes — and a backup can be restored onto another device.
 */

import type { SqlDriver, SqlValue } from '@/database/driver';
import { getDatabase, notify, CHANNELS } from '@/database/database';
import { createId } from '@/utils/id';
import type { RelativePath } from '@/platform/storage/types';

export type BookStatus = 'reading' | 'paused' | 'finished' | 'abandoned';

export interface Book {
  id: string;
  title: string;
  author: string | null;
  /** Documents-relative path. Never absolute, so a backup stays device-portable. */
  fileName: RelativePath;
  originalName: string | null;
  fileSizeBytes: number;
  pageCount: number;
  /** Resume position. An operational pointer, not an aggregate. */
  currentPage: number;
  status: BookStatus;
  summary: string | null;
  addedAt: number;
  lastReadAt: number | null;
  finishedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface BookWithProgress extends Book {
  /** Percentage derived from `current_page` and `page_count`. */
  progressPct: number;
}

export interface ReadingSession {
  id: string;
  bookId: string;
  startedAt: number;
  endedAt: number;
  startPage: number;
  endPage: number;
  createdAt: number;
  updatedAt: number;
}

export interface Bookmark {
  id: string;
  bookId: string;
  page: number;
  label: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Highlight {
  id: string;
  bookId: string;
  page: number;
  quotedText: string;
  colorIndex: number;
  createdAt: number;
  updatedAt: number;
}

export interface BookNote {
  id: string;
  bookId: string;
  page: number | null;
  body: string;
  createdAt: number;
  updatedAt: number;
}

interface BookRow {
  id: string;
  title: string;
  author: string | null;
  file_name: string;
  original_name: string | null;
  file_size_bytes: number;
  page_count: number;
  current_page: number;
  status: BookStatus;
  summary: string | null;
  added_at: number;
  last_read_at: number | null;
  finished_at: number | null;
  created_at: number;
  updated_at: number;
}

function toBook(row: BookRow): Book {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    fileName: row.file_name,
    originalName: row.original_name,
    fileSizeBytes: row.file_size_bytes,
    pageCount: row.page_count,
    currentPage: row.current_page,
    status: row.status,
    summary: row.summary,
    addedAt: row.added_at,
    lastReadAt: row.last_read_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function withProgress(book: Book): BookWithProgress {
  const pct =
    book.pageCount > 0 ? Math.min(100, Math.round((book.currentPage / book.pageCount) * 100)) : 0;
  return { ...book, progressPct: pct };
}

async function driver(): Promise<SqlDriver> {
  return (await getDatabase()).driver;
}

function announce(book: boolean): void {
  if (book) {
    notify(CHANNELS.books);
    notify(CHANNELS.reading);
  }
  notify(CHANNELS.today);
}

/* ------------------------------------------------------------------ books */

export async function listBooks(includeArchived = false): Promise<BookWithProgress[]> {
  const db = await driver();
  const rows = await db.all<BookRow>(
    `SELECT * FROM books
      WHERE deleted_at IS NULL ${includeArchived ? '' : "AND status != 'abandoned'"}
      ORDER BY COALESCE(last_read_at, added_at) DESC;`,
  );
  return rows.map((row) => withProgress(toBook(row)));
}

export async function getBook(id: string): Promise<BookWithProgress | null> {
  const db = await driver();
  const row = await db.first<BookRow>(
    'SELECT * FROM books WHERE id = ? AND deleted_at IS NULL;',
    [id],
  );
  return row ? withProgress(toBook(row)) : null;
}

/** Filenames already used, so the importer can avoid a collision. */
export async function listFileNames(): Promise<Set<string>> {
  const db = await driver();
  const rows = await db.all<{ file_name: string }>(
    'SELECT file_name FROM books WHERE deleted_at IS NULL;',
  );
  return new Set(rows.map((row) => row.file_name.split('/').pop() ?? row.file_name));
}

export async function insertBook(input: {
  title: string;
  author: string | null;
  fileName: RelativePath;
  originalName: string | null;
  fileSizeBytes: number;
  pageCount: number;
  summary: string | null;
}): Promise<BookWithProgress> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO books
       (id, title, author, file_name, original_name, file_size_bytes, page_count,
        current_page, status, summary, added_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'reading', ?, ?, ?, ?);`,
    [
      id,
      input.title,
      input.author,
      input.fileName,
      input.originalName,
      input.fileSizeBytes,
      input.pageCount,
      input.summary,
      now,
      now,
      now,
    ],
  );

  announce(true);
  const created = await getBook(id);
  if (!created) throw new Error(`Book ${id} vanished immediately after insert`);
  return created;
}
export async function updateBook(
  id: string,
  patch: Partial<{
    title: string;
    author: string | null;
    currentPage: number;
    status: BookStatus;
    summary: string | null;
    lastReadAt: number | null;
    finishedAt: number | null;
  }>,
): Promise<BookWithProgress | null> {
  const db = await driver();
  const columns: string[] = [];
  const params: SqlValue[] = [];
  const set = (column: string, value: SqlValue): void => {
    columns.push(`${column} = ?`);
    params.push(value);
  };

  if (patch.title !== undefined) set('title', patch.title);
  if (patch.author !== undefined) set('author', patch.author);
  if (patch.currentPage !== undefined) set('current_page', patch.currentPage);
  if (patch.status !== undefined) set('status', patch.status);
  if (patch.summary !== undefined) set('summary', patch.summary);
  if (patch.lastReadAt !== undefined) set('last_read_at', patch.lastReadAt);
  if (patch.finishedAt !== undefined) set('finished_at', patch.finishedAt);

  if (columns.length === 0) return getBook(id);

  set('updated_at', Date.now());
  params.push(id);

  await db.run(`UPDATE books SET ${columns.join(', ')} WHERE id = ? AND deleted_at IS NULL;`, params);
  announce(true);
  return getBook(id);
}

/**
 * Soft delete, returning the file path so the caller can remove the PDF.
 *
 * Order matters: the row is hidden first, so a crash during file deletion leaves an
 * orphaned file rather than a library entry pointing at nothing.
 */
export async function softDeleteBook(id: string): Promise<RelativePath | null> {
  const db = await driver();
  const row = await db.first<{ file_name: string }>(
    'SELECT file_name FROM books WHERE id = ? AND deleted_at IS NULL;',
    [id],
  );
  const now = Date.now();
  await db.run(
    'UPDATE books SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL;',
    [now, now, id],
  );
  announce(true);
  return row?.file_name ?? null;
}

/** Renames the stored file reference, after the file itself has been moved. */
export async function renameBookFile(id: string, fileName: RelativePath): Promise<void> {
  const db = await driver();
  await db.run('UPDATE books SET file_name = ?, updated_at = ? WHERE id = ?;', [
    fileName,
    Date.now(),
    id,
  ]);
  announce(true);
}

/* ------------------------------------------------------- reading history */

interface SessionRow {
  id: string;
  book_id: string;
  started_at: number;
  ended_at: number;
  start_page: number;
  end_page: number;
  created_at: number;
  updated_at: number;
}

export async function insertReadingSession(input: {
  bookId: string;
  startedAt: number;
  endedAt: number;
  startPage: number;
  endPage: number;
}): Promise<ReadingSession> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO reading_sessions
       (id, book_id, started_at, ended_at, start_page, end_page, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    [id, input.bookId, input.startedAt, input.endedAt, input.startPage, input.endPage, now, now],
  );

  const row = await db.first<SessionRow>('SELECT * FROM reading_sessions WHERE id = ?;', [id]);
  if (!row) throw new Error(`Reading session ${id} vanished immediately after insert`);
  return {
    id: row.id,
    bookId: row.book_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    startPage: row.start_page,
    endPage: row.end_page,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listReadingSessions(bookId: string): Promise<ReadingSession[]> {
  const db = await driver();
  const rows = await db.all<SessionRow>(
    'SELECT * FROM reading_sessions WHERE book_id = ? ORDER BY started_at DESC;',
    [bookId],
  );
  return rows.map((row) => ({
    id: row.id,
    bookId: row.book_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    startPage: row.start_page,
    endPage: row.end_page,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/** Total reading time and pages covered, derived from history. */
export async function readingTotals(bookId: string): Promise<{ seconds: number; pages: number }> {
  const db = await driver();
  const rows = await db.all<{ started_at: number; ended_at: number; start_page: number; end_page: number }>(
    'SELECT started_at, ended_at, start_page, end_page FROM reading_sessions WHERE book_id = ?;',
    [bookId],
  );
  return rows.reduce(
    (acc, row) => ({
      seconds: acc.seconds + Math.max(0, Math.round((row.ended_at - row.started_at) / 1000)),
      pages: acc.pages + Math.max(0, row.end_page - row.start_page),
    }),
    { seconds: 0, pages: 0 },
  );
}

/* ------------------------------------------- bookmarks, highlights, notes */

interface BookmarkRow {
  id: string;
  book_id: string;
  page: number;
  label: string | null;
  created_at: number;
  updated_at: number;
}

export async function listBookmarks(bookId: string): Promise<Bookmark[]> {
  const db = await driver();
  const rows = await db.all<BookmarkRow>(
    `SELECT * FROM bookmarks
      WHERE book_id = ? AND deleted_at IS NULL
      ORDER BY page ASC, created_at ASC;`,
    [bookId],
  );
  return rows.map((row) => ({
    id: row.id,
    bookId: row.book_id,
    page: row.page,
    label: row.label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Bookmarks a page.
 *
 * A partial UNIQUE index on `(book_id, page)` means re-bookmarking a page updates the
 * existing row rather than failing or accumulating duplicates.
 */
export async function setBookmark(bookId: string, page: number, label: string | null): Promise<void> {
  const db = await driver();
  const now = Date.now();
  await db.run(
    `INSERT INTO bookmarks (id, book_id, page, label, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (book_id, page) WHERE deleted_at IS NULL
     DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at;`,
    [createId(), bookId, page, label, now, now],
  );
  announce(true);
}

export async function removeBookmark(id: string): Promise<void> {
  const db = await driver();
  await db.run('UPDATE bookmarks SET deleted_at = ? WHERE id = ?;', [Date.now(), id]);
  announce(true);
}

interface HighlightRow {
  id: string;
  book_id: string;
  page: number;
  quoted_text: string;
  color_index: number;
  created_at: number;
  updated_at: number;
}

export async function listHighlights(bookId: string): Promise<Highlight[]> {
  const db = await driver();
  const rows = await db.all<HighlightRow>(
    `SELECT * FROM highlights
      WHERE book_id = ? AND deleted_at IS NULL
      ORDER BY page ASC, created_at ASC;`,
    [bookId],
  );
  return rows.map((row) => ({
    id: row.id,
    bookId: row.book_id,
    page: row.page,
    quotedText: row.quoted_text,
    colorIndex: row.color_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function insertHighlight(input: {
  bookId: string;
  page: number;
  quotedText: string;
  colorIndex?: number;
}): Promise<void> {
  const db = await driver();
  const now = Date.now();
  await db.run(
    `INSERT INTO highlights
       (id, book_id, page, quoted_text, color_index, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    [createId(), input.bookId, input.page, input.quotedText, input.colorIndex ?? 0, now, now],
  );
  announce(true);
}

export async function removeHighlight(id: string): Promise<void> {
  const db = await driver();
  await db.run('UPDATE highlights SET deleted_at = ? WHERE id = ?;', [Date.now(), id]);
  announce(true);
}

interface NoteRow {
  id: string;
  book_id: string;
  page: number | null;
  body: string;
  created_at: number;
  updated_at: number;
}

export async function listNotes(bookId: string): Promise<BookNote[]> {
  const db = await driver();
  const rows = await db.all<NoteRow>(
    `SELECT * FROM book_notes
      WHERE book_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC;`,
    [bookId],
  );
  return rows.map((row) => ({
    id: row.id,
    bookId: row.book_id,
    page: row.page,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function insertNote(input: {
  bookId: string;
  page: number | null;
  body: string;
}): Promise<void> {
  const db = await driver();
  const now = Date.now();
  await db.run(
    `INSERT INTO book_notes (id, book_id, page, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?);`,
    [createId(), input.bookId, input.page, input.body, now, now],
  );
  announce(true);
}

export async function updateNote(id: string, body: string): Promise<void> {
  const db = await driver();
  await db.run('UPDATE book_notes SET body = ?, updated_at = ? WHERE id = ?;', [
    body,
    Date.now(),
    id,
  ]);
  announce(true);
}

export async function removeNote(id: string): Promise<void> {
  const db = await driver();
  await db.run('UPDATE book_notes SET deleted_at = ? WHERE id = ?;', [Date.now(), id]);
  announce(true);
}

