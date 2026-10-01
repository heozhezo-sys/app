/**
 * Journal export and lock use cases.
 *
 * Two features the specification asks for that share a privacy constraint:
 *
 * - **Export** writes a file the user explicitly asked for, and never transmits anything.
 *   See `src/journal/export.ts` for why the destination is always explicit.
 * - **Lock** gates the journal screen behind device authentication. Per migration 008 and
 *   `SECURITY/PRIVACY.md` this is a *UI gate*, not at-rest encryption, and this file never
 *   claims otherwise.
 *
 * The lock state is deliberately **not** persisted as "unlocked". An unlocked flag in
 * storage would mean the journal stayed open across app restarts, which defeats the point
 * of a lock. It lives in memory, so closing the app re-locks it.
 */

import * as repository from '@/repositories/journalRepository';
import type { JournalEntry } from '@/repositories/journalRepository';
import { getBiometricAdapter } from '@/platform/biometrics/expoBiometrics';
import type { BiometricCapability } from '@/platform/biometrics/types';
import { ExpoStorageAdapter } from '@/platform/storage/expoStorage';
import type { RelativePath, StorageAdapter } from '@/platform/storage/types';
import { logger } from '@/utils/logger';
import {
  EXPORT_PRIVACY_WARNING,
  exportEntries,
  exportFileName,
  type ExportFormat,
  type ExportOptions,
  type ExportResult,
} from '@/journal/export';

/** Directory for exported journals, inside app storage. */
export const EXPORTS_DIRECTORY = 'exports';

/**
 * Process-wide storage adapter, constructed on first use.
 *
 * Matches the pattern in `booksService`: a module-level singleton so exports all share one
 * documents directory, with the adapter injectable per call so tests can substitute an
 * in-memory one.
 */
let sharedStorage: StorageAdapter | null = null;

function storage(): StorageAdapter {
  if (!sharedStorage) sharedStorage = new ExpoStorageAdapter();
  return sharedStorage;
}

/** Test seam: install a storage adapter. Pass `null` to restore the device one. */
export function configureStorage(next: StorageAdapter | null): void {
  sharedStorage = next;
}

/* ----------------------------------------------------------------- export */

export interface PreparedExport extends ExportResult {
  /** Path relative to the documents directory, once written. */
  filePath: RelativePath;
  /** Bytes written, for the "saved 4 KB" line. */
  sizeBytes: number;
}

export type ExportOutcome =
  | { ok: true; export: PreparedExport }
  | { ok: false; message: string };

/**
 * Renders and writes a journal export to local storage.
 *
 * The document is rendered first and written second, so a formatting failure never leaves
 * a half-written file behind. The file is written under a `.part` name and renamed, which
 * means an interrupted export leaves an orphan rather than a truncated export that looks
 * complete — the same crash-safety rule `pdfImportService` follows.
 */
export async function exportJournal(
  options: {
    format: ExportFormat;
    entries?: readonly JournalEntry[];
    filters?: ExportOptions;
    today: string;
    storage?: StorageAdapter;
  },
): Promise<ExportOutcome> {
  const adapter = options.storage ?? storage();

  try {
    const entries = options.entries ?? (await repository.listEntries({ limit: 200 }));

    const rendered = exportEntries(entries, options.format, options.filters ?? {});
    const fileName = exportFileName(options.format, options.today);
    const filePath = `${EXPORTS_DIRECTORY}/${fileName}`;
    const partialPath = `${filePath}.part`;

    await adapter.ensureDirectory(EXPORTS_DIRECTORY);
    await adapter.write(partialPath, encode(rendered.text));
    await adapter.move(partialPath, filePath);

    const bytes = encode(rendered.text);

    return {
      ok: true,
      export: {
        ...rendered,
        filePath,
        sizeBytes: bytes.length,
      },
    };
  } catch (error) {
    logger.error('Journal export failed', error);
    return {
      ok: false,
      message: 'The export could not be saved. Your journal has not changed.',
    };
  }
}

/**
 * UTF-8 encodes a string.
 *
 * Hand-rolled rather than using `TextEncoder` because Hermes on older Android does not
 * always provide it, and a journal export that throws on encode would be a miserable bug
 * to find on a device. `encodeURIComponent` handles surrogate pairs correctly, which
 * `charCodeAt` alone would not.
 */
function encode(text: string): Uint8Array {
  const binary = unescape(encodeURIComponent(text));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Exports the user has already created, newest first, for the settings list. */
export async function listExports(
  adapter: StorageAdapter = storage(),
): Promise<{ filePath: RelativePath; sizeBytes: number }[]> {
  try {
    const names = await adapter.list(EXPORTS_DIRECTORY);
    const out: { filePath: RelativePath; sizeBytes: number }[] = [];

    for (const name of names) {
      if (!name.endsWith('.json') && !name.endsWith('.md') && !name.endsWith('.csv')) continue;
      const stat = await adapter.stat(`${EXPORTS_DIRECTORY}/${name}`);
      out.push({ filePath: `${EXPORTS_DIRECTORY}/${name}`, sizeBytes: stat?.sizeBytes ?? 0 });
    }

    return out.sort((a, b) => b.filePath.localeCompare(a.filePath));
  } catch {
    return [];
  }
}

/** Deletes one exported file. The journal itself is untouched. */
export async function deleteExport(
  filePath: RelativePath,
  adapter: StorageAdapter = storage(),
): Promise<void> {
  try {
    await adapter.remove(filePath);
  } catch (error) {
    logger.warn(`Could not remove export ${filePath}`, error);
  }
}

export { EXPORT_PRIVACY_WARNING, exportFileName };
export type { ExportFormat, ExportOptions };

/* ------------------------------------------------------------------ lock */

export interface JournalLockState {
  /** True when the user has switched the lock on in Settings. */
  enabled: boolean;
  /** True when the journal may currently be shown. */
  unlocked: boolean;
  /** What device authentication can do here, for the settings copy. */
  capability: BiometricCapability;
  /** Why the lock cannot be enabled, or null when it can. */
  blockedReason: string | null;
}

/**
 * In-memory unlock flag.
 *
 * Module-level and deliberately not persisted. Persisting "unlocked" would leave the
 * journal open after a restart, which is the exact failure a lock exists to prevent.
 */
let unlocked = false;

/** Called when the app is backgrounded, so returning to it re-locks. */
export function lockJournal(): void {
  unlocked = false;
}

export async function isJournalUnlocked(): Promise<boolean> {
  return unlocked;
}

/**
 * Asks the device to authenticate.
 *
 * Returns a typed result rather than throwing, so a screen can distinguish "wrong
 * fingerprint" from "this phone cannot do that" and word each differently.
 */
export async function unlockJournal(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const adapter = getBiometricAdapter();

  // The prompt text is generic on purpose. Anything derived from journal content would
  // leak a preview of a private entry to anyone glancing at the screen.
  const result = await adapter.authenticate('Unlock your journal');

  if (result.ok) {
    unlocked = true;
    return { ok: true };
  }
  return { ok: false, message: result.message };
}

/** Full state for the lock gate and for Settings. */
export async function lockState(enabled: boolean): Promise<JournalLockState> {
  const capability = await getBiometricAdapter().capability();
  const usable = capability.available && capability.enrolled;

  return {
    enabled,
    unlocked,
    capability,
    // Switching the lock on only makes sense if something could actually enforce it.
    blockedReason:
      enabled && !usable
        ? capability.reason ?? 'Device authentication is not available on this device.'
        : null,
  };
}

/**
 * Whether the journal should currently be hidden.
 *
 * One predicate so the tab, the entry list and any future deep link all agree. A lock that
 * some screens honour and others ignore is not a lock.
 */
export async function shouldHideJournal(enabled: boolean): Promise<boolean> {
  if (!enabled) return false;
  return !unlocked;
}
