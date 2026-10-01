import type { Migration } from './types';

/**
 * 008 — Journal.
 *
 * Journal content is the most private data in the app. It is stored unencrypted in
 * the app sandbox (the same place as every other record) and never leaves the device;
 * the in-app privacy lock is a UI gate backed by SecureStore, not a claim of
 * cryptographic at-rest encryption.
 */
export const migration008: Migration = {
  version: 8,
  name: 'journal',
  statements: [
    `CREATE TABLE journal_entries (
       id            TEXT PRIMARY KEY NOT NULL,
       entry_date    TEXT NOT NULL,
       title         TEXT,
       body          TEXT NOT NULL,
       mood          TEXT,
       mood_score    INTEGER,
       is_favorite   INTEGER NOT NULL DEFAULT 0,
       tags          TEXT,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       deleted_at    INTEGER,
       CHECK (length(body) > 0),
       CHECK (mood_score IS NULL OR (mood_score >= 1 AND mood_score <= 10)),
       CHECK (is_favorite IN (0, 1)),
       CHECK (entry_date LIKE '____-__-__')
     );`,

    `CREATE INDEX idx_journal_date ON journal_entries (entry_date DESC, deleted_at);`,
    `CREATE INDEX idx_journal_favorite ON journal_entries (is_favorite) WHERE deleted_at IS NULL;`,

    // Attachments are referenced by filename; the bytes live in app storage.
    `CREATE TABLE journal_attachments (
       id             TEXT PRIMARY KEY NOT NULL,
       entry_id       TEXT NOT NULL,
       file_name      TEXT NOT NULL,
       mime_type      TEXT,
       size_bytes     INTEGER NOT NULL DEFAULT 0,
       created_at     INTEGER NOT NULL,
       deleted_at     INTEGER,
       CHECK (size_bytes >= 0),
       FOREIGN KEY (entry_id) REFERENCES journal_entries (id) ON DELETE CASCADE
     );`,

    `CREATE UNIQUE INDEX idx_journal_attachments_name ON journal_attachments (entry_id, file_name);`,
  ],
};
