/**
 * Books feature hooks.
 *
 * Thin wrappers over `booksService`. Screens never call the service, the repository or
 * the storage adapter directly; they use these, so the use-case layer stays the single
 * place that knows how a book is stored.
 */

import { useCallback } from 'react';

import { CHANNELS } from '@/database/database';
import { useAction, useAsyncResource } from '@/hooks/useAsyncResource';
import * as service from '@/services/booksService';
import type { BookWithProgress } from '@/repositories/booksRepository';
import type { PdfDocumentHandle, PdfOpenResult } from '@/pdf/engine/types';
import type { PickedDocument } from '@/services/booksService';

/** The library, ordered by most recently read. */
export function useBooks(includeArchived = false) {
  return useAsyncResource(() => service.listBooks(includeArchived), CHANNELS.books, {
    deps: [includeArchived],
  });
}

/** A single book, or `null` while loading / when it no longer exists. */
export function useBook(bookId: string | null) {
  return useAsyncResource(
    async () => (bookId ? service.getBook(bookId) : null),
    CHANNELS.books,
    { enabled: bookId !== null, deps: [bookId] },
  );
}

/**
 * Opens a book for reading.
 *
 * `null` data means "not loaded yet"; an `ok: false` data value carries a typed
 * failure the reader renders as a specific explanation.
 */
export function useOpenBook(bookId: string | null) {
  // `openBook` returns `null` for a book that does not exist, so the result type
  // includes `null` rather than being forced with a cast.
  return useAsyncResource<PdfOpenResult | null>(
    async () => (bookId ? await service.openBook(bookId) : null),
    CHANNELS.books,
    { enabled: bookId !== null, deps: [bookId] },
  );
}

/** Imports a picked document, exposing pending and error state. */
export function useImportDocument() {
  return useAction(async (picked: PickedDocument, title?: string) =>
    service.importDocument(picked, title ? { title } : {}),
  );
}

export function useDeleteBook() {
  return useAction((bookId: string) => service.deleteBook(bookId));
}

export function useBookmarks(bookId: string | null) {
  return useAsyncResource(
    async () => (bookId ? service.listBookmarks(bookId) : []),
    CHANNELS.reading,
    { enabled: bookId !== null, deps: [bookId] },
  );
}

export function useHighlights(bookId: string | null) {
  return useAsyncResource(
    async () => (bookId ? service.listHighlights(bookId) : []),
    CHANNELS.reading,
    { enabled: bookId !== null, deps: [bookId] },
  );
}

export function useNotes(bookId: string | null) {
  return useAsyncResource(
    async () => (bookId ? service.listNotes(bookId) : []),
    CHANNELS.reading,
    { enabled: bookId !== null, deps: [bookId] },
  );
}

/** Closes a document handle when the reader unmounts. */
export function useCloseDocument(handle: PdfDocumentHandle | null): () => void {
  return useCallback(() => {
    if (!handle) return;
    // Fire-and-forget: teardown must not block navigation, and `close` is idempotent.
    void handle.close();
  }, [handle]);
}

export type { BookWithProgress };
