/**
 * Journal tags.
 *
 * `journal_entries.tags` is a single TEXT column, so tags need a serialisation. JSON is
 * used rather than a delimiter because a delimiter is data: a user can type a comma or a
 * quote in a tag, and a naive join would then produce something that parses back into
 * different tags. JSON round-trips exactly, and the FTS5 index still tokenises the words
 * for search, because it indexes text rather than structure.
 *
 * Comparison is case- and whitespace-insensitive so "Work" and "work " are one tag, while
 * the original casing the user typed is preserved for display.
 *
 * Pure functions, no database.
 */

/** Stored form: a JSON array of strings, e.g. `["work","ideas"]`. */
export type TagInput = string[] | string | null | undefined;

/** Longest single tag. A tag is a short label, not a sentence. */
export const MAX_TAG_LENGTH = 32;
/** Most tags one entry may carry. */
export const MAX_TAGS = 12;

/** Normalised form used for comparison and storage. */
function canonical(tag: string): string {
  return tag.trim().toLowerCase();
}

/**
 * Cleans a list of tags: trimmed, de-duplicated case-insensitively, in first-seen order.
 *
 * Order is preserved rather than sorted, so the tags appear in the order the user typed
 * them, which is usually meaningful ("work" then "urgent", not alphabetical).
 */
export function normaliseTags(input: TagInput): string[] {
  const raw = Array.isArray(input) ? input : splitTagString(input);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const tag of raw) {
    if (typeof tag !== 'string') continue;

    const trimmed = tag.trim();
    if (trimmed === '') continue;

    // Cap the length before de-duplication so a pathological input cannot be used to make
    // a very large key.
    const capped = trimmed.slice(0, MAX_TAG_LENGTH);
    const key = canonical(capped);
    if (key === '' || seen.has(key)) continue;

    seen.add(key);
    out.push(capped);
    if (out.length >= MAX_TAGS) break;
  }

  return out;
}

/**
 * Splits free text into candidate tags.
 *
 * Commas and newlines are the separators, which is what a user typing "work, ideas" means.
 * Semicolons are accepted too because that is a habit on some keyboards.
 */
export function splitTagString(input: string | null | undefined): string[] {
  if (typeof input !== 'string') return [];
  return input.split(/[,;\n]/);
}

/**
 * Serialises tags for storage.
 *
 * Returns `null` for an empty list rather than `"[]"`, so "no tags" is stored as SQL NULL
 * and stays distinguishable from an empty string.
 */
export function serialiseTags(input: TagInput): string | null {
  const tags = normaliseTags(input);
  return tags.length === 0 ? null : JSON.stringify(tags);
}

/**
 * Parses the stored form.
 *
 * Returns an empty list for NULL, an empty string, or anything unparseable. A malformed
 * `tags` value must never prevent an entry from being read — the journal is the user's own
 * writing, and losing access to it because a tag string is odd would be far worse than
 * losing the tags.
 */
export function parseTags(stored: string | null | undefined): string[] {
  if (typeof stored !== 'string' || stored.trim() === '') return [];

  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return normaliseTags(parsed.filter((tag): tag is string => typeof tag === 'string'));
  } catch {
    // Older or hand-edited rows may hold a comma-separated string instead of JSON.
    return normaliseTags(splitTagString(stored));
  }
}

/**
 * The tags an entry shares with another, used for "related entries".
 *
 * Compared case-insensitively so differing casing does not hide a connection.
 */
export function sharedTags(a: TagInput, b: TagInput): string[] {
  const left = new Set(normaliseTags(a).map(canonical));
  return normaliseTags(b).filter((tag) => left.has(canonical(tag)));
}
