/**
 * Journal use cases.
 *
 * **Privacy is a structural property here, not a promise in a comment.**
 * `FEATURES/JOURNAL.md` requires that journal contents are never transmitted silently, so
 * this module imports no networking library and offers no sync, share or upload path. A
 * test walks the journal module graph and fails if one ever appears — a privacy claim that
 * lives only in a comment decays the first time someone adds an import.
 *
 * Entries are stored unencrypted in the app sandbox. The optional lock is a UI gate backed
 * by SecureStore and is not, and must not be described as, encryption at rest.
 */

import * as repository from '@/repositories/journalRepository';
import type { JournalAttachment, JournalEntry } from '@/repositories/journalRepository';
import {
  MAX_BODY_LENGTH,
  MAX_MOOD_LENGTH,
  MAX_TITLE_LENGTH,
} from '@/repositories/journalRepository';
import { ValidationError } from '@/services/errors';
import type { FieldErrors } from '@/utils/validation';
import { getStorage } from '@/services/booksService';
import { serialiseTags, type TagInput } from '@/journal/tags';
import type { SearchStrategy } from '@/journal/search';
import { todayKey, type DateKey } from '@/utils/dates';
import { logger } from '@/utils/logger';

/** Injectable clock. Production uses `() => Date.now()`. */
export type Clock = () => number;

let clock: Clock = () => Date.now();

export function setClock(next: Clock): void {
  clock = next;
}

export function resetClock(): void {
  clock = () => Date.now();
}

function today(): DateKey {
  return todayKey(new Date(clock()));
}

export interface EntryInput {
  entryDate?: DateKey;
  title?: string | null;
  body: string;
  mood?: string | null;
  moodScore?: number | null;
  tags?: TagInput;
}

/**
 * Validates the fields common to create and edit.
 *
 * A journal entry must have a body. `JOURNAL.md` allows a title to be absent, but a
 * body-less entry is not a journal entry.
 */
function validate(input: {
  body: string;
  title?: string | null;
  mood?: string | null;
  moodScore?: number | null;
}): {
  title: string | null;
  body: string;
  mood: string | null;
  moodScore: number | null;
} {
  const fields: FieldErrors = {};

  const body = (input.body ?? '').trim();
  if (body === '') {
    fields.body = 'Write something before saving.';
  } else if (body.length > MAX_BODY_LENGTH) {
    fields.body = 'That entry is too long.';
  }

  const title = input.title?.trim() ?? '';
  if (title.length > MAX_TITLE_LENGTH) fields.title = 'That title is too long.';

  const mood = input.mood?.trim() ?? '';
  if (mood.length > MAX_MOOD_LENGTH) fields.mood = 'That mood label is too long.';

  if (
    input.moodScore !== undefined &&
    input.moodScore !== null &&
    (!Number.isInteger(input.moodScore) || input.moodScore < 1 || input.moodScore > 10)
  ) {
    fields.moodScore = 'Rate your mood from 1 to 10.';
  }

  if (Object.keys(fields).length > 0) throw new ValidationError(fields);

  // Empty strings become NULL so "absent" is stored as absent rather than as "".
  return {
    title: title === '' ? null : title,
    body,
    mood: mood === '' ? null : mood,
    moodScore: input.moodScore ?? null,
  };
}

export async function createEntry(input: EntryInput): Promise<JournalEntry> {
  const clean = validate(input);
  return repository.insertEntry({
    entryDate: input.entryDate ?? today(),
    title: clean.title,
    body: clean.body,
    mood: clean.mood,
    moodScore: clean.moodScore,
    isFavorite: false,
    tags: serialiseTags(input.tags),
  });
}
/**
 * Edits an entry.
 *
 * Only supplied fields are written, so changing the body does not clear the title the user
 * already wrote. Validation runs on the fields present, so an edit cannot bypass the rules
 * the create path applies.
 */
export async function editEntry(
  id: string,
  input: Partial<EntryInput>,
): Promise<JournalEntry | null> {
  const patch: Parameters<typeof repository.updateEntry>[1] = {};
  const clean = validate({
    body: input.body ?? 'placeholder',
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.mood !== undefined ? { mood: input.mood } : {}),
    ...(input.moodScore !== undefined ? { moodScore: input.moodScore } : {}),
  });

  if (input.entryDate !== undefined) patch.entryDate = input.entryDate;
  if (input.title !== undefined) patch.title = clean.title;
  if (input.body !== undefined) patch.body = clean.body;
  if (input.mood !== undefined) patch.mood = clean.mood;
  if (input.moodScore !== undefined) patch.moodScore = clean.moodScore;
  if (input.tags !== undefined) patch.tags = serialiseTags(input.tags);

  return repository.updateEntry(id, patch);
}

export async function getEntry(id: string): Promise<JournalEntry | null> {
  return repository.getEntry(id);
}

export async function listEntries(options?: Parameters<typeof repository.listEntries>[0]) {
  return repository.listEntries(options);
}

export async function listFavorites(): Promise<JournalEntry[]> {
  return repository.listFavorites();
}

export async function listRelated(id: string): Promise<JournalEntry[]> {
  return repository.listRelated(id);
}

export async function toggleFavorite(id: string): Promise<JournalEntry | null> {
  return repository.toggleFavorite(id);
}

export interface JournalSearchResult {
  entries: JournalEntry[];
  /** Which engine answered, so the UI can say it fell back rather than imply speed. */
  strategy: SearchStrategy;
}

/** Searches entries. Runs entirely on the device. */
export async function search(
  query: string,
  options?: { limit?: number; favouritesOnly?: boolean },
): Promise<JournalSearchResult> {
  const outcome = await repository.searchEntries(query, options);
  return { entries: outcome.results, strategy: outcome.strategy };
}

/**
 * Removes an entry.
 *
 * Soft-deleted, not erased: the body is the user's own writing, and a mistaken tap should
 * not destroy it irreversibly.
 */
export async function deleteEntry(id: string): Promise<void> {
  return repository.softDeleteEntry(id);
}

/* -------------------------------------------------------------- attachments */

/** Directory that holds journal attachment bytes, relative to documents storage. */
export const ATTACHMENTS_DIRECTORY = 'journal';

/**
 * Attaches a file that has already been copied into app storage.
 *
 * Takes a stored path rather than a picker URI so the copy is the caller's explicit,
 * visible step. `JOURNAL.md` says entries persist immediately; nothing here overwrites an
 * existing file without the caller having arranged it.
 */
export async function attachFile(input: {
  entryId: string;
  storedPath: string;
  mimeType?: string | null;
  sizeBytes?: number;
}): Promise<JournalAttachment> {
  if (!input.entryId) throw new ValidationError({ entryId: 'An entry is required.' });
  if (!input.storedPath || input.storedPath.trim() === '') {
    throw new ValidationError({ file: 'Choose a file to attach.' });
  }

  return repository.insertAttachment({
    entryId: input.entryId,
    fileName: input.storedPath,
    mimeType: input.mimeType ?? null,
    sizeBytes: Math.max(0, Math.trunc(input.sizeBytes ?? 0)),
  });
}

export async function listAttachments(entryId: string): Promise<JournalAttachment[]> {
  return repository.listAttachments(entryId);
}

/**
 * Detaches a file, hiding the row before deleting the bytes.
 *
 * Same ordering as book deletion (ADR-0017): a crash between the two leaves an orphaned
 * file, which is recoverable, rather than a row pointing at nothing.
 */
export async function detachFile(id: string): Promise<void> {
  const path = await repository.softDeleteAttachment(id);
  if (!path) return;

  try {
    await getStorage().remove(path);
  } catch (error) {
    // The row is already hidden; a leftover file is a housekeeping problem, not data loss,
    // so it is logged rather than surfaced as a failure the user must act on.
    logger.warn(`Could not remove the journal attachment at ${path}`, error);
  }
}
