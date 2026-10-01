/**
 * The real `ExpoStorageAdapter`, exercised against a fake `expo-file-system`.
 *
 * The point of this file is that the adapter's own logic — path joining, creating
 * parents, mapping native errors, and not reading an entire PDF to check four magic
 * bytes — is covered off-device. The fake implements the SDK 57 object API, so the code
 * under test is the code that ships.
 */

import { ExpoStorageAdapter, classify } from '@/platform/storage/expoStorage';
import { StorageError } from '@/platform/storage/types';
import { fsControl } from '../support/expoFileSystemStub';
import { buildPdfBytes } from '../support/pdfFixture';

const DOCS = 'file:///documents';
let storage: ExpoStorageAdapter;

beforeEach(() => {
  fsControl.reset();
  storage = new ExpoStorageAdapter();
});

describe('paths', () => {
  it('resolves a relative path inside the documents directory', () => {
    expect(storage.resolve('books/deep-work.pdf')).toBe(`${DOCS}/books/deep-work.pdf`);
  });

  it('refuses a path that escapes the documents directory', () => {
    expect(() => storage.resolve('../../databases/app.db')).toThrow(StorageError);
    expect(() => storage.resolve('/etc/passwd')).toThrow(StorageError);
  });
});

describe('files', () => {
  it('reports a missing file as absent rather than throwing', async () => {
    expect(await storage.exists('books/nope.pdf')).toBe(false);
    expect(await storage.stat('books/nope.pdf')).toBeNull();
  });

  it('writes and reads a file', async () => {
    await storage.write('books/notes.txt', new TextEncoder().encode('hello'));

    expect(await storage.exists('books/notes.txt')).toBe(true);
    expect(await storage.readAll('books/notes.txt')).toEqual(new TextEncoder().encode('hello'));
    expect((await storage.stat('books/notes.txt'))?.sizeBytes).toBe(5);
  });

  it('creates missing parent directories when writing', async () => {
    await storage.write('books/deep/nested/book.pdf', new Uint8Array([1, 2, 3]));

    expect(fsControl.entries()).toContain(`${DOCS}/books`);
    expect(fsControl.entries()).toContain(`${DOCS}/books/deep/nested`);
  });

  it('overwrites an existing file on write', async () => {
    await storage.write('books/a.txt', new TextEncoder().encode('first'));
    await storage.write('books/a.txt', new TextEncoder().encode('two'));

    expect(await storage.readAll('books/a.txt')).toEqual(new TextEncoder().encode('two'));
  });

  it('reads only the requested head, not the whole file', async () => {
    await storage.write('books/deep-work.pdf', buildPdfBytes({ pageCount: 3 }));

    // A large document must not be loaded into memory to check its magic number.
    const head = await storage.readHead('books/deep-work.pdf', 4);
    expect(new TextDecoder().decode(head)).toBe('%PDF');
    expect(head.length).toBe(4);
  });

  it('treats removing an absent file as success', async () => {
    await expect(storage.remove('books/never-existed.pdf')).resolves.toBeUndefined();
  });

  it('removes a file that exists', async () => {
    await storage.write('books/a.txt', new Uint8Array([1]));
    await storage.remove('books/a.txt');
    expect(await storage.exists('books/a.txt')).toBe(false);
  });
});

describe('directories', () => {
  it('returns an empty list for a directory that does not exist yet', async () => {
    // A fresh install has no books folder; that is not an error.
    expect(await storage.list('books')).toEqual([]);
  });

  it('is idempotent when ensuring a directory', async () => {
    await storage.ensureDirectory('books');
    await expect(storage.ensureDirectory('books')).resolves.toBeUndefined();
  });

  it('lists direct children in sorted order', async () => {
    await storage.write('books/b.pdf', new Uint8Array([1]));
    await storage.write('books/a.pdf', new Uint8Array([1]));
    await storage.write('books/nested/deep.pdf', new Uint8Array([1]));

    expect(await storage.list('books')).toEqual(['a.pdf', 'b.pdf', 'nested']);
  });
});
describe('copying and moving', () => {
  it('copies a picked document into app storage', async () => {
    fsControl.seed('content://provider/book.pdf', buildPdfBytes());

    await storage.copyFromUri('content://provider/book.pdf', 'books/book.pdf');

    expect(await storage.exists('books/book.pdf')).toBe(true);
  });

  it('overwrites the destination on a retried import', async () => {
    fsControl.seed('content://provider/book.pdf', buildPdfBytes());
    await storage.write('books/book.pdf', new Uint8Array([9, 9, 9]));

    await storage.copyFromUri('content://provider/book.pdf', 'books/book.pdf');

    expect((await storage.stat('books/book.pdf'))?.sizeBytes).toBeGreaterThan(3);
  });

  it('moves a file without leaving the source behind', async () => {
    await storage.write('books/book.pdf.part', new TextEncoder().encode('payload'));

    await storage.move('books/book.pdf.part', 'books/book.pdf');

    expect(await storage.exists('books/book.pdf.part')).toBe(false);
    expect(await storage.exists('books/book.pdf')).toBe(true);
  });

  it('surfaces a missing source as NOT_FOUND', async () => {
    await expect(storage.copyFromUri('content://gone.pdf', 'books/gone.pdf')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('surfaces a full disk as NOT_ENOUGH_SPACE', async () => {
    fsControl.setFreeSpace(4);
    await expect(storage.write('books/big.pdf', new Uint8Array(1024))).rejects.toMatchObject({
      code: 'NOT_ENOUGH_SPACE',
    });
  });
});

describe('free space', () => {
  it('reports the available bytes when the platform provides them', async () => {
    fsControl.setFreeSpace(1234);
    expect(await storage.freeSpaceBytes()).toBe(1234);
  });
});

describe('error classification', () => {
  const cases: [string, string][] = [
    ['No space left on device', 'NOT_ENOUGH_SPACE'],
    ['ENOSPC: no space left', 'NOT_ENOUGH_SPACE'],
    ['No such file or directory', 'NOT_FOUND'],
    ['ENOENT: no such file', 'NOT_FOUND'],
    ['EACCES: permission denied', 'PERMISSION'],
    ['Operation not permitted', 'PERMISSION'],
    ['Something entirely unexpected', 'IO'],
  ];

  it.each(cases)('maps "%s" to %s', (message, code) => {
    expect(classify(new Error(message), 'books/a.pdf').code).toBe(code);
  });

  it('never invents a specific code for an unknown failure', () => {
    // A generic failure must degrade to IO, not a confident "out of space".
    expect(classify(new Error('the widget exploded'), 'a.pdf').code).toBe('IO');
  });

  it('passes an existing StorageError through unchanged', () => {
    const original = new StorageError('already typed', 'PERMISSION');
    expect(classify(original, 'a.pdf')).toBe(original);
  });

  it('preserves the original message as the cause', () => {
    const cause = new Error('disk gremlin');
    expect(classify(cause, 'a.pdf').cause).toBe(cause);
  });

  it('handles a thrown non-Error', () => {
    expect(classify('a string', 'a.pdf').code).toBe('IO');
  });
});

describe('a file deleted behind the app', () => {
  it('reports the book as missing rather than corrupting the reader', async () => {
    await storage.write('books/deep-work.pdf', buildPdfBytes({ pageCount: 4 }));

    // The user deletes the PDF from the Files app.
    fsControl.removeSilently(`${DOCS}/books/deep-work.pdf`);

    expect(await storage.exists('books/deep-work.pdf')).toBe(false);
    expect(await storage.stat('books/deep-work.pdf')).toBeNull();
  });
});

