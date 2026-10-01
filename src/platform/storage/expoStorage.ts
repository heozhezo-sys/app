/**
 * `StorageAdapter` for iOS and Android, backed by `expo-file-system`.
 *
 * Uses the SDK 57 object API (`File` / `Directory` / `Paths`) rather than the legacy
 * functional one. Every method is wrapped in `async` so the interface stays
 * promise-based and the in-memory test adapter remains a drop-in substitute.
 *
 * **On error classification.** `expo-file-system` surfaces native failures as plain
 * `Error`s with platform-specific messages. `classify` maps them onto `StorageError`
 * codes by inspecting the message, which is inherently approximate. It is deliberately
 * conservative: anything unrecognised becomes `IO` rather than being forced into a
 * specific code, so a surprising failure degrades to a generic error the user can act
 * on instead of a confidently wrong "not enough space".
 */

import { Directory, File, FileMode, Paths } from 'expo-file-system';

import {
  StorageError,
  assertSafeRelativePath,
  type FileStat,
  type RelativePath,
  type StorageAdapter,
} from './types';

export class ExpoStorageAdapter implements StorageAdapter {
  constructor(private readonly root: Directory = Paths.document) {}

  get documentsDir(): string {
    return this.root.uri;
  }

  resolve(relative: RelativePath): string {
    return `${this.root.uri}/${assertSafeRelativePath(relative)}`;
  }

  private file(relative: RelativePath): File {
    return new File(this.resolve(relative));
  }

  private directory(relative: RelativePath): Directory {
    return new Directory(relative === '' ? this.root.uri : this.resolve(relative));
  }

  async exists(relative: RelativePath): Promise<boolean> {
    return this.file(relative).exists;
  }

  async stat(relative: RelativePath): Promise<FileStat | null> {
    try {
      const file = this.file(relative);
      if (!file.exists) return null;
      return {
        sizeBytes: file.size,
        // A null modification time is legitimate on some providers; the value is only
        // used for display, so a stable fallback beats failing the stat.
        modifiedAt: file.modificationTime ?? 0,
      };
    } catch (error) {
      throw classify(error, relative);
    }
  }

  /**
   * Entry names in a directory.
   *
   * A missing directory yields `[]` rather than throwing: "the books folder does not
   * exist yet" is the normal state of a fresh install, not an error.
   */
  async list(relative: RelativePath): Promise<string[]> {
    try {
      const directory = this.directory(relative);
      if (!directory.exists) return [];
      return directory
        .list()
        .map((entry) => entry.name)
        .filter((name) => name !== '')
        .sort();
    } catch (error) {
      throw classify(error, relative);
    }
  }

  /** Idempotent: safe to call on every import and on launch. */
  async ensureDirectory(relative: RelativePath): Promise<void> {
    if (relative === '') return;
    try {
      this.directory(relative).create({ intermediates: true, idempotent: true });
    } catch (error) {
      throw classify(error, relative);
    }
  }

  /**
   * Copies a picked document into app storage.
   *
   * Handles both `file://` and Android `content://` URIs, because the document picker
   * returns the latter on Android.
   */
  async copyFromUri(sourceUri: string, toRelative: RelativePath): Promise<void> {
    try {
      await this.parentOf(toRelative);
      // `overwrite` is the only relocation option; the SDK has no `idempotent` here.
      // Retrying an import therefore overwrites the previous attempt's partial file
      // rather than failing on "destination already exists".
      await new File(sourceUri).copy(this.file(toRelative), { overwrite: true });
    } catch (error) {
      throw classify(error, toRelative);
    }
  }

  async copy(fromRelative: RelativePath, toRelative: RelativePath): Promise<void> {
    try {
      await this.parentOf(toRelative);
      await this.file(fromRelative).copy(this.file(toRelative), { overwrite: true });
    } catch (error) {
      throw classify(error, fromRelative);
    }
  }
  /**
   * Native rename within the documents volume.
   *
   * This is the operation the whole import design depends on: it is atomic, so the
   * final filename never exists with partial contents. See ADR-0017.
   */
  async move(fromRelative: RelativePath, toRelative: RelativePath): Promise<void> {
    try {
      await this.parentOf(toRelative);
      await this.file(fromRelative).move(this.file(toRelative), { overwrite: true });
    } catch (error) {
      throw classify(error, fromRelative);
    }
  }

  /** Deleting something already gone is a success, not an error. */
  async remove(relative: RelativePath): Promise<void> {
    try {
      const file = this.file(relative);
      if (file.exists) file.delete();
    } catch (error) {
      throw classify(error, relative);
    }
  }

  /**
   * Reads the first `count` bytes without loading the whole file.
   *
   * Matters for PDFs: a 200 MB document must not be read into memory just to check its
   * magic number.
   */
  async readHead(relative: RelativePath, count: number): Promise<Uint8Array> {
    try {
      const handle = this.file(relative).open(FileMode.ReadOnly);
      try {
        return handle.readBytes(Math.max(0, count));
      } finally {
        handle.close();
      }
    } catch (error) {
      throw classify(error, relative);
    }
  }

  async readAll(relative: RelativePath): Promise<Uint8Array> {
    try {
      return await this.file(relative).bytes();
    } catch (error) {
      throw classify(error, relative);
    }
  }

  async write(relative: RelativePath, data: Uint8Array): Promise<void> {
    try {
      await this.parentOf(relative);
      const file = this.file(relative);
      file.create({ intermediates: true, overwrite: true });
      file.write(data);
    } catch (error) {
      throw classify(error, relative);
    }
  }

  /**
   * Free bytes on the documents volume.
   *
   * Returns `null` if the platform does not report it, so callers skip the preflight
   * rather than acting on a fabricated number.
   */
  async freeSpaceBytes(): Promise<number | null> {
    try {
      const available = Paths.availableDiskSpace;
      return typeof available === 'number' && Number.isFinite(available) ? available : null;
    } catch {
      return null;
    }
  }

  private async parentOf(relative: RelativePath): Promise<void> {
    const normalised = assertSafeRelativePath(relative);
    const index = normalised.lastIndexOf('/');
    if (index <= 0) return;
    await this.ensureDirectory(normalised.slice(0, index));
  }
}

/**
 * Maps a native filesystem error onto a `StorageError`.
 *
 * Message matching is unavoidable here because the native modules throw untyped
 * errors. Checks are ordered most-specific first, and anything unrecognised is reported
 * as `IO` with the original message preserved so a log can still diagnose it.
 */
export function classify(error: unknown, path: string): StorageError {
  if (error instanceof StorageError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('no space') || lower.includes('enospc') || lower.includes('disk full')) {
    return new StorageError('Not enough free space', 'NOT_ENOUGH_SPACE', error);
  }
  if (
    lower.includes('no such file') ||
    lower.includes('enoent') ||
    lower.includes('does not exist') ||
    lower.includes('not exist')
  ) {
    return new StorageError(`${path} was not found`, 'NOT_FOUND', error);
  }
  if (
    lower.includes('permission') ||
    lower.includes('eacces') ||
    lower.includes('eperm') ||
    lower.includes('not permitted')
  ) {
    return new StorageError(`No permission to access ${path}`, 'PERMISSION', error);
  }
  if (lower.includes('invalid path') || lower.includes('einval')) {
    return new StorageError(`${path} is not a valid path`, 'INVALID_PATH', error);
  }
  return new StorageError(`Filesystem error on ${path}: ${message}`, 'IO', error);
}
