/**
 * Local calendar-date helpers.
 *
 * Everything here works on **local** calendar days, never UTC days. A user in UTC+13
 * logging a habit at 09:00 on the 2nd must get the 2nd, and the same log after a
 * timezone change must keep its original day.
 *
 * A "date key" is `YYYY-MM-DD` in local time. It is the join key for habit logs,
 * hydration, sleep and budgets.
 *
 * All arithmetic is done by constructing `Date` values in local time and formatting
 * them locally. Using `toISOString()` anywhere in this file would be a bug: it
 * converts to UTC and can shift the day.
 */

export type DateKey = string;

const pad = (n: number, width = 2): string => String(Math.abs(n)).padStart(width, '0');

/** Formats a Date as its local `YYYY-MM-DD` key. */
export function toDateKey(date: Date): DateKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today in local time. */
export function todayKey(now: Date = new Date()): DateKey {
  return toDateKey(now);
}

/** Parses `YYYY-MM-DD` into a Date at local midnight. */
export function fromDateKey(key: DateKey): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) throw new RangeError(`Invalid date key: ${key}`);
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m) - 1;
  const day = Number(d);
  const date = new Date(year, month, day, 0, 0, 0, 0);
  // Reject impossible dates such as 2026-02-31, which JS would roll over silently.
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    throw new RangeError(`Invalid calendar date: ${key}`);
  }
  return date;
}

export function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    fromDateKey(value);
    return true;
  } catch {
    return false;
  }
}

/** Shifts a date key by whole days. Daylight-saving transitions are handled by
 * constructing the target date from its parts rather than adding milliseconds. */
export function addDays(key: DateKey, days: number): DateKey {
  const date = fromDateKey(key);
  return toDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12));
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function diffDays(from: DateKey, to: DateKey): number {
  const a = fromDateKey(from);
  const b = fromDateKey(to);
  // Anchor at noon so a DST shift cannot produce a 23h or 25h "day".
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / 86_400_000);
}

/** Inclusive list of date keys between two keys. */
export function dateRange(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  const span = diffDays(from, to);
  for (let i = 0; i <= span; i += 1) out.push(addDays(from, i));
  return out;
}

export type WeekStart = 0 | 1; // 0 = Sunday, 1 = Monday

/** Week start key containing `key`, honouring the user's locale preference. */
export function startOfWeek(key: DateKey, weekStartsOn: WeekStart = 1): DateKey {
  const date = fromDateKey(key);
  const day = date.getDay();
  const delta = (day - weekStartsOn + 7) % 7;
  return addDays(key, -delta);
}

export function endOfWeek(key: DateKey, weekStartsOn: WeekStart = 1): DateKey {
  return addDays(startOfWeek(key, weekStartsOn), 6);
}

/** ISO-8601 week number, used for weekly reviews and budgets. */
export function isoWeekKey(key: DateKey): string {
  const date = fromDateKey(key);
  // Monday = 0 ... Sunday = 6.
  const dayNumber = (date.getDay() + 6) % 7;
  /*
   * The Thursday of this ISO week. Its *year* is the ISO year, which is what defines
   * week 1 as the week containing the first Thursday.
   *
   * The `- dayNumber` matters: shifting by a fixed +3 lands on the Sunday of the current
   * week for a Thursday, which puts every Thursday (and every day after it) a week too
   * high. Noon avoids a DST boundary moving the date.
   */
  const thursday = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() - dayNumber + 3,
    12,
  );
  const isoYear = thursday.getFullYear();

  // Week 1 is the week containing 4 January, which is always in ISO week 1.
  const firstWeekStart = startOfWeek(toDateKey(new Date(isoYear, 0, 4, 12)), 1);
  const week = Math.round(diffDays(firstWeekStart, toDateKey(thursday)) / 7) + 1;

  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** `YYYY-MM` budget period. */
export function monthKey(key: DateKey): string {
  return key.slice(0, 7);
}

export function yearKey(key: DateKey): string {
  return key.slice(0, 4);
}

/** `HH:MM` in local time, for reminders. */
export function toTimeString(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Epoch ms for a given day and `HH:MM` in local time. DST-invalid times resolve forward. */
export function dateTimeToEpoch(key: DateKey, time: string): number {
  const date = fromDateKey(key);
  const [h, m] = time.split(':');
  const hours = Number(h ?? 0);
  const minutes = Number(m ?? 0);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0, 0).getTime();
}

const DAY_MS = 86_400_000;

/** Human-friendly relative time for list rows. */
export function formatRelativeDay(key: DateKey, now: Date = new Date()): string {
  const today = toDateKey(now);
  const delta = diffDays(key, today);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Yesterday';
  if (delta === -1) return 'Tomorrow';
  if (delta > 1 && delta < 7) return `${delta} days ago`;
  if (delta < -1 && delta > -7) return `In ${Math.abs(delta)} days`;
  return formatDate(key, now);
}

/** Locale-aware date, with the year omitted when it matches the current one. */
export function formatDate(key: DateKey, now: Date = new Date()): string {
  const date = fromDateKey(key);
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'short',
      ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    }).format(date);
  } catch {
    // Hermes without full ICU: fall back to an unambiguous numeric form.
    return `${key.slice(8, 10)}/${key.slice(5, 7)}${
      date.getFullYear() === now.getFullYear() ? '' : `/${key.slice(0, 4)}`
    }`;
  }
}

export { DAY_MS };
