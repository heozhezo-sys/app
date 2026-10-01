/**
 * Books, reading history, bookmarks, highlights and notes, end-to-end through
 * repository -> real SQLite. The PDF binary is not involved here; only metadata and
 * reading state live in the database, which is exactly what these tests pin down.
 */

import { NodeSqliteDriver } from '../support/nodeSqliteDriver';
import {
  __resetDatabaseHandleForTests,
  __setDatabaseHandleForTests,
} from '@/database/database';
import { runMigrations } from '@/database/migrator';
import { LATEST_SCHEMA_VERSION } from '@/database/migrations/types';
import * as books from '@/repositories/booksRepository';

let driver: NodeSqliteDriver;

beforeEach(async () => {
  driver = new NodeSqliteDriver();
  await runMigrations(driver);
  __setDatabaseHandleForTests(driver, LATEST_SCHEMA_VERSION);
});

afterEach(async () => {
  __resetDatabaseHandleForTests();
  await driver.close();
});

async function addBook(overrides: Partial<Parameters<typeof books.insertBook>[0]> = {}) {
  return books.insertBook({
    title: 'Deep Work',
    author: 'Cal Newport',
    fileName: 'books/deep-work.pdf',
    originalName: 'deep-work.pdf',
    fileSizeBytes: 4096,
    pageCount: 250,
    summary: null,
    ...overrides,
  });
}

describe('the book library', () => {
  it('stores only metadata, with a documents-relative path', async () => {
    const book = await addBook();

    expect(book.id).not.toBe('');
    expect(book.fileName).toBe('books/deep-work.pdf');
    // No absolute path is ever persisted, so a backup stays device-portable.
    expect(book.fileName.startsWith('/')).toBe(false);
    expect(book.status).toBe('reading');
    expect(book.currentPage).toBe(0);
  });

  it('derives reading progress from the current page', async () => {
    const book = await addBook({ pageCount: 200 });
    const updated = await books.updateBook(book.id, { currentPage: 50 });

    expect(updated?.progressPct).toBe(25);
  });

  it('reports zero progress for a document of unknown length', async () => {
    const book = await addBook({ pageCount: 0 });
    expect(book.progressPct).toBe(0);
  });

  it('rejects a resume page beyond the end of the document', async () => {
    const book = await addBook({ pageCount: 100 });

    // The schema enforces the invariant, so a corrupt resume position cannot be stored.
    await expect(books.updateBook(book.id, { currentPage: 101 })).rejects.toThrow();
  });

  it('refuses a second book pointing at the same file', async () => {
    await addBook();
    await expect(addBook({ title: 'Copy' })).rejects.toThrow();
  });

  it('frees the file name once the previous book is soft deleted', async () => {
    const book = await addBook();
    await books.softDeleteBook(book.id);

    // The unique index is partial, so the same file can be re-imported later.
    await expect(addBook({ title: 'Deep Work again' })).resolves.toBeTruthy();
  });

  it('never lists a soft-deleted book, even when including archived ones', async () => {
    const first = await addBook();
    await addBook({ title: 'Second', fileName: 'books/second.pdf' });
    await books.softDeleteBook(first.id);

    // `includeArchived` widens to abandoned books, not to deleted ones: a deleted book
    // is gone from the library for good.
    expect(await books.listBooks()).toHaveLength(1);
    expect(await books.listBooks(true)).toHaveLength(1);
  });

  it('excludes abandoned books from the default list', async () => {
    const book = await addBook();
    await books.updateBook(book.id, { status: 'abandoned' });

    expect(await books.listBooks()).toHaveLength(0);
    expect(await books.listBooks(true)).toHaveLength(1);
  });

  it('requires a finish timestamp before a book can be finished', async () => {
    const book = await addBook();
    await expect(books.updateBook(book.id, { status: 'finished' })).rejects.toThrow();
  });

  it('sorts by most recently read', async () => {
    const first = await addBook({ title: 'Older', fileName: 'books/older.pdf' });
    const second = await addBook({ title: 'Newer', fileName: 'books/newer.pdf' });

    await books.updateBook(first.id, { lastReadAt: 1000 });
    await books.updateBook(second.id, { lastReadAt: 2000 });

    const list = await books.listBooks();
    expect(list.map((b) => b.title)).toEqual(['Newer', 'Older']);
  });

  it('lists the filenames in use so the importer can avoid collisions', async () => {
    await addBook();
    expect(await books.listFileNames()).toEqual(new Set(['deep-work.pdf']));
  });

  it('returns the stored path when a book is soft deleted', async () => {
    const book = await addBook();
    expect(await books.softDeleteBook(book.id)).toBe('books/deep-work.pdf');
    expect(await books.getBook(book.id)).toBeNull();
  });

  it('is a no-op for a patch with nothing to change', async () => {
    const book = await addBook();
    expect((await books.updateBook(book.id, {}))?.id).toBe(book.id);
  });
});
describe('reading history', () => {
  it('records a session and derives totals from it', async () => {
    const book = await addBook({ pageCount: 300 });

    await books.insertReadingSession({
      bookId: book.id, startedAt: 1000, endedAt: 610_000, startPage: 10, endPage: 25,
    });
    await books.insertReadingSession({
      bookId: book.id, startedAt: 2000, endedAt: 122_000, startPage: 25, endPage: 30,
    });

    const totals = await books.readingTotals(book.id);
    // 609s + 120s, derived from the stored sessions rather than guessed.
    expect(totals.seconds).toBe(729);
    expect(totals.pages).toBe(20);
  });

  it('lists sessions most recent first', async () => {
    const book = await addBook();
    await books.insertReadingSession({
      bookId: book.id, startedAt: 1000, endedAt: 2000, startPage: 0, endPage: 1,
    });
    await books.insertReadingSession({
      bookId: book.id, startedAt: 5000, endedAt: 6000, startPage: 1, endPage: 2,
    });

    const sessions = await books.listReadingSessions(book.id);
    expect(sessions.map((s) => s.startedAt)).toEqual([5000, 1000]);
  });

  it('rejects a session that ends before it starts', async () => {
    const book = await addBook();
    await expect(
      books.insertReadingSession({
        bookId: book.id, startedAt: 5000, endedAt: 1000, startPage: 0, endPage: 1,
      }),
    ).rejects.toThrow();
  });

  it('rejects a session that moves backwards through the book', async () => {
    const book = await addBook();
    await expect(
      books.insertReadingSession({
        bookId: book.id, startedAt: 1000, endedAt: 2000, startPage: 20, endPage: 5,
      }),
    ).rejects.toThrow();
  });

  it('reports no totals for a book that has never been opened', async () => {
    const book = await addBook();
    expect(await books.readingTotals(book.id)).toEqual({ seconds: 0, pages: 0 });
  });
});

describe('bookmarks', () => {
  it('adds and lists bookmarks in page order', async () => {
    const book = await addBook();
    await books.setBookmark(book.id, 30, 'Key idea');
    await books.setBookmark(book.id, 4, 'Introduction');

    const list = await books.listBookmarks(book.id);
    expect(list.map((b) => b.page)).toEqual([4, 30]);
    expect(list[1]?.label).toBe('Key idea');
  });

  it('updates rather than duplicates when re-bookmarking a page', async () => {
    const book = await addBook();
    await books.setBookmark(book.id, 12, 'First label');
    await books.setBookmark(book.id, 12, 'Better label');

    const list = await books.listBookmarks(book.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.label).toBe('Better label');
  });

  it('allows a bookmark again after it is removed', async () => {
    const book = await addBook();
    await books.setBookmark(book.id, 7, null);
    const [first] = await books.listBookmarks(book.id);
    await books.removeBookmark(first?.id ?? '');

    await books.setBookmark(book.id, 7, 'Re-added');
    const list = await books.listBookmarks(book.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.label).toBe('Re-added');
  });
});

describe('highlights', () => {
  it('stores quoted text with a colour and page', async () => {
    const book = await addBook();
    await books.insertHighlight({
      bookId: book.id, page: 42, quotedText: 'Focus is a superpower.', colorIndex: 2,
    });

    const list = await books.listHighlights(book.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.quotedText).toBe('Focus is a superpower.');
    expect(list[0]?.colorIndex).toBe(2);
  });

  it('defaults the colour when none is given', async () => {
    const book = await addBook();
    await books.insertHighlight({ bookId: book.id, page: 1, quotedText: 'Note' });
    expect((await books.listHighlights(book.id))[0]?.colorIndex).toBe(0);
  });

  it('rejects an empty highlight', async () => {
    const book = await addBook();
    await expect(
      books.insertHighlight({ bookId: book.id, page: 1, quotedText: '' }),
    ).rejects.toThrow();
  });

  it('soft deletes a highlight', async () => {
    const book = await addBook();
    await books.insertHighlight({ bookId: book.id, page: 1, quotedText: 'Gone soon' });
    const [highlight] = await books.listHighlights(book.id);
    await books.removeHighlight(highlight?.id ?? '');

    expect(await books.listHighlights(book.id)).toHaveLength(0);
  });
});

describe('book notes', () => {
  it('stores a note against a page', async () => {
    const book = await addBook();
    await books.insertNote({ bookId: book.id, page: 88, body: 'Revisit this argument.' });

    const notes = await books.listNotes(book.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.page).toBe(88);
    expect(notes[0]?.body).toBe('Revisit this argument.');
  });

  it('allows a note with no page, for a whole-book reflection', async () => {
    const book = await addBook();
    await books.insertNote({ bookId: book.id, page: null, body: 'Overall verdict.' });
    expect((await books.listNotes(book.id))[0]?.page).toBeNull();
  });

  it('edits a note in place', async () => {
    const book = await addBook();
    await books.insertNote({ bookId: book.id, page: 1, body: 'First draft' });
    const [note] = await books.listNotes(book.id);

    await books.updateNote(note?.id ?? '', 'Second draft');
    expect((await books.listNotes(book.id))[0]?.body).toBe('Second draft');
  });

  it('rejects an empty note', async () => {
    const book = await addBook();
    await expect(books.insertNote({ bookId: book.id, page: 1, body: '' })).rejects.toThrow();
  });

  it('soft deletes a note', async () => {
    const book = await addBook();
    await books.insertNote({ bookId: book.id, page: 1, body: 'Delete me' });
    const [note] = await books.listNotes(book.id);
    await books.removeNote(note?.id ?? '');

    expect(await books.listNotes(book.id)).toHaveLength(0);
  });
});

describe('deletion', () => {
  it('cascades bookmarks, highlights and notes on a hard delete', async () => {
    const book = await addBook();
    await books.setBookmark(book.id, 3, null);
    await books.insertHighlight({ bookId: book.id, page: 3, quotedText: 'Kept' });
    await books.insertNote({ bookId: book.id, page: 3, body: 'Kept' });

    await books.softDeleteBook(book.id);
    // A hard delete takes the dependent rows with it.
    await driver.run('DELETE FROM books WHERE id = ?;', [book.id]);

    expect(await books.listBookmarks(book.id)).toHaveLength(0);
    expect(await books.listHighlights(book.id)).toHaveLength(0);
    expect(await books.listNotes(book.id)).toHaveLength(0);
  });
});
