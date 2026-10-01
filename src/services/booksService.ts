/**
 * The books use-case layer.
 *
 * This is what the UI calls. Screens stay free of storage, filesystem and database
 * logic, per the architecture rules: they render a result and pass back an intent.
 *
 * Import is a two-phase operation and the phases are deliberately separate methods.
 * `stageImport` does everything that can fail — copy, validate, rename — and returns
 * the metadata *without* touching the database. `commitImport` then creates the row.
 * That split is what enforces the file-before-row ordering of ADR-0017: there is no
 * code path that writes a row for a file that was not successfully stored.
 */

import {
  BOOKS_DIRECTORY,
  cleanupInterruptedImports,
  importPdf,
  pendingImportBytes,
  type ImportFailure,
  type ImportSuccess,
} from '@/services/pdfImportService';
import { ExpoStorageAdapter } from '@/platform/storage/expoStorage';
import type { StorageAdapter } from '@/platform/storage/types';
import { StructurePdfEngine } from '@/pdf/engine/structureEngine';
import type { PDFReaderEngine, PdfOpenResult } from '@/pdf/engine/types';
import * as repository from '@/repositories/booksRepository';
import type { BookWithProgress } from '@/repositories/booksRepository';
import { logger } from '@/utils/logger';

/**
 * Process-wide storage and engine.
 *
 * Constructed lazily so importing this module does not touch native modules during
 * test collection, and so tests can inject their own via `configureStorage`.
 */
let storageAdapter: StorageAdapter | null = null;
let readerEngine: PDFReaderEngine | null = null;

export function configureStorage(storage: StorageAdapter, engine?: PDFReaderEngine): void {
  storageAdapter = storage;
  readerEngine = engine ?? new StructurePdfEngine(storage);
}

export function getStorage(): StorageAdapter {
  if (!storageAdapter) configureStorage(new ExpoStorageAdapter());
  return storageAdapter as StorageAdapter;
}

export function getReaderEngine(): PDFReaderEngine {
  if (!readerEngine) readerEngine = new StructurePdfEngine(getStorage());
  return readerEngine;
}

/** A picked document, from the document picker or an incoming share. */
export interface PickedDocument {
  uri: string;
  name: string;
  size?: number | null;
}

export type ImportOutcome =
  | { status: 'imported'; book: BookWithProgress }
  | { status: 'failed'; failure: ImportFailure };

/**
 * Runs once per launch.
 *
 * Sweeps files left behind by an interrupted import. Never throws: a failure here must
 * not block the app from starting.
 */
export async function sweepInterruptedImports(): Promise<void> {
  try {
    await cleanupInterruptedImports(getStorage());
  } catch (error) {
    logger.warn('Interrupted PDF sweep failed at launch', error);
  }
}

/** Bytes held by interrupted imports, for display in Settings. */
export async function wastedBytes(): Promise<number> {
  return pendingImportBytes(getStorage());
}

/**
 * Copies and validates a picked PDF without creating a library row.
 *
 * Returns the staged result on success. On failure nothing is stored.
 */
export async function stageImport(
  picked: PickedDocument,
  options: { title?: string } = {},
): Promise<ImportSuccess | ImportFailure> {
  return importPdf(
    {
      originalName: picked.name,
      sourceUri: picked.uri,
      ...(options.title ? { title: options.title } : {}),
    },
    { storage: getStorage(), existingNames: await repository.listFileNames() },
  );
}

/**
 * Creates the library row for a staged file.
 *
 * If the insert fails, the stored file is removed again, so a database error cannot
 * leave an unreferenced PDF occupying the user's storage.
 */
export async function commitImport(staged: ImportSuccess): Promise<BookWithProgress> {
  try {
    return await repository.insertBook({
      title: staged.title,
      author: staged.author,
      fileName: staged.filePath,
      originalName: staged.filePath.split('/').pop() ?? staged.title,
      fileSizeBytes: staged.sizeBytes,
      pageCount: staged.pageCount,
      summary: null,
    });
  } catch (error) {
    logger.error('Could not create the library entry; removing the stored file', error);
    await removeQuietly(staged.filePath);
    throw error;
  }
}

/** Stages and commits in one step. The path a simple "Add PDF" button uses. */
export async function importDocument(
  picked: PickedDocument,
  options: { title?: string } = {},
): Promise<ImportOutcome> {
  const staged = await stageImport(picked, options);
  if (!staged.ok) return { status: 'failed', failure: staged };

  try {
    return { status: 'imported', book: await commitImport(staged) };
  } catch (error) {
    logger.error('Import failed while creating the library entry', error);
    return {
      status: 'failed',
      failure: {
        ok: false,
        reason: 'unreadable',
        message: 'The PDF was saved but could not be added to your library. Please try again.',
      },
    };
  }
}
export async function listBooks(includeArchived = false): Promise<BookWithProgress[]> {
  return repository.listBooks(includeArchived);
}

export async function getBook(id: string): Promise<BookWithProgress | null> {
  return repository.getBook(id);
}

/**
 * Opens a book for reading.
 *
 * Re-reads the file on every open rather than caching, because the user may have
 * deleted or replaced it from the Files app while LifeOS was not running.
 */
export async function openBook(bookId: string): Promise<PdfOpenResult | null> {
  const book = await repository.getBook(bookId);
  if (!book) return null;
  return getReaderEngine().open(book.fileName);
}

/** Writes the resume position, clamped to the document. */
export async function saveProgress(bookId: string, page: number): Promise<void> {
  const book = await repository.getBook(bookId);
  if (!book) return;

  // The reader may report a page beyond the end while a document is being re-parsed.
  // Clamping here keeps the stored pointer valid without relying on a constraint error.
  const maxPage = Math.max(0, book.pageCount - 1);
  const clamped = Math.min(Math.max(0, Math.trunc(page)), maxPage);
  if (clamped === book.currentPage) return;

  await repository.updateBook(bookId, { currentPage: clamped, lastReadAt: Date.now() });
}

/** Records a reading session and moves the resume pointer in one step. */
export async function recordSession(input: {
  bookId: string;
  startedAt: number;
  endedAt: number;
  startPage: number;
  endPage: number;
}): Promise<void> {
  const book = await repository.getBook(input.bookId);
  if (!book) return;

  await repository.insertReadingSession(input);

  const maxPage = Math.max(0, book.pageCount - 1);
  const clamped = Math.min(Math.max(0, input.endPage), maxPage);
  await repository.updateBook(input.bookId, {
    currentPage: clamped,
    lastReadAt: Date.now(),
  });
}

export async function setBookmark(bookId: string, page: number, label: string | null): Promise<void> {
  return repository.setBookmark(bookId, page, label);
}

export async function listBookmarks(bookId: string): Promise<Awaited<ReturnType<typeof repository.listBookmarks>>> {
  return repository.listBookmarks(bookId);
}

export async function removeBookmark(id: string): Promise<void> {
  return repository.removeBookmark(id);
}

export async function addHighlight(input: {
  bookId: string;
  page: number;
  quotedText: string;
  colorIndex?: number;
}): Promise<void> {
  const text = input.quotedText.trim();
  // An empty highlight is meaningless and the schema forbids it; reject early with a
  // clear outcome rather than letting a constraint failure surface.
  if (text === '') return;
  return repository.insertHighlight({ ...input, quotedText: text });
}

export async function listHighlights(
  bookId: string,
): Promise<Awaited<ReturnType<typeof repository.listHighlights>>> {
  return repository.listHighlights(bookId);
}

export async function removeHighlight(id: string): Promise<void> {
  return repository.removeHighlight(id);
}

export async function addNote(input: {
  bookId: string;
  page: number | null;
  body: string;
}): Promise<void> {
  const body = input.body.trim();
  if (body === '') return;
  return repository.insertNote({ ...input, body });
}

export async function listNotes(bookId: string): Promise<Awaited<ReturnType<typeof repository.listNotes>>> {
  return repository.listNotes(bookId);
}

export async function updateNote(id: string, body: string): Promise<void> {
  const trimmed = body.trim();
  if (trimmed === '') return;
  return repository.updateNote(id, trimmed);
}

export async function removeNote(id: string): Promise<void> {
  return repository.removeNote(id);
}

export async function readingTotals(bookId: string): Promise<{ seconds: number; pages: number }> {
  return repository.readingTotals(bookId);
}

/**
 * Removes a book and its file.
 *
 * Hides the row first, then deletes the file. A crash between the two leaves an
 * orphaned file, which is recoverable; the reverse order would leave a library entry
 * pointing at nothing.
 */
export async function deleteBook(bookId: string): Promise<void> {
  const path = await repository.softDeleteBook(bookId);
  if (!path) return;
  await removeQuietly(path);
}

async function removeQuietly(path: string): Promise<void> {
  try {
    await getStorage().remove(path);
  } catch (error) {
    logger.warn(`Could not remove ${path}`, error);
  }
}

/** Re-exported so screens do not need to know the storage layout. */
export { BOOKS_DIRECTORY };
