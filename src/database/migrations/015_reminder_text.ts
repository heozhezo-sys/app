import type { Migration } from './types';

/**
 * 015 — Reminder display text.
 *
 * Migration 001 created `reminders` without `title`/`body`. That was a real gap: a local
 * notification fires while the app is closed, so it cannot derive its wording from the
 * habit, goal or workout record at that moment without opening the database from a
 * background context — which is precisely what a local notification must not do.
 *
 * Migration 001 is immutable (ADR-0007: released migrations are never edited), so these
 * columns arrive as an additive migration instead.
 *
 * `ALTER TABLE ... ADD COLUMN` in SQLite cannot add a NOT NULL column without a default,
 * and there is nothing sensible to default a notification's text to. So both are
 * nullable, and `RemindersRepository` substitutes empty strings on read. Existing rows
 * keep working: they simply have no text until they are next written.
 *
 * The `recurrence` schema (014) deliberately left reminders alone, because a reminder's
 * repeat rule lives in `cadence` plus the spec used at schedule time. This migration only
 * adds the words, not the scheduling.
 */
export const migration015: Migration = {
  version: 15,
  name: 'reminder_text',
  statements: [
    `ALTER TABLE reminders ADD COLUMN title TEXT;`,
    `ALTER TABLE reminders ADD COLUMN body TEXT;`,
  ],
};
