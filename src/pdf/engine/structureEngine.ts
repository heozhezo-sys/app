/**
 * The shipped `PDFReaderEngine`: structure only, no rasteriser.
 *
 * **What it really does.** Parses the document and reports page count, metadata,
 * encryption, page geometry and the table of contents. Those are measured from the file.
 *
 * **What it does not do, and says so.** It does not rasterise pages and it does not
 * decompress Flate streams. `rendering`, `textSearch`, `continuousScroll` and `twoPage`
 * are therefore reported `false`, and the reader screen shows an explicit explanation
 * instead of an empty page frame that would look like a broken document.
 *
 * That honesty is the point of ADR-0006. A reader that silently shows nothing is worse
 * than one that says which parts it cannot display. Swapping in a rasterising engine is
 * a single constructor change; nothing else moves.
 */

import { readDocumentFacts, type OutlineFacts } from './documentReader';
import { hasPdfMagic, readPdfVersion } from './pdfStructure';
import { StorageError, type StorageAdapter, type RelativePath } from '@/platform/storage/types';
import { logger } from '@/utils/logger';
import type {
  PDFReaderEngine,
  PdfCapabilities,
  PdfDocumentHandle,
  PdfOpenResult,
  PdfOutlineNode,
  PdfPageSize,
  PdfSearchHit,
} from './types';

/** Above this, a file is refused rather than attempting to parse a huge document. */
export const MAX_PDF_BYTES = 200 * 1024 * 1024; // 200 MB

export interface StructureEngineOptions {
  /** Overridable so tests can accept a small "large" file. */
  maxBytes?: number;
}

export interface DocumentFactsLike {
  pageCount: number;
  title: string | null;
  author: string | null;
  subject: string | null;
  creator: string | null;
  pdfVersion: string | null;
  encrypted: boolean;
  mediaBox: { width: number; height: number } | null;
  outline: OutlineFacts[];
}

export class StructurePdfEngine implements PDFReaderEngine {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly options: StructureEngineOptions = {},
  ) {}

  async open(relativePath: RelativePath): Promise<PdfOpenResult> {
    const maxBytes = this.options.maxBytes ?? MAX_PDF_BYTES;
    let bytes: Uint8Array;

    try {
      const stat = await this.storage.stat(relativePath);
      if (!stat) {
        return {
          ok: false,
          failure: {
            reason: 'missing',
            detail: 'This file is no longer in your library. It may have been moved or deleted.',
          },
        };
      }
      if (stat.sizeBytes > maxBytes) {
        return {
          ok: false,
          failure: {
            reason: 'too_large',
            detail: `This document is ${Math.round(stat.sizeBytes / 1024 / 1024)} MB, beyond the reader's limit.`,
          },
        };
      }
      bytes = await this.storage.readAll(relativePath);
    } catch (error) {
      if (error instanceof StorageError) {
        return { ok: false, failure: { reason: 'missing', detail: 'The file could not be opened.' } };
      }
      throw error;
    }

    if (bytes.length === 0 || !hasPdfMagic(bytes)) {
      return {
        ok: false,
        failure: {
          reason: 'corrupt',
          detail: "This file doesn't look like a PDF. It may be damaged or renamed.",
        },
      };
    }

    const facts = readDocumentFacts(bytes);
    if (!facts) {
      return {
        ok: false,
        failure: { reason: 'corrupt', detail: 'The document structure could not be read.' },
      };
    }
    // Encryption is checked after the magic number but before any "corrupt" verdict,
    // so a protected file is reported as locked rather than damaged.
    if (facts.encrypted) {
      return {
        ok: false,
        failure: {
          reason: 'password_required',
          detail: 'This PDF is password protected, so it cannot be opened in LifeOS.',
        },
      };
    }
    if (facts.pageCount === 0) {
      return {
        ok: false,
        failure: { reason: 'corrupt', detail: 'The document has no readable pages. It may be damaged.' },
      };
    }

    logger.info(`Opened PDF ${readPdfVersion(bytes) ?? '?'} with ${facts.pageCount} pages`);

    return {
      ok: true,
      document: new StructureDocumentHandle(this.storage, relativePath, facts),
    };
  }
}
class StructureDocumentHandle implements PdfDocumentHandle {
  readonly pageCount: number;
  readonly info: PdfDocumentHandle['info'];
  readonly capabilities: PdfCapabilities;

  private closed = false;

  constructor(
    private readonly storage: StorageAdapter,
    private readonly relativePath: RelativePath,
    private readonly facts: DocumentFactsLike,
  ) {
    this.pageCount = facts.pageCount;
    this.capabilities = {
      // Measured, not assumed: this engine produces no page bitmaps and no text.
      rendering: false,
      textSearch: false,
      outline: facts.outline.length > 0,
      twoPage: false,
      continuousScroll: false,
      annotations: false,
    };
    this.info = {
      pageCount: facts.pageCount,
      title: facts.title,
      author: facts.author,
      subject: facts.subject,
      creator: facts.creator,
      pdfVersion: facts.pdfVersion,
      pageWidthPt: facts.mediaBox?.width ?? null,
      pageHeightPt: facts.mediaBox?.height ?? null,
      encrypted: facts.encrypted,
    };
  }

  async getPageSize(pageIndex: number): Promise<PdfPageSize | null> {
    if (this.closed) return null;
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= this.pageCount) return null;
    const box = this.facts.mediaBox;
    // A4 portrait is the sensible default when a page declares no media box.
    const width = box && box.width > 0 ? box.width : 595.28;
    const height = box && box.height > 0 ? box.height : 841.89;
    return { widthPt: width, heightPt: height, landscape: width > height };
  }

  async getOutline(): Promise<PdfOutlineNode[]> {
    if (this.closed) return [];
    return this.facts.outline.map(toOutlineNode);
  }

  /**
   * Always empty.
   *
   * `capabilities.textSearch` is already `false`, so the reader never calls this.
   * Returning `''` rather than throwing keeps a stale flag from becoming a crash.
   */
  async getPageText(): Promise<string> {
    return '';
  }

  async search(): Promise<PdfSearchHit[]> {
    return [];
  }

  async close(): Promise<void> {
    // Idempotent: the reader may be torn down mid-render.
    this.closed = true;
  }

  /** Absolute path, for handing to a native rasteriser in a future engine. */
  absolutePath(): string {
    return this.storage.resolve(this.relativePath);
  }
}

function toOutlineNode(node: OutlineFacts): PdfOutlineNode {
  return {
    title: node.title,
    pageIndex: node.pageIndex,
    children: node.children.map(toOutlineNode),
  };
}
