/**
 * Journal export.
 *
 * `FEATURES/JOURNAL.md` requires export, and `SECURITY/PRIVACY.md` plus
 * `MASTER_BUILD_PROMPT.md` require that journal contents are never uploaded without
 * explicit consent. Those two rules together mean export is only ever:
 *
 *  - **local**, written to a file in app storage or handed to the platform share sheet;
 *  - **initiated by the user**, from a screen they opened on purpose; and
 *  - **reported honestly** about exactly what it contains.
 *
 * There is no upload path in this module and no network import. That is a design
 * constraint, not an oversight: adding one later must be a deliberate, reviewed change
 * with its own consent step, which is why the destination is always passed in explicitly
 * rather than defaulted.
 *
 * Three formats, because people export journals for genuinely different reasons: Markdown
 * to re-read or paste elsewhere, JSON to move between apps or back up, CSV for a
 * spreadsheet.
 */

import type { JournalEntry } from '@/repositories/journalRepository';

/** Formats `FEATURES/JOURNAL.md` implies a user might want. */
export const EXPORT_FORMATS = ['markdown', 'json', 'csv'] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  markdown: 'Markdown',
  json: 'JSON',
  csv: 'Spreadsheet (CSV)',
};

export const EXPORT_FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
  markdown: 'md',
  json: 'json',
  csv: 'csv',
};

export interface ExportOptions {
  /**
   * Include entry bodies.
   *
   * Off by default, and deliberately so: a list of dates and moods is enough to hand to
   * something that charts or backs up, and there is no reason to drag private text along
   * unless the user asks. When bodies are omitted the export says so in the output rather
   * than silently producing an empty-looking file.
   */
  includeBody?: boolean;
  /** Include tags. On by default; they are metadata the user created deliberately. */
  includeTags?: boolean;
  /** Include favourite entries only. */
  favouritesOnly?: boolean;
}

export interface ExportResult {
  /** The document text, ready to write to a file. */
  text: string;
  /** Entries actually included, after filtering. */
  count: number;
  /** Entries present before filtering, so the UI can say "12 of 30". */
  totalCount: number;
  /** One line describing what the file contains, shown before the user shares it. */
  summary: string;
}

/**
 * Renders entries as Markdown.
 *
 * Chosen as the default because it is the only format that stays readable in any text
 * editor twenty years from now, which is the point of keeping a journal.
 */
export function toMarkdown(entries: readonly JournalEntry[], options: ExportOptions = {}): ExportResult {
  const { includeBody = false, includeTags = true } = options;
  const filtered = selectEntries(entries, options);

  const lines: string[] = ['# Journal', ''];

  if (filtered.length === 0) {
    lines.push('_No entries matched._', '');
    return finish(lines.join('\n'), 0, entries.length, options);
  }

  lines.push(`${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'} exported.`, '');
  if (!includeBody) {
    lines.push(
      '> Entries are listed by date and mood. Text was not included in this export.',
      '',
    );
  }

  for (const entry of [...filtered].sort((a, b) => a.entryDate.localeCompare(b.entryDate))) {
    lines.push(`## ${entry.entryDate}`);

    const meta: string[] = [];
    if (entry.mood) meta.push(`Mood: ${entry.mood}`);
    if (entry.moodScore !== null) meta.push(`${entry.moodScore}/10`);
    if (includeTags && entry.tags && entry.tags.length > 0) meta.push(`Tags: ${entry.tags.join(', ')}`);
    if (entry.isFavorite) meta.push('Favourite');
    if (meta.length > 0) lines.push(`_${meta.join(' · ')}_`);

    lines.push('');
    if (includeBody) {
      lines.push(entry.body);
    }
    lines.push('');
  }

  return finish(lines.join('\n'), filtered.length, entries.length, options);
}

/**
 * Renders entries as JSON.
 *
 * Shaped for re-import rather than for display: `format` and `exportedAt` let a future
 * import recognise the file, and `schema` lets it refuse one from an incompatible version
 * instead of guessing at the fields.
 */
export function toJson(entries: readonly JournalEntry[], options: ExportOptions = {}): ExportResult {
  const { includeBody = false, includeTags = true } = options;
  const filtered = selectEntries(entries, options);

  const document = {
    format: 'lifeos-journal',
    version: 1,
    exportedAt: new Date().toISOString(),
    count: filtered.length,
    includesBody: includeBody,
    entries: [...filtered]
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate))
      .map((entry) => ({
        id: entry.id,
        date: entry.entryDate,
        ...(includeBody ? { title: entry.title, body: entry.body } : {}),
        ...(entry.mood ? { mood: entry.mood } : {}),
        ...(entry.moodScore !== null ? { moodScore: entry.moodScore } : {}),
        ...(includeTags && entry.tags ? { tags: entry.tags } : {}),
        isFavorite: entry.isFavorite,
        createdAt: new Date(entry.createdAt).toISOString(),
        updatedAt: new Date(entry.updatedAt).toISOString(),
      })),
  };

  return finish(JSON.stringify(document, null, 2), filtered.length, entries.length, options);
}

/**
 * Renders entries as CSV.
 *
 * Every field is quoted and internal quotes doubled, because journal text routinely
 * contains commas, newlines and quotation marks — an unquoted export of prose is a
 * corrupt spreadsheet.
 */
export function toCsv(entries: readonly JournalEntry[], options: ExportOptions = {}): ExportResult {
  const { includeBody = false } = options;
  const filtered = selectEntries(entries, options);

  const rows: string[] = [
    ['date', 'title', 'body', 'mood', 'mood_score', 'tags', 'favorite'].join(','),
  ];

  for (const entry of [...filtered].sort((a, b) => a.entryDate.localeCompare(b.entryDate))) {
    rows.push(
      [
        entry.entryDate,
        entry.title ?? '',
        includeBody ? entry.body : '',
        entry.mood ?? '',
        entry.moodScore === null ? '' : String(entry.moodScore),
        (entry.tags ?? []).join(' '),
        entry.isFavorite ? '1' : '0',
      ]
        .map(csvCell)
        .join(','),
    );
  }

  return finish(rows.join('\n'), filtered.length, entries.length, options);
}

/** Renders whatever format was asked for. */
export function exportEntries(
  entries: readonly JournalEntry[],
  format: ExportFormat,
  options: ExportOptions = {},
): ExportResult {
  switch (format) {
    case 'markdown':
      return toMarkdown(entries, options);
    case 'json':
      return toJson(entries, options);
    case 'csv':
      return toCsv(entries, options);
    default:
      return toMarkdown(entries, options);
  }
}

function finish(
  text: string,
  count: number,
  totalCount: number,
  options: ExportOptions,
): ExportResult {
  const parts = [`${count} of ${totalCount} entr${totalCount === 1 ? 'y' : 'ies'}`];
  if (!options.includeBody) parts.push('text not included');
  return { text, count, totalCount, summary: parts.join(' · ') };
}

function selectEntries(
  entries: readonly JournalEntry[],
  options: ExportOptions,
): JournalEntry[] {
  const filtered = options.favouritesOnly
    ? entries.filter((entry) => entry.isFavorite)
    : entries;
  // Most recent first is the working order; each renderer sorts chronologically itself.
  return [...filtered].sort((a, b) => b.entryDate.localeCompare(a.entryDate));
}

/** RFC 4180 field: always quoted, with internal quotes doubled. */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * A filename for the export.
 *
 * Includes the date so successive exports are distinguishable in a Files app, and uses
 * only characters that are legal on both iOS and Android filesystems.
 */
export function exportFileName(format: ExportFormat, today: DateKey): string {
  return `lifeos-journal-${today}.${EXPORT_FORMAT_EXTENSIONS[format]}`;
}

type DateKey = string;

/**
 * The warning shown before an export leaves the app.
 *
 * Stated in the product's own terms rather than as boilerplate: the point is that the
 * user is about to move private writing somewhere this app can no longer protect.
 */
export const EXPORT_PRIVACY_WARNING =
  'This creates a file on this device that contains your journal outside LifeOS. ' +
  'Anyone who can open that file can read it, and it will not be protected by the LifeOS ' +
  'lock. Store it somewhere you trust.';
