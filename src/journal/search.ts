/**
 * Local journal search.
 *
 * **Search never leaves the device.** `FEATURES/JOURNAL.md` requires that journal contents
 * are never transmitted silently, so this module contains no network call and takes no
 * endpoint. Every query runs against the local database file. That is enforced by
 * `tests/integration/journal.test.ts`, which asserts the journal module graph imports no
 * networking library — a property that is easy to lose in review and cheap to test.
 *
 * **FTS5 is a capability, not an assumption.** Some Android system SQLite builds ship
 * without it. When it is available the query goes through the `journal_search` FTS5 index
 * and the trigger-maintained index; otherwise it falls back to `LIKE` over the base table,
 * which is slower but always correct. Migration 012 already decided this; this module
 * follows it.
 */

import type { SqlDriver } from '@/database/driver';
import { getDatabase } from '@/database/database';

export type SearchStrategy = 'fts5' | 'like';

export interface SearchOutcome<T> {
  results: T[];
  /** Which path ran. Surfaced so the UI can be honest about a slower fallback. */
  strategy: SearchStrategy;
}

/** Escapes the LIKE wildcards so a user searching for "50%" does not match everything. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * Quotes a term for an FTS5 MATCH expression.
 *
 * FTS5 has its own query syntax where `"` and `*` and `:` are operators. Wrapping the term
 * in double quotes makes it a literal phrase, which is what a user typing into a search box
 * means. The inner quotes are doubled, per FTS5's own escaping rule.
 */
export function toMatchExpression(query: string): string | null {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((term) => term !== '')
    .map((term) => `"${term.replace(/"/g, '""')}"`);

  if (terms.length === 0) return null;
  // Each quoted term is ANDed: "deep work" means both words must appear.
  return terms.join(' AND ');
}

/**
 * Whether this database build has FTS5.
 *
 * Read from the table migration 012 populated at migrate time, rather than re-probing:
 * the probe creates a virtual table, and running that on every keystroke would be wasteful.
 */
export async function hasFts5(driver?: SqlDriver): Promise<boolean> {
  const db = driver ?? (await getDatabase()).driver;
  try {
    const row = await db.first<{ enabled: number }>(
      "SELECT enabled FROM search_capabilities WHERE name = 'fts5';",
    );
    return row?.enabled === 1;
  } catch {
    // The capability table comes from migration 012. A database older than that, or a
    // failed read, means FTS5 cannot be assumed.
    return false;
  }
}

/** Columns an entry can be matched against. */
export type JournalSearchField = 'title' | 'body' | 'tags';

/**
 * Searches journal entries locally.
 *
 * Runs entirely against the device database. Returns the strategy used so the caller can
 * report that it fell back, rather than implying the faster path ran.
 */
export async function searchJournal(
  driver: SqlDriver,
  query: string,
  options: { limit?: number; fields?: JournalSearchField[]; favouritesOnly?: boolean } = {},
): Promise<SearchOutcome<{ rowid: number }>> {
  const limit = Math.min(Math.max(1, options.limit ?? 50), 200);
  const fields = options.fields ?? ['title', 'body', 'tags'];

  if (fields.length === 0) return { results: [], strategy: 'like' };

  const ftsAvailable = await hasFts5(driver);

  if (ftsAvailable) {
    try {
      return { results: await searchFts(driver, query, limit), strategy: 'fts5' };
    } catch {
      // A query FTS5 rejects must not fail the search. Fall through to LIKE, which cannot
      // reject a user's words.
    }
  }

  return {
    results: await searchLike(
      driver,
      query,
      limit,
      fields,
      options.favouritesOnly === true,
    ),
    strategy: 'like',
  };
}

/**
 * FTS5 path: matches against the `journal_search` index that migration 012's triggers keep
 * in step with the base table.
 */
async function searchFts(
  driver: SqlDriver,
  query: string,
  limit: number,
): Promise<{ rowid: number }[]> {
  const match = toMatchExpression(query);
  if (!match) return [];

  // `journal_search` is an external-content table, so `rowid` is the `journal_entries`
  // rowid. The candidate rows are re-joined against the base table by the repository so
  // soft-deleted entries are excluded there.
  return driver.all<{ rowid: number }>(
    'SELECT rowid FROM journal_search WHERE journal_search MATCH ? ORDER BY rank LIMIT ?;',
    [match, limit],
  );
}

/** Fallback path: `LIKE` over the base table. Always correct, just slower. */
async function searchLike(
  driver: SqlDriver,
  query: string,
  limit: number,
  fields: JournalSearchField[],
  favouritesOnly: boolean,
): Promise<{ rowid: number }[]> {
  const term = `%${escapeLike(query.trim())}%`;
  const clauses = fields.map((field) => `${field} LIKE ? ESCAPE '\\'`).join(' OR ');

  return driver.all<{ rowid: number }>(
    `SELECT rowid FROM journal_entries
      WHERE deleted_at IS NULL
        AND (${clauses})
        ${favouritesOnly ? 'AND is_favorite = 1' : ''}
      ORDER BY entry_date DESC
      LIMIT ?;`,
    [...fields.map(() => term), limit],
  );
}

