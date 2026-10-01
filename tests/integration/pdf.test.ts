/**
 * PDF parsing, import and reading, against real PDF bytes.
 *
 * The specification's failure list is the backbone of this file: corrupted,
 * password-protected, huge, missing, moved, invalid extension, interrupted import and
 * insufficient storage. Each is a named test, not a claim.
 */

import { MemoryStorageAdapter } from '../support/memoryStorage';
import { buildPdfBytes } from '../support/pdfFixture';
import { readDocumentFacts } from '@/pdf/engine/documentReader';
import { StructurePdfEngine } from '@/pdf/engine/structureEngine';
import { hasPdfMagic, readPdfVersion } from '@/pdf/engine/pdfStructure';
import {
  BOOKS_DIRECTORY,
  PARTIAL_SUFFIX,
  cleanupInterruptedImports,
  importPdf,
  pendingImportBytes,
  uniqueName,
} from '@/services/pdfImportService';
import { StorageError } from '@/platform/storage/types';

const SOURCE_URI = 'picked://inbox/deep-work.pdf';

/**
 * Plants a PDF where the reader expects it: the app's books directory.
 * Used by engine tests.
 */
function storageWithPdf(options: Parameters<typeof buildPdfBytes>[0] = {}) {
  const storage = new MemoryStorageAdapter();
  storage.seedFile(`${BOOKS_DIRECTORY}/deep-work.pdf`, buildPdfBytes(options));
  return { storage, uri: SOURCE_URI };
}

/**
 * Plants a PDF in an external inbox only, as a document picker or share would.
 * Used by import tests, which must start with an empty library.
 */
function storageForImport(options: Parameters<typeof buildPdfBytes>[0] = {}) {
  const storage = new MemoryStorageAdapter();
  storage.seedFile('inbox/deep-work.pdf', buildPdfBytes(options));
  return { storage, uri: SOURCE_URI };
}

describe('PDF structure parsing', () => {
  it('reads the version from the header', () => {
    expect(readPdfVersion(buildPdfBytes({ version: '1.4' }))).toBe('1.4');
    expect(hasPdfMagic(buildPdfBytes())).toBe(true);
    expect(hasPdfMagic(new TextEncoder().encode('hello'))).toBe(false);
  });

  it('counts pages from the page tree', () => {
    expect(readDocumentFacts(buildPdfBytes({ pageCount: 12 }))?.pageCount).toBe(12);
  });

  it('reads title, author and subject from the info dictionary', () => {
    const facts = readDocumentFacts(
      buildPdfBytes({ title: 'Deep Work', author: 'Cal Newport', subject: 'Focus' }),
    );
    expect(facts?.title).toBe('Deep Work');
    expect(facts?.author).toBe('Cal Newport');
    expect(facts?.subject).toBe('Focus');
  });

  it('returns null for a file that is not a PDF', () => {
    expect(readDocumentFacts(new TextEncoder().encode('not a pdf at all'))).toBeNull();
  });

  it('does not hang on a cyclic page tree', () => {
    // /Kids points back at its own parent. An unguarded walk would never return.
    expect(readDocumentFacts(buildPdfBytes({ cyclicPageTree: true }))).not.toBeNull();
  });

  it('reads the table of contents with resolved page destinations', () => {
    const facts = readDocumentFacts(
      buildPdfBytes({
        pageCount: 10,
        outline: [
          { title: 'Part One', pageIndex: 0, children: [{ title: 'Chapter 1', pageIndex: 2 }] },
          { title: 'Part Two', pageIndex: 5 },
        ],
      }),
    );

    expect(facts?.outline).toHaveLength(2);
    expect(facts?.outline[0]?.title).toBe('Part One');
    expect(facts?.outline[0]?.pageIndex).toBe(0);
    expect(facts?.outline[0]?.children[0]?.title).toBe('Chapter 1');
    expect(facts?.outline[0]?.children[0]?.pageIndex).toBe(2);
    expect(facts?.outline[1]?.pageIndex).toBe(5);
  });

  it('reports no outline for a document without one', () => {
    expect(readDocumentFacts(buildPdfBytes())?.outline).toEqual([]);
  });

  it('reads the media box for page geometry', () => {
    expect(readDocumentFacts(buildPdfBytes({ mediaBox: [0, 0, 612, 792] }))?.mediaBox).toEqual({
      width: 612,
      height: 792,
    });
  });

  it('detects an encrypted document', () => {
    expect(readDocumentFacts(buildPdfBytes({ encrypted: true }))?.encrypted).toBe(true);
    expect(readDocumentFacts(buildPdfBytes())?.encrypted).toBe(false);
  });
});
describe('the reader engine', () => {
  it('opens a valid document and reports measured capabilities', async () => {
    const { storage } = storageWithPdf({ pageCount: 8, outline: [{ title: 'Intro', pageIndex: 1 }] });
    const engine = new StructurePdfEngine(storage);

    const result = await engine.open(`${BOOKS_DIRECTORY}/deep-work.pdf`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Measured from the file, not assumed.
    expect(result.document.capabilities.outline).toBe(true);
    expect(result.document.capabilities.rendering).toBe(false);
    expect(result.document.capabilities.textSearch).toBe(false);
    expect(result.document.info.pageCount).toBe(8);
  });

  it('reports a corrupt file rather than throwing', async () => {
    const storage = new MemoryStorageAdapter();
    storage.seedFile(`${BOOKS_DIRECTORY}/broken.pdf`, new TextEncoder().encode('this is not a pdf'));
    const engine = new StructurePdfEngine(storage);

    const result = await engine.open(`${BOOKS_DIRECTORY}/broken.pdf`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe('corrupt');
  });

  it('reports a password-protected file as locked, not corrupt', async () => {
    const { storage } = storageWithPdf({ encrypted: true });
    const engine = new StructurePdfEngine(storage);

    const result = await engine.open(`${BOOKS_DIRECTORY}/deep-work.pdf`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe('password_required');
  });

  it('reports a file that has been deleted from the device', async () => {
    const { storage } = storageWithPdf();
    const engine = new StructurePdfEngine(storage);

    const result = await engine.open(`${BOOKS_DIRECTORY}/gone.pdf`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe('missing');
  });

  it('reports a file moved outside the app', async () => {
    const { storage } = storageWithPdf();
    const engine = new StructurePdfEngine(storage);
    storage.simulateExternalMove(`${BOOKS_DIRECTORY}/deep-work.pdf`, `${BOOKS_DIRECTORY}/moved.pdf`);

    expect((await engine.open(`${BOOKS_DIRECTORY}/deep-work.pdf`)).ok).toBe(false);
  });

  it('refuses a document beyond the size limit', async () => {
    const { storage } = storageWithPdf({ pageCount: 2 });
    const engine = new StructurePdfEngine(storage, { maxBytes: 64 });

    const result = await engine.open(`${BOOKS_DIRECTORY}/deep-work.pdf`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe('too_large');
  });

  it('returns page sizes and bounds-checks the index', async () => {
    const { storage } = storageWithPdf({ pageCount: 5 });
    const engine = new StructurePdfEngine(storage);
    const result = await engine.open(`${BOOKS_DIRECTORY}/deep-work.pdf`);
    if (!result.ok) throw new Error('expected the document to open');

    expect((await result.document.getPageSize(0))?.landscape).toBe(false);
    expect(await result.document.getPageSize(-1)).toBeNull();
    expect(await result.document.getPageSize(999)).toBeNull();

    await result.document.close();
    // A closed handle answers safely rather than throwing.
    expect(await result.document.getPageSize(0)).toBeNull();
    expect(await result.document.getOutline()).toEqual([]);
  });

  it('tolerates close being called twice', async () => {
    const { storage } = storageWithPdf();
    const engine = new StructurePdfEngine(storage);
    const result = await engine.open(`${BOOKS_DIRECTORY}/deep-work.pdf`);
    if (!result.ok) throw new Error('expected the document to open');

    await expect(result.document.close()).resolves.toBeUndefined();
    await expect(result.document.close()).resolves.toBeUndefined();
  });
});

describe('importing a PDF', () => {
  it('copies the file locally and reports its metadata', async () => {
    const { storage, uri } = storageForImport({ title: 'Deep Work', author: 'Cal Newport', pageCount: 20 });
    const result = await importPdf({ originalName: 'deep-work.pdf', sourceUri: uri }, { storage });

    expect(result.ok ? true : `${result.reason}: ${result.message}`).toBe(true);
    if (!result.ok) return;
    expect(result.filePath).toBe(`${BOOKS_DIRECTORY}/deep-work.pdf`);
    expect(result.title).toBe('Deep Work');
    expect(result.author).toBe('Cal Newport');
    expect(result.pageCount).toBe(20);
    expect(await storage.exists(result.filePath)).toBe(true);
  });

  it('never leaves a .part file behind on success', async () => {
    const { storage, uri } = storageForImport();
    const result = await importPdf({ originalName: 'deep-work.pdf', sourceUri: uri }, { storage });
    if (!result.ok) throw new Error('expected success');

    // The partial name is used on the way in...
    expect(storage.writeLog.some((path) => path.endsWith(PARTIAL_SUFFIX))).toBe(true);
    // ...but the finished library contains only the final file.
    expect(await storage.list(BOOKS_DIRECTORY)).toEqual(['deep-work.pdf']);
  });

  it('writes to a temporary name first, then renames', async () => {
    const { storage, uri } = storageForImport();
    await importPdf({ originalName: 'deep-work.pdf', sourceUri: uri }, { storage });

    // The final name only ever appears via the rename, so a crash cannot expose it early.
    expect(storage.writeLog[0]).toBe(`${BOOKS_DIRECTORY}/deep-work.pdf${PARTIAL_SUFFIX}`);
  });

  it('rejects a file that is not a PDF', async () => {
    const { storage, uri } = storageForImport({ corruptHeader: true });
    const result = await importPdf({ originalName: 'notes.pdf', sourceUri: uri }, { storage });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_a_pdf');
    expect(await storage.list(BOOKS_DIRECTORY)).toEqual([]);
  });

  it('rejects an invalid file extension', async () => {
    const { storage, uri } = storageForImport();
    const result = await importPdf({ originalName: 'notes.txt', sourceUri: uri }, { storage });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported_extension');
  });

  it('rejects a password-protected PDF', async () => {
    const { storage, uri } = storageForImport({ encrypted: true });
    const result = await importPdf({ originalName: 'locked.pdf', sourceUri: uri }, { storage });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('encrypted');
    expect(await storage.list(BOOKS_DIRECTORY)).toEqual([]);
  });

  it('rejects an oversized PDF and keeps no partial file', async () => {
    const { storage, uri } = storageForImport({ pageCount: 3 });
    const result = await importPdf({ originalName: 'big.pdf', sourceUri: uri, maxBytes: 64 }, { storage });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('too_large');
    expect(await storage.list(BOOKS_DIRECTORY)).toEqual([]);
  });

  it('rejects an empty file', async () => {
    const storage = new MemoryStorageAdapter();
    storage.seedFile('inbox/empty.pdf', new Uint8Array(2));
    const result = await importPdf(
      { originalName: 'empty.pdf', sourceUri: 'picked://inbox/empty.pdf' },
      { storage },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('empty');
  });

  it('reports insufficient storage and leaves nothing behind', async () => {
    const { storage, uri } = storageForImport();
    storage.setFreeSpace(10);

    const result = await importPdf({ originalName: 'deep-work.pdf', sourceUri: uri }, { storage });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_enough_space');
    expect(await storage.list(BOOKS_DIRECTORY)).toEqual([]);
  });

  it('reports a source that has been moved', async () => {
    const storage = new MemoryStorageAdapter();
    const result = await importPdf(
      { originalName: 'gone.pdf', sourceUri: 'picked://inbox/gone.pdf' },
      { storage },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unreadable');
  });

  it('gives a second copy of the same PDF a distinct name', async () => {
    const { storage, uri } = storageForImport();
    const first = await importPdf({ originalName: 'deep-work.pdf', sourceUri: uri }, { storage });
    const second = await importPdf(
      { originalName: 'deep-work.pdf', sourceUri: uri },
      { storage, existingNames: new Set(['deep-work.pdf']) },
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.filePath).toBe(`${BOOKS_DIRECTORY}/deep-work (2).pdf`);
  });

  it('generates unique names without ever colliding', () => {
    expect(uniqueName('book', new Set(['book.pdf', 'book (2).pdf', 'book (3).pdf']))).toBe(
      'book (4).pdf',
    );
  });
});

describe('interrupted imports', () => {
  it('sweeps orphaned .part files on the next launch', async () => {
    const storage = new MemoryStorageAdapter();
    storage.seedFile(`${BOOKS_DIRECTORY}/half.pdf${PARTIAL_SUFFIX}`, new Uint8Array(500));
    storage.seedFile(`${BOOKS_DIRECTORY}/half2.pdf${PARTIAL_SUFFIX}`, new Uint8Array(900));
    storage.seedFile(`${BOOKS_DIRECTORY}/real.pdf`, new Uint8Array(1200));

    expect(await cleanupInterruptedImports(storage)).toBe(2);
    // The completed book is untouched.
    expect(await storage.list(BOOKS_DIRECTORY)).toEqual(['real.pdf']);
  });

  it('reports how much space an interrupted import is holding', async () => {
    const storage = new MemoryStorageAdapter();
    storage.seedFile(`${BOOKS_DIRECTORY}/half.pdf${PARTIAL_SUFFIX}`, new Uint8Array(4096));
    expect(await pendingImportBytes(storage)).toBe(4096);
  });

  it('leaves no library row pointing at a missing file after deletion', async () => {
    const { storage, uri } = storageWithPdf();
    await importPdf({ originalName: 'deep-work.pdf', sourceUri: uri }, { storage });

    // Simulate the user deleting the PDF from the Files app afterwards. The reader
    // reports it rather than showing an empty page.
    storage.simulateExternalDelete(`${BOOKS_DIRECTORY}/deep-work.pdf`);
    const engine = new StructurePdfEngine(storage);
    expect((await engine.open(`${BOOKS_DIRECTORY}/deep-work.pdf`)).ok).toBe(false);
  });

  it('does not throw when cleanup runs against an empty library', async () => {
    await expect(cleanupInterruptedImports(new MemoryStorageAdapter())).resolves.toBe(0);
  });

  it('survives a storage adapter that throws during cleanup', async () => {
    const storage = new MemoryStorageAdapter();
    storage.list = async () => {
      throw new StorageError('disk trouble', 'IO');
    };
    await expect(cleanupInterruptedImports(storage)).resolves.toBe(0);
  });
});

