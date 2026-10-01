/**
 * In-memory stand-in for `expo-file-system`, mirroring the SDK 57 object API.
 *
 * `expo-file-system` is a native module and cannot load in Node, exactly like
 * `expo-sqlite`. The adapter's logic — path joining, parent creation, error
 * classification, not reading a whole PDF to check its magic number — is worth testing,
 * so this fake implements the same surface rather than skipping the file.
 *
 * Test-only. Never imported by application code.
 */

type CreateOptions = { intermediates?: boolean; overwrite?: boolean; idempotent?: boolean };

interface Entry {
  bytes: Uint8Array;
  isDirectory: boolean;
  modifiedAt: number;
}

/** Stored entries, keyed by absolute URI without a trailing slash. */
const store = new Map<string, Entry>();

let clock = 1_767_225_600_000;
let availableDiskSpace = 8 * 1024 * 1024 * 1024;
const failures: { operation: string; message: string }[] = [];

/** Test controls. */
export const fsControl = {
  reset(): void {
    store.clear();
    clock = 1_767_225_600_000;
    availableDiskSpace = 8 * 1024 * 1024 * 1024;
    failures.length = 0;
  },
  /** Makes the next matching operation throw, once. */
  failOn(operation: string, message: string): void {
    failures.push({ operation, message });
  },
  setFreeSpace(bytes: number): void {
    availableDiskSpace = bytes;
  },
  /** Plants a file, as a previous import would have left behind. */
  seed(uri: string, bytes: Uint8Array): void {
    store.set(normalise(uri), { bytes, isDirectory: false, modifiedAt: clock });
  },
  entries(): string[] {
    return [...store.keys()].sort();
  },
  /** Removes a file behind the app's back, as if the user deleted it in Files. */
  removeSilently(uri: string): void {
    store.delete(normalise(uri));
  },
};

function maybeFail(operation: string): void {
  const index = failures.findIndex((failure) => failure.operation === operation);
  if (index < 0) return;
  const failure = failures[index];
  failures.splice(index, 1);
  throw new Error(failure?.message ?? 'filesystem failure');
}

function normalise(uri: string): string {
  return uri.replace(/\/+$/, '');
}

/**
 * Joins URI parts without collapsing the `//` in a scheme.
 *
 * A naive `replace(/\/{2,}/g, '/')` turns `file:///documents` into `file://documents`,
 * which is a different path. Only a slash that follows a non-slash, non-colon character
 * is a genuine duplicate.
 */
function join(...parts: (string | File | Directory)[]): string {
  return normalise(
    parts
      .map((part) => (typeof part === 'string' ? part : part.uri))
      .join('/')
      .replace(/(?<![:/])\/{2,}/g, '/'),
  );
}

abstract class Native {
  readonly uri: string;
  exists: boolean;
  size: number;
  modificationTime: number | null = null;

  constructor(uri: string) {
    this.uri = normalise(uri);
    const entry = store.get(this.uri);
    this.exists = entry !== undefined;
    this.size = entry && !entry.isDirectory ? entry.bytes.length : 0;
    if (entry) this.modificationTime = entry.modifiedAt;
  }

  get name(): string {
    return this.uri.split('/').pop() ?? '';
  }
}

export class FileHandle {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  readBytes(length: number): Uint8Array {
    const slice = this.bytes.slice(this.offset, this.offset + length);
    this.offset += slice.length;
    return slice;
  }

  writeBytes(bytes: Uint8Array): void {
    this.bytes.set(bytes, this.offset);
    this.offset += bytes.length;
  }

  close(): void {
    this.offset = 0;
  }
}

export class File extends Native {
  constructor(...uris: (string | File | Directory)[]) {
    super(join(...uris));
  }

  create(options: CreateOptions = {}): void {
    maybeFail('create');
    if (store.has(this.uri) && !options.overwrite && !options.idempotent) {
      throw new Error(`File already exists: ${this.uri}`);
    }
    if (options.intermediates) this.ensureParents();
    store.set(this.uri, { bytes: new Uint8Array(0), isDirectory: false, modifiedAt: clock });
    this.exists = true;
    this.size = 0;
  }

  delete(): void {
    maybeFail('delete');
    store.delete(this.uri);
    this.exists = false;
  }

  async copy(destination: File | Directory, options: { overwrite?: boolean } = {}): Promise<void> {
    maybeFail('copy');
    const source = store.get(this.uri);
    if (!source) throw new Error(`No such file: ${this.uri}`);
    if (store.has(destination.uri) && !options.overwrite) {
      throw new Error(`Destination already exists: ${destination.uri}`);
    }
    store.set(destination.uri, {
      bytes: source.bytes.slice(),
      isDirectory: false,
      modifiedAt: clock,
    });
  }

  /** A real rename, so the destination never holds partial contents. */
  async move(destination: File | Directory, options: { overwrite?: boolean } = {}): Promise<void> {
    maybeFail('move');
    const source = store.get(this.uri);
    if (!source) throw new Error(`No such file: ${this.uri}`);
    if (store.has(destination.uri) && !options.overwrite) {
      throw new Error(`Destination already exists: ${destination.uri}`);
    }
    store.delete(this.uri);
    store.set(destination.uri, { bytes: source.bytes, isDirectory: false, modifiedAt: clock });
  }

  async bytes(): Promise<Uint8Array> {
    maybeFail('bytes');
    const entry = store.get(this.uri);
    if (!entry) throw new Error(`No such file: ${this.uri}`);
    return entry.bytes.slice();
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(await this.bytes());
  }

  write(content: string | Uint8Array): void {
    maybeFail('write');
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    if (bytes.length > availableDiskSpace) {
      throw new Error('No space left on device');
    }
    availableDiskSpace -= bytes.length;
    store.set(this.uri, { bytes, isDirectory: false, modifiedAt: clock });
    this.size = bytes.length;
  }

  open(_mode: string): FileHandle {
    maybeFail('open');
    const entry = store.get(this.uri);
    if (!entry) throw new Error(`No such file: ${this.uri}`);
    return new FileHandle(entry.bytes);
  }

  private ensureParents(): void {
    for (const parent of parentUris(this.uri)) {
      if (!store.has(parent)) {
        store.set(parent, { bytes: new Uint8Array(0), isDirectory: true, modifiedAt: clock });
      }
    }
  }
}

/**
 * Ancestor URIs of a file, outermost first.
 *
 * Built by slicing the URI rather than concatenating segments, so a `file:///...` scheme
 * is preserved instead of being turned into `///...`.
 */
function parentUris(uri: string): string[] {
  const segments = uri.split('/');
  // A `file:///a/b` URI splits as ['file:', '', '', 'a', 'b']; drop the scheme and the
  // two empty segments that follow it, keeping the leading empty segment for the root.
  const out: string[] = [];
  for (let i = 1; i < segments.length - 1; i += 1) {
    out.push(segments.slice(0, i + 1).join('/'));
  }
  return out;
}

export class Directory extends Native {
  constructor(...uris: (string | File | Directory)[]) {
    super(join(...uris));
  }

  create(options: CreateOptions = {}): void {
    maybeFail('mkdir');
    if (store.has(this.uri) && !options.overwrite && !options.idempotent) {
      throw new Error(`Directory already exists: ${this.uri}`);
    }
    if (options.intermediates) {
      // `parentUris` excludes the directory itself, so create it last.
      for (const uri of [...parentUris(this.uri), this.uri]) {
        const existing = store.get(uri);
        if (existing && !existing.isDirectory) {
          throw new Error(`A file already exists at ${uri}`);
        }
        if (!existing) {
          store.set(uri, { bytes: new Uint8Array(0), isDirectory: true, modifiedAt: clock });
        }
      }
      return;
    }
    store.set(this.uri, { bytes: new Uint8Array(0), isDirectory: true, modifiedAt: clock });
  }

  delete(): void {
    maybeFail('rmdir');
    store.delete(this.uri);
    this.exists = false;
  }

  list(): (File | Directory)[] {
    maybeFail('readdir');
    if (!store.has(this.uri)) throw new Error(`No such directory: ${this.uri}`);
    const prefix = `${this.uri}/`;
    const out: (File | Directory)[] = [];
    for (const key of store.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      // Direct children only: a grandchild is not a list() result.
      if (rest === '' || rest.includes('/')) continue;
      out.push(store.get(key)?.isDirectory ? new Directory(key) : new File(key));
    }
    return out;
  }

  createDirectory(name: string): Directory {
    return new Directory(this.uri, name);
  }

  createFile(name: string, _mimeType: string | null): File {
    return new File(this.uri, name);
  }
}

export const Paths = {
  get document(): Directory {
    return new Directory('file:///documents');
  },
  get cache(): Directory {
    return new Directory('file:///cache');
  },
  get availableDiskSpace(): number {
    return availableDiskSpace;
  },
  get totalDiskSpace(): number {
    return 256 * 1024 * 1024 * 1024;
  },
};

export const FileMode = {
  ReadWrite: 'rw',
  ReadOnly: 'r',
  WriteOnly: 'w',
  Append: 'wa',
} as const;
