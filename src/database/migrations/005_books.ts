import type { Migration } from './types';

/**
 * 005 — Books and reading.
 *
 * Only PDF *metadata* lives in SQLite. The binary lives in application storage and
 * `file_name` is a path relative to the app's documents directory, so the database can
 * be restored onto a different device without embedding megabytes of PDF data.
 *
 * `reading_sessions` are the historical source of truth for every reading statistic.
 * `books.current_page` is deliberately NOT an aggregate: it is the resume pointer, the
 * position the reader should open at, and is written from the session being recorded.
 */
export const migration005: Migration = {
  version: 5,
  name: 'books',
  statements: [
    `CREATE TABLE books (
       id               TEXT PRIMARY KEY NOT NULL,
       title            TEXT NOT NULL,
       author           TEXT,
       file_name        TEXT NOT NULL,
       original_name    TEXT,
       file_size_bytes  INTEGER NOT NULL DEFAULT 0,
       page_count       INTEGER NOT NULL DEFAULT 0,
       current_page     INTEGER NOT NULL DEFAULT 0,
       status           TEXT NOT NULL DEFAULT 'reading',
       cover_file_name  TEXT,
       summary          TEXT,
       added_at         INTEGER NOT NULL,
       last_read_at     INTEGER,
       finished_at      INTEGER,
       created_at       INTEGER NOT NULL,
       updated_at       INTEGER NOT NULL,
       deleted_at       INTEGER,
       CHECK (status IN ('reading', 'paused', 'finished', 'abandoned')),
       CHECK (file_size_bytes >= 0),
       CHECK (page_count >= 0),
       CHECK (current_page >= 0),
       -- The reader must never be told to open a page outside the document.
       CHECK (page_count = 0 OR current_page <= page_count),
       CHECK (status != 'finished' OR finished_at IS NOT NULL)
     );`,

    `CREATE UNIQUE INDEX idx_books_file_name ON books (file_name) WHERE deleted_at IS NULL;`,
    `CREATE INDEX idx_books_status ON books (status, last_read_at DESC);`,
    `CREATE INDEX idx_books_added ON books (added_at DESC);`,

    `CREATE TABLE reading_sessions (
       id            TEXT PRIMARY KEY NOT NULL,
       book_id       TEXT NOT NULL,
       started_at    INTEGER NOT NULL,
       ended_at      INTEGER NOT NULL,
       start_page    INTEGER NOT NULL,
       end_page      INTEGER NOT NULL,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       CHECK (ended_at >= started_at),
       CHECK (start_page >= 0),
       CHECK (end_page >= start_page),
       FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
     );`,

    `CREATE INDEX idx_reading_sessions_book ON reading_sessions (book_id, started_at DESC);`,
    `CREATE INDEX idx_reading_sessions_started ON reading_sessions (started_at DESC);`,

    `CREATE TABLE bookmarks (
       id            TEXT PRIMARY KEY NOT NULL,
       book_id       TEXT NOT NULL,
       page          INTEGER NOT NULL,
       label         TEXT,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       deleted_at    INTEGER,
       CHECK (page >= 0),
       FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
     );`,

    // Re-bookmarking a page updates the existing row rather than accumulating duplicates.
    `CREATE UNIQUE INDEX idx_bookmarks_page ON bookmarks (book_id, page) WHERE deleted_at IS NULL;`,

    `CREATE TABLE highlights (
       id            TEXT PRIMARY KEY NOT NULL,
       book_id       TEXT NOT NULL,
       page          INTEGER NOT NULL,
       quoted_text   TEXT NOT NULL,
       color_index   INTEGER NOT NULL DEFAULT 0,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       deleted_at    INTEGER,
       CHECK (page >= 0),
       CHECK (length(quoted_text) > 0),
       FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
     );`,

    `CREATE INDEX idx_highlights_book ON highlights (book_id, page);`,

    `CREATE TABLE book_notes (
       id            TEXT PRIMARY KEY NOT NULL,
       book_id       TEXT NOT NULL,
       page          INTEGER,
       body          TEXT NOT NULL,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       deleted_at    INTEGER,
       CHECK (length(body) > 0),
       FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
     );`,

    `CREATE INDEX idx_book_notes_book ON book_notes (book_id, created_at DESC);`,
  ],
};
