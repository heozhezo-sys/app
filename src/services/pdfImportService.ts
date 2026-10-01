/**
 * PDF import.
 *
 * The specification's flow is: validate -> copy/persist locally -> extract metadata ->
 * create a database record. Two properties matter more than the ordering:
 *
 * **1. The file lands before the row.** Bytes are written to a temporary name and only
 *    then renamed into place, and the database row is created *after* the rename. A
 *    process killed mid-import can therefore leave at worst an orphaned `.part` file —
 *    swept by `cleanupInterruptedImports` on next launch — and never a library entry
 *    pointing at a file that does not exist. A rename is atomic on both platforms.
 *
 * **2. Every failure is a typed result.** A corrupt, encrypted, oversized, unreadable or
 *    truncated file is an ordinary user situation, not a crash. `importPdf` returns a
 *    discriminated result and never throws for bad input.
 */

import { StorageError, type RelativePath, type StorageAdapter } from '@/platform/storage/types';
import { readDocumentFacts } from '@/pdf/engine/documentReader';
import { hasPdfMagic } from '@/pdf/engine/pdfStructure';
import { logger } from '@/utils/logger';
import { createId } from '@/utils/id';

export const BOOKS_DIRECTORY = 'books';
/** Suffix marking an in-progress import. Swept on launch. */
export const PARTIAL_SUFFIX = '.part';

/** Refuse anything larger up front; 200 MB is far past a comfortable reader limit. */
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
const MIN_PDF_BYTES = 5;

export type ImportFailureReason =
  | 'unsupported_extension'
  | 'not_a_pdf'
  | 'empty'
  | 'too_large'
  | 'encrypted'
  | 'no_pages'
  | 'not_enough_space'
  | 'unreadable'
  | 'duplicate';

export interface ImportSuccess {
  ok: true;
  /** Relative path of the stored file. Goes into `books.file_name`. */
  filePath: RelativePath;
  title: string;
  author: string | null;
  pageCount: number;
  sizeBytes: number;
  pdfVersion: string | null;
}

export interface ImportFailure {
  ok: false;
  reason: ImportFailureReason;
  /** Written for a human, not for a log. */
  message: string;
}

export type ImportResult = ImportSuccess | ImportFailure;

export interface ImportOptions {
  /** Name proposed by the picker, used for the title and the stored filename. */
  originalName: string;
  /** Where the picked file currently lives, from the document picker or a share. */
  sourceUri: string;
  /** Explicit title override, e.g. from the confirm sheet. */
  title?: string;
  /** Overridable so tests can exercise limits with small files. */
  maxBytes?: number;
}

export interface ImportDeps {
  storage: StorageAdapter;
  /**
   * Names already in the library, so a second copy of the same PDF becomes a
   * distinguishable name rather than a collision error.
   */
  existingNames?: ReadonlySet<string>;
}

async function safeRemove(storage: StorageAdapter, path: RelativePath): Promise<void> {
  try {
    await storage.remove(path);
  } catch (error) {
    logger.warn(`Could not remove ${path}`, error);
  }
}

function copyFailure(error: unknown): ImportFailure {
  if (error instanceof StorageError) {
    if (error.code === 'NOT_ENOUGH_SPACE') {
      return {
        ok: false,
        reason: 'not_enough_space',
        message: 'There is not enough free space to keep a copy of this PDF.',
      };
    }
    if (error.code === 'NOT_FOUND') {
      return {
        ok: false,
        reason: 'unreadable',
        message: 'The file could not be read. It may have been moved.',
      };
    }
  }
  return { ok: false, reason: 'unreadable', message: 'The file could not be imported.' };
}

export function hasPdfExtension(name: string): boolean {
  return name.toLowerCase().endsWith('.pdf');
}

export function stripExtension(name: string): string {
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(0, index) : name;
}

/**
 * Produces a filename unique against the current library.
 *
 * A collision becomes `name (2).pdf` rather than an error, because importing the same
 * PDF twice is a reasonable thing to do and should not fail.
 */
export function uniqueName(suggested: string, existing?: ReadonlySet<string>): string {
  const base = suggested.replace(/\.pdf$/i, '') || 'book';
  if (!existing || !existing.has(`${base}.pdf`)) return `${base}.pdf`;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base} (${n}).pdf`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base} (${createId().slice(0, 8)}).pdf`;
}
export async function importPdf(
  options: ImportOptions,
  deps: ImportDeps,
): Promise<ImportResult> {
  const { storage } = deps;
  const maxBytes = options.maxBytes ?? MAX_IMPORT_BYTES;

  // ---- 1. Name and extension -------------------------------------------------
  const base = stripExtension(options.originalName);
  if (!hasPdfExtension(options.originalName)) {
    return {
      ok: false,
      reason: 'unsupported_extension',
      message: 'Only PDF files can be added to your library.',
    };
  }

  const targetName = uniqueName(base, deps.existingNames);
  const filePath = `${BOOKS_DIRECTORY}/${targetName}`;
  const partialPath = `${filePath}${PARTIAL_SUFFIX}`;

  // ---- 2. Copy to a temporary name -----------------------------------------
  try {
    await storage.ensureDirectory(BOOKS_DIRECTORY);
    await storage.copyFromUri(options.sourceUri, partialPath);
  } catch (error) {
    await safeRemove(storage, partialPath);
    return copyFailure(error);
  }

  return finalise(storage, options, { filePath, partialPath, base, maxBytes });
}

interface FinaliseContext {
  filePath: RelativePath;
  partialPath: RelativePath;
  base: string;
  maxBytes: number;
}

/**
 * Validates the bytes actually stored, then renames into place.
 *
 * Validation reads the *copy*, not the source: the source may have changed between the
 * copy and now, and it is the copy the user will keep.
 */
async function finalise(
  storage: StorageAdapter,
  options: ImportOptions,
  context: FinaliseContext,
): Promise<ImportResult> {
  const { partialPath, filePath, base, maxBytes } = context;

  try {
    const stat = await storage.stat(partialPath);
    if (!stat) {
      await safeRemove(storage, partialPath);
      return { ok: false, reason: 'unreadable', message: 'The file could not be read.' };
    }
    if (stat.sizeBytes < MIN_PDF_BYTES) {
      await safeRemove(storage, partialPath);
      return { ok: false, reason: 'empty', message: 'That file is empty or too small to be a PDF.' };
    }
    if (stat.sizeBytes > maxBytes) {
      await safeRemove(storage, partialPath);
      return {
        ok: false,
        reason: 'too_large',
        message: `That PDF is ${Math.round(stat.sizeBytes / 1024 / 1024)} MB. The limit is ${Math.round(maxBytes / 1024 / 1024)} MB.`,
      };
    }

    const bytes = await storage.readAll(partialPath);
    if (!hasPdfMagic(bytes)) {
      await safeRemove(storage, partialPath);
      return {
        ok: false,
        reason: 'not_a_pdf',
        message: "That file doesn't start like a PDF. It may be damaged or renamed.",
      };
    }

    const facts = readDocumentFacts(bytes);
    if (!facts) {
      await safeRemove(storage, partialPath);
      return { ok: false, reason: 'not_a_pdf', message: 'That PDF could not be read.' };
    }
    if (facts.encrypted) {
      await safeRemove(storage, partialPath);
      return {
        ok: false,
        reason: 'encrypted',
        message: 'That PDF is password protected. Remove the password and try again.',
      };
    }
    if (facts.pageCount === 0) {
      await safeRemove(storage, partialPath);
      return { ok: false, reason: 'no_pages', message: 'That PDF has no readable pages.' };
    }

    // ---- 4. Atomic rename into place ----------------------------------------
    await storage.move(partialPath, filePath);

    return {
      ok: true,
      filePath,
      // Prefer the document's own title; fall back to the filename.
      title: options.title?.trim() || facts.title || base,
      author: facts.author,
      pageCount: facts.pageCount,
      sizeBytes: stat.sizeBytes,
      pdfVersion: facts.pdfVersion,
    };
  } catch (error) {
    await safeRemove(storage, partialPath);
    logger.error('Failed to validate or finalise a PDF import', error);
    return copyFailure(error);
  }
}

/**
 * Removes orphaned `.part` files.
 *
 * Called once per launch. These only exist when a previous import was interrupted, and
 * leaving them would slowly fill the user's storage with unusable bytes.
 */
export async function cleanupInterruptedImports(storage: StorageAdapter): Promise<number> {
  let removed = 0;
  try {
    const entries = await storage.list(BOOKS_DIRECTORY);
    for (const name of entries) {
      if (!name.endsWith(PARTIAL_SUFFIX)) continue;
      await safeRemove(storage, `${BOOKS_DIRECTORY}/${name}`);
      removed += 1;
    }
  } catch (error) {
    // Never let cleanup block launch.
    logger.warn('Could not sweep interrupted PDF imports', error);
  }
  if (removed > 0) logger.info(`Removed ${removed} interrupted PDF import(s)`);
  return removed;
}

/** Bytes consumed by partially imported PDFs. Surfaced in Settings. */
export async function pendingImportBytes(storage: StorageAdapter): Promise<number> {
  try {
    const entries = await storage.list(BOOKS_DIRECTORY);
    let total = 0;
    for (const name of entries) {
      if (!name.endsWith(PARTIAL_SUFFIX)) continue;
      const stat = await storage.stat(`${BOOKS_DIRECTORY}/${name}`);
      total += stat?.sizeBytes ?? 0;
    }
    return total;
  } catch {
    return 0;
  }
}
