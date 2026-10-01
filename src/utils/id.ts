/**
 * Identifier generation.
 *
 * Primary identifiers are UUID v4 strings. They are generated here rather than with
 * `Date.now()` + a counter so that a record copied into a restored backup keeps a
 * unique key without colliding with records created after the backup.
 *
 * Tests can install a deterministic generator; production never does.
 */

import * as Crypto from 'expo-crypto';

const HEX = '0123456789abcdef';

function randomHex(length: number): string {
  const bytes = Crypto.getRandomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const b = bytes[i] ?? 0;
    out += HEX[b >> 4];
    out += HEX[b & 0x0f];
  }
  return out;
}

/** RFC 4122 version 4 UUID. */
export function newId(): string {
  const bytes = Crypto.getRandomBytes(16);
  const b = bytes;

  // Version 4 and RFC 4122 variant bits.
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;

  let hex = '';
  for (let i = 0; i < 16; i += 1) {
    const byte = b[i] ?? 0;
    hex += HEX[byte >> 4] ?? '0';
    hex += HEX[byte & 0x0f] ?? '0';
  }

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** Short opaque token, for share codes and device install ids. */
export function newShortToken(length = 16): string {
  return randomHex(Math.ceil(length / 2)).slice(0, length);
}

let override: (() => string) | null = null;

/** Test seam. Pass `null` to restore the real generator. */
export function setIdGenerator(generator: (() => string) | null): void {
  override = generator;
}

export function createId(): string {
  return override ? override() : newId();
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidId(value: string): boolean {
  return UUID_V4.test(value);
}
