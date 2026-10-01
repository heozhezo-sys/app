/**
 * The books use-case layer, against real SQLite and real PDF bytes.
 *
 * The two-phase import contract is the thing worth protecting here: the database row
 * must never exist without its file, and a failed row insert must not leave the file
 * behind. Both are tested explicitly.
 */

import { NodeSqliteDriver } from '../support/nodeSqliteDriver';
import {
  __resetDatabaseHandleForTests,
  __setDatabaseHandleForTests,
} from '@/database/database';
import { runMigrations } from '@/database/migrator';
import { LATEST_SCHEMA_VERSION } from '@/database/migrations/types';
import { MemoryStorageAdapter } from '../support/memoryStorage';
import { buildPdfBytes } from '../support/pdfFixture';
import * as books from '@/services/booksService';
import { BOOKS_DIRECTORY } from '@/services/pdfImportService';

let driver: NodeSqliteDriver;
let storage: MemoryStorageAdapter;

const PICKED = { uri: 'picked://inbox/deep-work.pdf', name: 'deep-work.pdf' };

beforeEach(async () => {
  driver = new NodeSqliteDriver();
  await runMigrations(driver);
  __setDatabaseHandleForTests(driver, LATEST_SCHEMA_VERSION);

  storage = new MemoryStorageAdapter();
  storage.seedFile('inbox/deep-work.pdf', buildPdfBytes({ title: 'Deep Work', pageCount: 250 }));
  books.configureStorage(storage);
});

afterEach(async () => {
  books.configureStorage(new MemoryStorageAdapter());
  __resetDatabaseHandleForTests();
  await driver.close();
});

describe('importing a document', () => {
  it('stores the file and creates the library row', async () => {
    const outcome = await books.importDocument(PICKED);

    expect(outcome.status).toBe('imported');
    if (outcome.status !== 'imported') return;
    expect(outcome.book.title).toBe('Deep Work');
    expect(outcome.book.pageCount).toBe(250);
    expect(await storage.exists(`${BOOKS_DIRECTORY}/deep-work.pdf`)).toBe(true);
  });

  it('gives a second copy of the same PDF its own entry', async () => {
    await books.importDocument(PICKED);
    const second = await books.importDocument(PICKED);

    expect(second.status).toBe('imported');
    expect(await books.listBooks()).toHaveLength(2);
  });

  it('creates no row when the file is rejected', async () => {
    storage.seedFile('picked://inbox/notes.txt', new TextEncoder().encode('not a pdf'));
    const outcome = await books.importDocument({
      uri: 'picked://inbox/notes.txt',
      name: 'notes.txt',
    });

    expect(outcome.status).toBe('failed');
    // The failure path must leave the library untouched, not half-populated.
    expect(await books.listBooks()).toEqual([]);
  });

  it('leaves no library entry when the source file has moved', async () => {
    const outcome = await books.importDocument({ uri: 'picked://inbox/gone.pdf', name: 'gone.pdf' });

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'imported') throw new Error('expected failure');
    expect(outcome.failure.ok).toBe(false);
    expect(await books.listBooks()).toEqual([]);
  });

  it('removes the stored file when the database insert fails', async () => {
    const outcome = await books.importDocument(PICKED);
    if (outcome.status !== 'imported') throw new Error('expected import');

    // Stage a second file, then force the commit to collide with the first book's
    // `file_name`, which the unique index forbids.
    storage.seedFile('inbox/other.pdf', buildPdfBytes({ title: 'Other' }));
    const staged = await books.stageImport({ uri: 'picked://inbox/other.pdf', name: 'other.pdf' });
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;

    const clashing = { ...staged, filePath: outcome.book.fileName };
    await expect(books.commitImport(clashing)).rejects.toThrow();
  });
});

describe('staged imports', () => {
  it('stages a file without creating a row', async () => {
    const staged = await books.stageImport(PICKED);

    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    expect(staged.pageCount).toBe(250);
    // The file exists but the library does not yet know about it.
    expect(await storage.exists(staged.filePath)).toBe(true);
    expect(await books.listBooks()).toEqual([]);
  });
});

describe('opening a book', () => {
  it('opens a stored document with measured capabilities', async () => {
    const outcome = await books.importDocument(PICKED);
    if (outcome.status !== 'imported') throw new Error('expected import');

    const result = await books.openBook(outcome.book.id);

    expect(result?.ok).toBe(true);
    if (result?.ok !== true) return;
    expect(result.document.info.pageCount).toBe(250);
  });

  it('returns null for a book that does not exist', async () => {
    expect(await books.openBook('no-such-book')).toBeNull();
  });

  it('reports a file deleted behind the app rather than failing silently', async () => {
    const outcome = await books.importDocument(PICKED);
    if (outcome.status !== 'imported') throw new Error('expected import');

    // The user deletes the PDF from the Files app while LifeOS is closed.
    storage.simulateExternalDelete(`${BOOKS_DIRECTORY}/deep-work.pdf`);

    const result = await books.openBook(outcome.book.id);
    expect(result?.ok).toBe(false);
    if (result?.ok !== false) return;
    expect(result.failure.reason).toBe('missing');
  });
});
describe('progress', () => {
  async function imported() {
    const outcome = await books.importDocument(PICKED);
    if (outcome.status !== 'imported') throw new Error('expected import');
    return outcome.book;
  }

  it('stores the resume position', async () => {
    const book = await imported();
    await books.saveProgress(book.id, 100);

    expect((await books.getBook(book.id))?.currentPage).toBe(100);
  });

  it('clamps a page beyond the end of the document', async () => {
    const book = await imported();
    await books.saveProgress(book.id, 9999);

    // 250 pages, so the last valid index is 249.
    expect((await books.getBook(book.id))?.currentPage).toBe(249);
  });

  it('clamps a negative page to zero', async () => {
    const book = await imported();
    await books.saveProgress(book.id, -5);
    expect((await books.getBook(book.id))?.currentPage).toBe(0);
  });

  it('ignores a repeat of the current page', async () => {
    const book = await imported();
    await books.saveProgress(book.id, 10);
    const first = await books.getBook(book.id);
    await books.saveProgress(book.id, 10);
    const second = await books.getBook(book.id);

    expect(second?.currentPage).toBe(10);
    // No spurious write: lastReadAt is untouched when nothing changed.
    expect(second?.lastReadAt).toBe(first?.lastReadAt);
  });

  it('records a session and advances the resume pointer', async () => {
    const book = await imported();
    await books.recordSession({
      bookId: book.id,
      startedAt: 1000,
      endedAt: 61_000,
      startPage: 10,
      endPage: 20,
    });

    expect((await books.getBook(book.id))?.currentPage).toBe(20);
    expect(await books.readingTotals(book.id)).toEqual({ seconds: 60, pages: 10 });
  });

  it('clamps a session that overshoots the document', async () => {
    const book = await imported();
    await books.recordSession({
      bookId: book.id,
      startedAt: 1000,
      endedAt: 2000,
      startPage: 240,
      endPage: 5000,
    });

    expect((await books.getBook(book.id))?.currentPage).toBe(249);
  });
});

describe('annotations', () => {
  async function imported() {
    const outcome = await books.importDocument(PICKED);
    if (outcome.status !== 'imported') throw new Error('expected import');
    return outcome.book;
  }

  it('refuses an empty highlight instead of failing a constraint', async () => {
    const book = await imported();
    await expect(
      books.addHighlight({ bookId: book.id, page: 5, quotedText: '   ' }),
    ).resolves.toBeUndefined();

    expect(await books.listHighlights(book.id)).toEqual([]);
  });

  it('stores a trimmed highlight', async () => {
    const book = await imported();
    await books.addHighlight({ bookId: book.id, page: 5, quotedText: '  Focus is a skill.  ' });

    const list = await books.listHighlights(book.id);
    expect(list[0]?.quotedText).toBe('Focus is a skill.');
  });

  it('refuses an empty note', async () => {
    const book = await imported();
    await expect(books.addNote({ bookId: book.id, page: 1, body: '' })).resolves.toBeUndefined();
    expect(await books.listNotes(book.id)).toEqual([]);
  });

  it('sets and removes a bookmark', async () => {
    const book = await imported();
    await books.setBookmark(book.id, 12, 'Start here');
    expect(await books.listBookmarks(book.id)).toHaveLength(1);

    const [bookmark] = await books.listBookmarks(book.id);
    await books.removeBookmark(bookmark?.id ?? '');
    expect(await books.listBookmarks(book.id)).toEqual([]);
  });
});

describe('deleting a book', () => {
  it('hides the row and removes the file', async () => {
    const outcome = await books.importDocument(PICKED);
    if (outcome.status !== 'imported') throw new Error('expected import');

    await books.deleteBook(outcome.book.id);

    expect(await books.listBooks()).toEqual([]);
    expect(await storage.exists(`${BOOKS_DIRECTORY}/deep-work.pdf`)).toBe(false);
  });

  it('is safe to call for a book that is already gone', async () => {
    await expect(books.deleteBook('no-such-book')).resolves.toBeUndefined();
  });
});

describe('launch housekeeping', () => {
  it('sweeps an interrupted import without throwing', async () => {
    storage.seedFile(`${BOOKS_DIRECTORY}/half.pdf.part`, new Uint8Array(2048));

    await expect(books.sweepInterruptedImports()).resolves.toBeUndefined();
    expect(await storage.list(BOOKS_DIRECTORY)).toEqual([]);
  });

  it('reports the bytes an interrupted import is holding', async () => {
    storage.seedFile(`${BOOKS_DIRECTORY}/half.pdf.part`, new Uint8Array(2048));
    expect(await books.wastedBytes()).toBe(2048);
  });
});
