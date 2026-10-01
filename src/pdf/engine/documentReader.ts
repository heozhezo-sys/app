/**
 * Turns raw PDF bytes into the facts the library and reader need.
 *
 * Built directly on `pdfStructure.ts`. Every field is measured from the file; nothing
 * is assumed, because the specification forbids assuming a PDF supports a feature.
 */

import {
  asArray,
  asDict,
  asNumber,
  asRef,
  asText,
  hasPdfMagic,
  indexObjects,
  isEncrypted,
  parseValue,
  readPdfVersion,
  type PdfDict,
  type PdfObject,
  type PdfValue,
} from './pdfStructure';

export interface OutlineFacts {
  title: string;
  pageIndex: number | null;
  children: OutlineFacts[];
}

export interface PageTreeResult {
  /** Object numbers of every `/Type /Page`, in reading order. */
  pageRefs: number[];
  /** The inherited media box of the first page, in points. */
  mediaBox: { width: number; height: number } | null;
}

const MAX_PAGE_TREE_NODES = 20_000;
const MAX_TREE_DEPTH = 64;

/**
 * Walks the page tree from the catalog.
 *
 * Guarded against cycles: a malformed file can point `/Kids` back at its own parent,
 * and an unguarded walk would hang the app on a file the user is trying to read.
 */
export function walkPageTree(objects: Map<number, PdfObject>, bytes: Uint8Array): PageTreeResult {
  const catalog = findCatalog(objects, bytes);
  const pagesRef = catalog ? asRef(catalog.Pages) : null;

  const pageRefs: number[] = [];
  const visited = new Set<number>();
  let mediaBox: { width: number; height: number } | null = null;

  const walk = (ref: number, depth: number, path: Set<string>): void => {
    if (depth > MAX_TREE_DEPTH || pageRefs.length >= MAX_PAGE_TREE_NODES) return;
    if (path.has(String(ref)) || visited.has(ref)) return;
    visited.add(ref);

    const object = objects.get(ref);
    if (!object) return;
    path.add(String(ref));

    const dict = dictOf(bytes, object);
    if (!dict) return;

    if (dict.Type === 'Page') {
      pageRefs.push(ref);
      if (!mediaBox) mediaBox = readMediaBox(dict);
      return;
    }

    const kids = asArray(dict.Kids);
    if (!kids) return;
    for (const kid of kids) {
      const kidRef = asRef(kid);
      if (kidRef !== null) walk(kidRef, depth + 1, path);
    }
  };

  if (pagesRef !== null) {
    walk(pagesRef, 0, new Set());
  } else {
    // No usable catalog: fall back to every `/Type /Page` object in the file. A damaged
    // xref should still yield the right page count.
    for (const object of objects.values()) {
      const dict = dictOf(bytes, object);
      if (dict && dict.Type === 'Page') pageRefs.push(object.number);
    }
  }

  return { pageRefs, mediaBox };
}

function readMediaBox(dict: PdfDict): { width: number; height: number } | null {
  const box = asArray(dict.MediaBox);
  if (!box || box.length < 4) return null;
  const x0 = asNumber(box[0]);
  const y0 = asNumber(box[1]);
  const x1 = asNumber(box[2]);
  const y1 = asNumber(box[3]);
  if (x0 === null || y0 === null || x1 === null || y1 === null) return null;
  return { width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

export function findCatalog(objects: Map<number, PdfObject>, bytes: Uint8Array): PdfDict | null {
  for (const object of objects.values()) {
    const dict = dictOf(bytes, object);
    if (dict && dict.Type === 'Catalog') return dict;
  }
  return null;
}

/** Parses an object's body as a dictionary, or `null` when it is not one. */
export function dictOf(bytes: Uint8Array, object: PdfObject): PdfDict | null {
  let i = object.bodyStart;
  while (i < object.bodyEnd) {
    const byte = bytes[i] ?? 0;
    if (byte === 0x0a || byte === 0x0d || byte === 0x20 || byte === 0x09) {
      i += 1;
      continue;
    }
    break;
  }
  if (i >= object.bodyEnd) return null;
  return asDict(parseValue(bytes, i, object.bodyEnd).value);
}
export interface DocumentFacts {
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

/**
 * Reads everything the library shows, in one pass.
 *
 * `pageCount` of 0 means the page tree was unreadable. That is reported rather than
 * guessed, because a book of unknown length cannot offer a meaningful progress bar or
 * a reliable resume point.
 */
export function readDocumentFacts(bytes: Uint8Array): DocumentFacts | null {
  if (!hasPdfMagic(bytes)) return null;

  const objects = indexObjects(bytes);
  const { pageRefs, mediaBox } = walkPageTree(objects, bytes);

  const catalog = findCatalog(objects, bytes);
  const infoRef = findInfoRef(objects, bytes, catalog);
  const infoObject = infoRef === null ? undefined : objects.get(infoRef);
  const info = infoObject ? dictOf(bytes, infoObject) : null;

  const pageIndex = new Map<number, number>();
  pageRefs.forEach((ref, position) => pageIndex.set(ref, position));

  return {
    pageCount: pageRefs.length,
    title: info ? asText(info.Title) : null,
    author: info ? asText(info.Author) : null,
    subject: info ? asText(info.Subject) : null,
    creator: info ? asText(info.Creator) : null,
    pdfVersion: readPdfVersion(bytes),
    encrypted: isEncrypted(bytes),
    mediaBox,
    outline: readOutline(objects, bytes, catalog, pageIndex),
  };
}

function findInfoRef(
  objects: Map<number, PdfObject>,
  bytes: Uint8Array,
  catalog: PdfDict | null,
): number | null {
  const fromCatalog = catalog ? asRef(catalog.Info) : null;
  if (fromCatalog !== null) return fromCatalog;

  // Many writers (including ours) put /Info only in the trailer, which is a bare
  // dictionary rather than an indexed object, so it has to be read from the tail.
  const trailerAt = lastIndexOfAscii(bytes, 'trailer');
  if (trailerAt >= 0) {
    const dictStart = skipToDictionary(bytes, trailerAt + 'trailer'.length);
    const trailer = asDict(parseValue(bytes, dictStart, bytes.length).value);
    const ref = trailer ? asRef(trailer.Info) : null;
    if (ref !== null) return ref;
  }

  for (const object of objects.values()) {
    const dict = dictOf(bytes, object);
    if (dict?.Type === 'XRef' && dict.Info) {
      const ref = asRef(dict.Info);
      if (ref !== null) return ref;
    }
  }
  return null;
}

/** Last occurrence of `needle`, as an absolute offset. */
function lastIndexOfAscii(haystack: Uint8Array, needle: string): number {
  const target: number[] = [];
  for (let k = 0; k < needle.length; k += 1) target.push(needle.charCodeAt(k) & 0xff);

  for (let i = haystack.length - target.length; i >= 0; i -= 1) {
    let hit = true;
    for (let k = 0; k < target.length; k += 1) {
      if (haystack[i + k] !== target[k]) {
        hit = false;
        break;
      }
    }
    if (hit) return i;
  }
  return -1;
}

/** Advances to the next `<` that opens a dictionary. */
function skipToDictionary(bytes: Uint8Array, start: number): number {
  for (let i = start; i + 1 < bytes.length; i += 1) {
    if (bytes[i] === 0x3c && bytes[i + 1] === 0x3c) return i;
  }
  return start;
}

const MAX_OUTLINE_DEPTH = 8;
const MAX_OUTLINE_ITEMS = 2000;

/**
 * Walks the outline's linked list.
 *
 * Items are siblings via `/Next` and parents via `/First`. A dangling `/Next` â€” common
 * in files with a damaged xref â€” ends the list rather than looping, because `visited`
 * catches the cycle.
 */
function readOutline(
  objects: Map<number, PdfObject>,
  bytes: Uint8Array,
  catalog: PdfDict | null,
  pageIndex: Map<number, number>,
): OutlineFacts[] {
  const outlinesRef = catalog ? asRef(catalog.Outlines) : null;
  if (outlinesRef === null) return [];
  const outlines = objects.get(outlinesRef);
  if (!outlines) return [];

  const outlinesDict = dictOf(bytes, outlines);
  return readSiblingList(objects, bytes, outlinesDict ? asRef(outlinesDict.First) : null, pageIndex, 0, new Set<number>());
}

function readSiblingList(
  objects: Map<number, PdfObject>,
  bytes: Uint8Array,
  firstRef: number | null,
  pageIndex: Map<number, number>,
  depth: number,
  visited: Set<number>,
): OutlineFacts[] {
  if (depth >= MAX_OUTLINE_DEPTH || firstRef === null) return [];

  const items: OutlineFacts[] = [];
  let cursor: number | null = firstRef;

  while (cursor !== null && !visited.has(cursor) && items.length < MAX_OUTLINE_ITEMS) {
    visited.add(cursor);
    const object = objects.get(cursor);
    if (!object) break;
    const dict = dictOf(bytes, object);
    if (!dict) break;

    items.push({
      title: asText(dict.Title) ?? 'Untitled',
      pageIndex: resolveDestination(dict, pageIndex),
      children: readSiblingList(objects, bytes, asRef(dict.First), pageIndex, depth + 1, visited),
    });

    cursor = asRef(dict.Next);
  }

  return items;
}

/** A destination is `[pageRef /XYZ ...]`, or an action carrying the same `/D`. */
function resolveDestination(dict: PdfDict, pageIndex: Map<number, number>): number | null {
  const direct = destinationPage(asArray(dict.Dest));
  if (direct !== null) return indexOfPage(pageIndex, direct);

  const action = asDict(dict.A);
  if (action) {
    const fromAction = destinationPage(asArray(action.D));
    if (fromAction !== null) return indexOfPage(pageIndex, fromAction);
  }
  return null;
}

function indexOfPage(pageIndex: Map<number, number>, ref: number): number | null {
  const index = pageIndex.get(ref);
  return index === undefined ? null : index;
}

function destinationPage(dest: PdfValue[] | null): number | null {
  if (!dest || dest.length === 0) return null;
  return asRef(dest[0]);
}




