/**
 * Minimal PDF structure reader.
 *
 * This is a real parser, not a stub. It reads enough of a PDF to answer the questions
 * the library and reader need *before* any page is rendered: how many pages, what the
 * title is, whether it is encrypted, and what the outline contains.
 *
 * **Why it scans objects rather than following the xref table.** Real-world PDFs have
 * broken, missing or subtly wrong cross-reference tables far more often than they have
 * broken page trees. Scanning for `N G obj` markers recovers the object graph from
 * files a strict parser would reject — which matters when the user has just picked a
 * book to read.
 *
 * **What it does not do.** It does not rasterise pages and does not decompress Flate
 * streams, so it reports `rendering: false` and `textSearch: false` honestly rather
 * than pretending. See `src/pdf/engine/structureEngine.ts`.
 */

export interface PdfObject {
  number: number;
  generation: number;
  /** Offset of the object's body within the source bytes. */
  bodyStart: number;
  bodyEnd: number;
}

export interface PdfRef {
  ref: number;
}

export type PdfValue = string | number | boolean | null | PdfRef | PdfValue[] | PdfDict;

export interface PdfDict {
  [key: string]: PdfValue;
}

const HEADER = [0x25, 0x50, 0x44, 0x46]; // %PDF

export function hasPdfMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  for (let i = 0; i < HEADER.length; i += 1) {
    if (bytes[i] !== HEADER[i]) return false;
  }
  return true;
}

export function decodeLatin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i] ?? 0);
  return out;
}

function latin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

export function indexOfAscii(haystack: Uint8Array, needle: string, from = 0): number {
  const target = latin1Bytes(needle);
  const limit = haystack.length - target.length;
  outer: for (let i = Math.max(0, from); i <= limit; i += 1) {
    for (let j = 0; j < target.length; j += 1) {
      if (haystack[i + j] !== target[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** PDF version from the header, e.g. `1.7`. */
export function readPdfVersion(bytes: Uint8Array): string | null {
  if (!hasPdfMagic(bytes)) return null;
  // `%PDF-` occupies five bytes, so the version starts at index 5.
  const version = decodeLatin1(bytes.subarray(5, 8));
  return /^\d\.\d/.test(version) ? version.trim() : null;
}

/**
 * True when the file is encrypted.
 *
 * `/Encrypt` appears in the trailer dictionary, which sits at the end of a well-formed
 * file; scanning the whole document also catches files with a truncated trailer, which
 * is the common corruption case.
 */
export function isEncrypted(bytes: Uint8Array): boolean {
  return indexOfAscii(bytes, '/Encrypt') >= 0;
}

function isWhitespace(byte: number): boolean {
  return (
    byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09 || byte === 0x0c || byte === 0x00
  );
}

function isDigit(byte: number): boolean {
  return byte >= 0x30 && byte <= 0x39;
}

function isDelimiter(byte: number): boolean {
  return (
    byte === 0x28 || byte === 0x29 || byte === 0x3c || byte === 0x3e || byte === 0x5b ||
    byte === 0x5d || byte === 0x7b || byte === 0x7d || byte === 0x2f
  );
}

/**
 * Indexes every `N G obj` in the file.
 *
 * Markers that appear inside a stream body can be misdetected, which is harmless: the
 * page tree walk only follows real references.
 */
export function indexObjects(bytes: Uint8Array): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  const needle = latin1Bytes(' obj');

  for (let i = 0; i + needle.length < bytes.length; i += 1) {
    // The marker itself must be present. Without this check any `i` whose fourth
    // byte ahead is whitespace parses as an object, which silently overwrites real
    // entries with bogus ones.
    let marker = true;
    for (let k = 0; k < needle.length; k += 1) {
      if (bytes[i + k] !== needle[k]) {
        marker = false;
        break;
      }
    }
    if (!marker) continue;

    // `obj` must be followed by a separator before the body starts.
    const separator = i + needle.length;
    if (separator >= bytes.length || !isWhitespace(bytes[separator] ?? 0)) continue;

    // The body begins after the whitespace run.
    let j = separator;
    while (j < bytes.length && isWhitespace(bytes[j] ?? 0)) j += 1;

    let cursor = i - 1;
    while (cursor >= 0 && isWhitespace(bytes[cursor] ?? 0)) cursor -= 1;
    const genEnd = cursor + 1;
    while (cursor >= 0 && isDigit(bytes[cursor] ?? 0)) cursor -= 1;
    const genStart = cursor + 1;
    if (genStart === genEnd) continue;

    while (cursor >= 0 && isWhitespace(bytes[cursor] ?? 0)) cursor -= 1;
    const numEnd = cursor + 1;
    while (cursor >= 0 && isDigit(bytes[cursor] ?? 0)) cursor -= 1;
    const numStart = cursor + 1;
    if (numStart === numEnd) continue;

    const number = Number(decodeLatin1(bytes.subarray(numStart, numEnd)));
    if (!Number.isInteger(number)) continue;

    // Search the whole buffer from `j` so the offset is absolute, which is the space
    // `bodyStart` / `bodyEnd` are measured in.
    const endIndex = indexOfAscii(bytes, 'endobj', j);
    objects.set(number, {
      number,
      generation: Number(decodeLatin1(bytes.subarray(genStart, genEnd))),
      bodyStart: j,
      bodyEnd: endIndex >= 0 ? endIndex : bytes.length,
    });
    // Continue after this object rather than re-scanning its own body.
    i = endIndex >= 0 ? endIndex : j;
  }

  return objects;
}

function skipWhitespace(bytes: Uint8Array, start: number, end: number): number {
  let i = start;
  while (i < end && isWhitespace(bytes[i] ?? 0)) i += 1;
  return i;
}

function readToken(bytes: Uint8Array, start: number, end: number): string {
  let i = start;
  while (i < end && !isWhitespace(bytes[i] ?? 0) && !isDelimiter(bytes[i] ?? 0)) i += 1;
  return decodeLatin1(bytes.subarray(start, i));
}
/* ----------------------------------------------------------------- values */

/**
 * Parses the value starting at `start`, stopping at `end`.
 *
 * Deliberately forgiving: anything unparseable becomes a string or `null` rather than
 * throwing, because the caller's job is to show a library, not to reject a file over a
 * malformed optional field.
 */
export function parseValue(
  bytes: Uint8Array,
  start: number,
  end: number,
): { value: PdfValue; next: number } {
  const i = skipWhitespace(bytes, start, end);
  const byte = bytes[i] ?? 0;

  if (byte === 0x2f) return parseName(bytes, i, end);
  if (byte === 0x28) return parseLiteralString(bytes, i, end);
  // `<<` opens a dictionary; a lone `<` opens a hex string.
  if (byte === 0x3c) {
    return bytes[i + 1] === 0x3c ? parseDict(bytes, i, end) : parseHexString(bytes, i, end);
  }
  if (byte === 0x5b) return parseArray(bytes, i, end);
  if (byte === 0x7b) return parseDict(bytes, i, end);

  const token = readToken(bytes, i, end);
  if (/^-?\d+$/.test(token)) return { value: Number(token), next: i + token.length };
  if (token === 'true') return { value: true, next: i + token.length };
  if (token === 'false') return { value: false, next: i + token.length };
  if (token === 'null') return { value: null, next: i + token.length };
  return { value: token, next: i + token.length };
}

function parseName(bytes: Uint8Array, start: number, end: number): { value: PdfValue; next: number } {
  let i = start + 1;
  while (i < end && !isWhitespace(bytes[i] ?? 0) && !isDelimiter(bytes[i] ?? 0)) i += 1;
  return { value: decodeLatin1(bytes.subarray(start + 1, i)), next: i };
}

function parseLiteralString(bytes: Uint8Array, start: number, end: number): { value: PdfValue; next: number } {
  // `start` points at the opening `(`, which is a delimiter rather than content.
  let depth = 1;
  let i = start + 1;
  let out = '';

  while (i < end) {
    const byte = bytes[i] ?? 0;

    if (byte === 0x5c && i + 1 < end) {
      const escaped = bytes[i + 1] ?? 0;
      // Octal escapes are rare in metadata but cheap to support.
      if (escaped >= 0x30 && escaped <= 0x37) {
        let octal = '';
        let k = i + 1;
        while (k < end && octal.length < 3 && (bytes[k] ?? 0) >= 0x30 && (bytes[k] ?? 0) <= 0x37) {
          octal += String.fromCharCode(bytes[k] ?? 0);
          k += 1;
        }
        out += String.fromCharCode(parseInt(octal, 8));
        i = k;
        continue;
      }
      const mapped =
        escaped === 0x6e ? 10 : escaped === 0x72 ? 13 : escaped === 0x74 ? 9 : escaped;
      out += String.fromCharCode(mapped);
      i += 2;
      continue;
    }

    if (byte === 0x28) {
      depth += 1;
      out += '(';
    } else if (byte === 0x29) {
      depth -= 1;
      if (depth === 0) return { value: out, next: i + 1 };
      out += ')';
    } else {
      out += String.fromCharCode(byte);
    }
    i += 1;
  }

  return { value: out, next: i };
}

function parseHexString(bytes: Uint8Array, start: number, end: number): { value: PdfValue; next: number } {
  let i = start + 1;
  let hex = '';
  while (i < end && bytes[i] !== 0x3e) {
    const byte = bytes[i] ?? 0;
    if (!isWhitespace(byte)) hex += String.fromCharCode(byte);
    i += 1;
  }
  if (hex.length % 2 === 1) hex += '0';
  return { value: hexToText(hex), next: i + 1 };
}

/** PDF text strings are either PDFDocEncoded or UTF-16BE with a BOM. */
function hexToText(hex: string): string {
  if (hex.length === 0) return '';
  if (hex.startsWith('feff')) {
    let out = '';
    for (let i = 4; i + 4 <= hex.length; i += 4) {
      const code = parseInt(hex.slice(i, i + 4), 16);
      if (Number.isNaN(code)) break;
      out += String.fromCharCode(code);
    }
    return out;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16) || 0;
  return decodeLatin1(bytes);
}

/**
 * Collapses `N 0 R` into `{ ref: N }`.
 *
 * PDF references appear in both arrays and dictionaries, so both parsers must apply
 * this. Handling only arrays makes every `/Pages 2 0 R` in a dictionary look like the
 * bare number 2, and the page tree then appears empty.
 */
function maybeRef(
  bytes: Uint8Array,
  parsed: { value: PdfValue; next: number },
  end: number,
): { value: PdfValue; next: number } {
  if (typeof parsed.value !== 'number') return parsed;

  // A reference is three tokens: `N`, the generation, then `R`. Both the number and
  // the generation must be consumed before `R` can be recognised.
  const genStart = skipWhitespace(bytes, parsed.next, end);
  const generation = readToken(bytes, genStart, end);
  if (!/^\d+$/.test(generation)) return parsed;

  const marker = skipWhitespace(bytes, genStart + generation.length, end);
  if ((bytes[marker] ?? 0) !== 0x52 /* R */) return parsed;

  return { value: { ref: parsed.value }, next: marker + 1 };
}

/** `12 0 R` inside an array collapses to `{ ref: 12 }`. */
function parseArray(bytes: Uint8Array, start: number, end: number): { value: PdfValue; next: number } {
  const items: PdfValue[] = [];
  let i = start + 1;
  while (i < end) {
    i = skipWhitespace(bytes, i, end);
    if ((bytes[i] ?? 0) === 0x5d) return { value: items, next: i + 1 };
    const parsed = maybeRef(bytes, parseValue(bytes, i, end), end);
    if (parsed.next <= i) break;
    items.push(parsed.value);
    i = parsed.next;
  }
  return { value: items, next: i };
}

/**
 * Parses a dictionary.
 *
 * `start` points at the first `<` of `<<`, so parsing begins two bytes in. Starting at
 * `start + 1` would land on the second `<`, fail the `/Name` test immediately and
 * return an empty dictionary for every object in the file.
 */
function parseDict(bytes: Uint8Array, start: number, end: number): { value: PdfValue; next: number } {
  const dict: PdfDict = {};
  let i = start + 2;
  while (i < end) {
    i = skipWhitespace(bytes, i, end);
    if ((bytes[i] ?? 0) === 0x3e && (bytes[i + 1] ?? 0) === 0x3e) return { value: dict, next: i + 2 };
    if ((bytes[i] ?? 0) !== 0x2f) break;
    const key = parseName(bytes, i, end);
    const value = maybeRef(bytes, parseValue(bytes, key.next, end), end);
    dict[String(key.value)] = value.value;
    i = value.next > key.next ? value.next : key.next + 1;
  }
  return { value: dict, next: i };
}

/* -------------------------------------------------------------- accessors */

/*
 * Every accessor accepts `PdfValue | undefined`. Dictionary lookups under
 * `noUncheckedIndexedAccess` yield `undefined` for an absent key, and an absent key is
 * a completely normal state in a PDF, so "missing" has to be a first-class input
 * rather than something the caller pre-filters.
 */

export function asDict(value: PdfValue | undefined): PdfDict | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  if ('ref' in value) return null;
  return value as PdfDict;
}

export function asArray(value: PdfValue | undefined): PdfValue[] | null {
  return Array.isArray(value) ? value : null;
}

export function asNumber(value: PdfValue | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

export function asRef(value: PdfValue | undefined): number | null {
  if (value === undefined || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) return null;
  if (!('ref' in value)) return null;
  const ref = value.ref;
  return typeof ref === 'number' ? ref : null;
}

/** String fields may be a literal or hex string; anything else counts as absent. */
export function asText(value: PdfValue | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Truthy check for `/Type` style name comparisons. */
export function isType(value: PdfValue | undefined, type: string): boolean {
  return value === type;
}
