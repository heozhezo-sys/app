import type { Migration } from './types';

/**
 * 012 — Full-text search.
 *
 * Search is a capability, not an assumption. Some Android system SQLite builds ship
 * without FTS5, and a migration must never fail because an optional accelerator is
 * absent. These statements therefore run only when the runner's `fts5` probe
 * succeeds; `SearchRepository` detects the same capability at runtime and falls back
 * to `LIKE` queries, which are slower but always correct.
 */
export const migration012: Migration = {
  version: 12,
  name: 'search',
  statements: [
    `CREATE TABLE search_capabilities (
       name        TEXT PRIMARY KEY NOT NULL,
       enabled     INTEGER NOT NULL DEFAULT 0,
       detected_at INTEGER NOT NULL,
       CHECK (enabled IN (0, 1))
     );`,
  ],
  when: {
    capability: 'fts5',
    statements: [
      `CREATE VIRTUAL TABLE book_search USING fts5(
         title, author, summary,
         content = 'books', content_rowid = 'rowid', tokenize = 'unicode61'
       );`,

      `CREATE TRIGGER books_fts_ai AFTER INSERT ON books BEGIN
         INSERT INTO book_search(rowid, title, author, summary)
         VALUES (new.rowid, new.title, new.author, new.summary);
       END;`,

      `CREATE TRIGGER books_fts_ad AFTER DELETE ON books BEGIN
         INSERT INTO book_search(book_search, rowid, title, author, summary)
         VALUES ('delete', old.rowid, old.title, old.author, old.summary);
       END;`,

      `CREATE TRIGGER books_fts_au AFTER UPDATE ON books BEGIN
         INSERT INTO book_search(book_search, rowid, title, author, summary)
         VALUES ('delete', old.rowid, old.title, old.author, old.summary);
         INSERT INTO book_search(rowid, title, author, summary)
         VALUES (new.rowid, new.title, new.author, new.summary);
       END;`,

      `CREATE VIRTUAL TABLE journal_search USING fts5(
         title, body, tags,
         content = 'journal_entries', content_rowid = 'rowid', tokenize = 'unicode61'
       );`,

      `CREATE TRIGGER journal_fts_ai AFTER INSERT ON journal_entries BEGIN
         INSERT INTO journal_search(rowid, title, body, tags)
         VALUES (new.rowid, new.title, new.body, new.tags);
       END;`,

      `CREATE TRIGGER journal_fts_ad AFTER DELETE ON journal_entries BEGIN
         INSERT INTO journal_search(journal_search, rowid, title, body, tags)
         VALUES ('delete', old.rowid, old.title, old.body, old.tags);
       END;`,

      `CREATE TRIGGER journal_fts_au AFTER UPDATE ON journal_entries BEGIN
         INSERT INTO journal_search(journal_search, rowid, title, body, tags)
         VALUES ('delete', old.rowid, old.title, old.body, old.tags);
         INSERT INTO journal_search(rowid, title, body, tags)
         VALUES (new.rowid, new.title, new.body, new.tags);
       END;`,
    ],
  },
};
