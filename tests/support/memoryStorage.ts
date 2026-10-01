/**
 * In-memory storage adapter, for tests.
 *
 * Backed by a Map rather than a real filesystem so a test can simulate things that
 * are otherwise impossible on demand: a file deleted by another app, a full disk, an
 * import killed half way through, a renamed file.
 *
 * Never imported by application code.
 */

import {
  StorageError,
  assertSafeRelativePath,
  type FileStat,
  type RelativePath,
  type StorageAdapter,
} from '../../src/platform/storage/types';

interface Entry {
  data: Uint8Array;
  modifiedAt: number;
  isDirectory: boolean;
}

export interface MemoryStorageOptions {
  /** Bytes reported as free. `null` means "unknown", which skips the preflight. */
  freeSpaceBytes?: number | null;
  /** Fixed clock so modified timestamps are deterministic. */
  now?: () => number;
}

export class MemoryStorageAdapter implements StorageAdapter {
  readonly documentsDir = '/memory/documents';

  private readonly entries = new Map<string, Entry>();
  private free: number | null;
  private readonly now: () => number;
  /** Every path ever written, in order. Lets tests assert on the import sequence. */
  readonly writeLog: string[] = [];

  constructor(options: MemoryStorageOptions = {}) {
    this.free =
      options.freeSpaceBytes === undefined ? Number.POSITIVE_INFINITY : options.freeSpaceBytes;
    this.now = options.now ?? (() => 1_767_225_600_000);
  }

  resolve(relative: RelativePath): string {
    return `${this.documentsDir}/${assertSafeRelativePath(relative)}`;
  }

  private key(relative: RelativePath): string {
    return assertSafeRelativePath(relative);
  }

  async exists(relative: RelativePath): Promise<boolean> {
    return this.entries.has(this.key(relative));
  }

  async stat(relative: RelativePath): Promise<FileStat | null> {
    const entry = this.entries.get(this.key(relative));
    if (!entry || entry.isDirectory) return null;
    return { sizeBytes: entry.data.length, modifiedAt: entry.modifiedAt };
  }

  async list(directory: RelativePath): Promise<string[]> {
    const prefix = directory === '' ? '' : `${this.key(directory)}/`;
    const names = new Set<string>();
    for (const key of this.entries.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest === '') continue;
      names.add(rest.split('/')[0] ?? '');
    }
    return [...names].filter(Boolean).sort();
  }

  async ensureDirectory(relative: RelativePath): Promise<void> {
    if (relative === '') return;
    let current = '';
    for (const segment of this.key(relative).split('/')) {
      current = current === '' ? segment : `${current}/${segment}`;
      if (!this.entries.has(current)) {
        this.entries.set(current, { data: new Uint8Array(0), modifiedAt: this.now(), isDirectory: true });
      }
    }
  }

  async copyFromUri(sourceUri: string, toRelative: RelativePath): Promise<void> {
    // A picker hands back a URI with a scheme (`file://`, `content://`,
    // `picked://`); only the path part identifies the file in this store.
    const path = sourceUri
      .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
      .replace(/^\/memory\/documents\//, '')
      .replace(/^\/+/, '');

    const source = this.entries.get(path);
    if (!source || source.isDirectory) {
      throw new StorageError(`Source not found: ${sourceUri}`, 'NOT_FOUND');
    }
    await this.write(toRelative, source.data);
  }

  async copy(fromRelative: RelativePath, toRelative: RelativePath): Promise<void> {
    const source = this.entries.get(this.key(fromRelative));
    if (!source || source.isDirectory) {
      throw new StorageError(`Not found: ${fromRelative}`, 'NOT_FOUND');
    }
    await this.write(toRelative, source.data);
  }

  async move(fromRelative: RelativePath, toRelative: RelativePath): Promise<void> {
    const from = this.key(fromRelative);
    const entry = this.entries.get(from);
    if (!entry || entry.isDirectory) {
      throw new StorageError(`Not found: ${fromRelative}`, 'NOT_FOUND');
    }
    this.entries.delete(from);
    await this.write(toRelative, entry.data);
  }

  async remove(relative: RelativePath): Promise<void> {
    this.entries.delete(this.key(relative));
  }

  async readHead(relative: RelativePath, count: number): Promise<Uint8Array> {
    const entry = this.entries.get(this.key(relative));
    if (!entry || entry.isDirectory) {
      throw new StorageError(`Not found: ${relative}`, 'NOT_FOUND');
    }
    return entry.data.slice(0, count);
  }

  async readAll(relative: RelativePath): Promise<Uint8Array> {
    const entry = this.entries.get(this.key(relative));
    if (!entry || entry.isDirectory) {
      throw new StorageError(`Not found: ${relative}`, 'NOT_FOUND');
    }
    return entry.data;
  }

  async write(relative: RelativePath, data: Uint8Array): Promise<void> {
    const key = this.key(relative);
    const parent = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : '';
    if (parent !== '') await this.ensureDirectory(parent);

    if (this.free !== null && data.length > this.free) {
      throw new StorageError('Not enough free space to save the file', 'NOT_ENOUGH_SPACE');
    }
    if (this.free !== null) this.free -= data.length;

    this.entries.set(key, { data, modifiedAt: this.now(), isDirectory: false });
    this.writeLog.push(key);
  }

  async freeSpaceBytes(): Promise<number | null> {
    return Number.isFinite(this.free) ? this.free : null;
  }
/* ----------------------------------------------------- test-only controls */

  /** Plants a file without going through the free-space check. */
  seedFile(relative: RelativePath, data: Uint8Array): void {
    const key = this.key(relative);
    this.entries.set(key, { data, modifiedAt: this.now(), isDirectory: false });
  }

  /** Removes a file behind the app's back, as if the user deleted it in Files. */
  simulateExternalDelete(relative: RelativePath): void {
    this.entries.delete(this.key(relative));
  }

  /** Renames a file outside the app, as if the user moved it. */
  simulateExternalMove(fromRelative: RelativePath, toRelative: RelativePath): void {
    const entry = this.entries.get(this.key(fromRelative));
    if (!entry) return;
    this.entries.delete(this.key(fromRelative));
    this.entries.set(this.key(toRelative), entry);
  }

  setFreeSpace(bytes: number | null): void {
    this.free = bytes;
  }

  /** Total bytes currently stored. */
  totalBytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) {
      if (!entry.isDirectory) total += entry.data.length;
    }
    return total;
  }
}

/** Latin-1 encode/decode, matching how PDF strings are byte-oriented. */
export function latin1Encode(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

export function latin1Decode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i] ?? 0);
  return out;
}

/** UTF-8 encode for test fixtures. */
export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

