/**
 * PDF reader engine abstraction.
 *
 * The specification is blunt about this: "Never assume every PDF supports every
 * feature. The UI must clearly indicate unsupported capabilities." So capabilities are
 * a *property of the document*, discovered at open time — never a constant the UI
 * hard-codes. A scan with no text layer genuinely cannot be searched, and the reader
 * has to say so instead of offering a search box that silently returns nothing.
 *
 * The engine is deliberately free of UI concepts: it returns data, and the screen
 * decides how to present an absence.
 */

export type PdfOpenFailure =
  | { reason: 'corrupt'; detail: string }
  | { reason: 'password_required'; detail: string }
  | { reason: 'unsupported'; detail: string }
  | { reason: 'too_large'; detail: string }
  | { reason: 'missing'; detail: string };

/**
 * Result of opening a document.
 *
 * On success the handle is returned, not a bare description: the caller needs the
 * page/outline/search methods, and handing back a description would force every caller
 * to keep the handle separately and risk losing track of it.
 */
export type PdfOpenResult =
  | { ok: true; document: PdfDocumentHandle }
  | { ok: false; failure: PdfOpenFailure };

/**
 * What this specific document can actually do.
 *
 * Every flag is measured, not assumed. `rendering` is separate from the others
 * because it depends on the engine build rather than the file.
 */
export interface PdfCapabilities {
  /** Pages can be rasterised for display. */
  rendering: boolean;
  /** Extractable text exists, so in-document search is meaningful. */
  textSearch: boolean;
  /** A document outline / table of contents is present. */
  outline: boolean;
  /** Two-page spread is possible (page geometry permits it). */
  twoPage: boolean;
  /** Continuous scrolling is possible with the current renderer. */
  continuousScroll: boolean;
  /** The document carries its own annotations that can be listed. */
  annotations: boolean;
}

export interface PdfDocumentInfo {
  /** Page count, or 0 when the page tree could not be read. */
  pageCount: number;
  title: string | null;
  author: string | null;
  subject: string | null;
  creator: string | null;
  /** PDF version string, e.g. `1.7`. */
  pdfVersion: string | null;
  pageWidthPt: number | null;
  pageHeightPt: number | null;
  encrypted: boolean;
}

export interface PdfPageSize {
  widthPt: number;
  heightPt: number;
  /** True when the page is rotated relative to its media box. */
  landscape: boolean;
}

export interface PdfOutlineNode {
  title: string;
  /** Zero-based page index, or `null` when the destination could not be resolved. */
  pageIndex: number | null;
  children: PdfOutlineNode[];
}

export interface PdfSearchHit {
  pageIndex: number;
  /** Snippet around the match, for display. */
  snippet: string;
}

export interface PdfDocument {
  info: PdfDocumentInfo;
  capabilities: PdfCapabilities;
}

/**
 * An opened document.
 *
 * `close` must be idempotent: the reader may be torn down mid-render.
 */
export interface PdfDocumentHandle extends PdfDocument {
  pageCount: number;
  getPageSize(pageIndex: number): Promise<PdfPageSize | null>;
  getOutline(): Promise<PdfOutlineNode[]>;
  /** Text of a page, when the document has one. Empty string when it does not. */
  getPageText(pageIndex: number): Promise<string>;
  search(query: string): Promise<PdfSearchHit[]>;
  close(): Promise<void>;
}

export interface PDFReaderEngine {
  /**
   * Opens a document from app storage.
   *
   * Must never throw for a bad document: a corrupt, encrypted or oversized file is a
   * `PdfOpenResult` with `ok: false`, because those are ordinary user situations, not
   * programming errors.
   */
  open(relativePath: string): Promise<PdfOpenResult>;
}

/**
 * Capabilities of an engine that cannot rasterise.
 *
 * Used when the app runs on a build with no native rasteriser. The reader then offers
 * everything that does not need pixels — page count, outline, text search — and says
 * plainly that page images are unavailable, rather than showing an empty page frame
 * that looks like a broken document.
 */
export const NO_RENDERING: PdfCapabilities = {
  rendering: false,
  textSearch: false,
  outline: false,
  twoPage: false,
  continuousScroll: false,
  annotations: false,
};
