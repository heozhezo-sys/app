/**
 * Reminder scheduling arithmetic.
 *
 * Pure and clock-injected, like `src/focus/timerMath.ts`, because "when is the next
 * reminder?" is exactly the kind of boundary behaviour that is otherwise untestable:
 * a DST transition, a midnight rollover, or a device clock that jumped backwards while
 * the app was closed.
 *
 * `FEATURES/NOTIFICATIONS.md` requires local notifications for habits, workouts, water,
 * reading, focus and goal deadlines. All of them reduce to the same question — "at what
 * wall-clock instant should this fire?" — so they share this one implementation.
 */

import { addDays, diffDays, fromDateKey, toDateKey, type DateKey } from '@/utils/dates';

/** What a reminder is attached to. Mirrors the `reminders.entity_type` vocabulary. */
export const REMINDER_TARGETS = [
  'habit',
  'workout',
  'water',
  'reading',
  'focus',
  'goal',
  'journal',
  'finance',
  'custom',
] as const;

export type ReminderTarget = (typeof REMINDER_TARGETS)[number];

/**
 * How often a reminder repeats.
 *
 * `once` fires a single time. The `*_weekdays` variants fire on named days, which is how
 * "weekdays at 7am" and "Mon/Wed/Fri" are expressed without a general cron parser.
 */
export const REMINDER_CADENCES = [
  'once',
  'daily',
  'weekdays',
  'weekly',
  'monthly',
] as const;

export type ReminderCadence = (typeof REMINDER_CADENCES)[number];

export interface ReminderSpec {
  target: ReminderTarget;
  /** The entity this reminder belongs to, e.g. a habit id. */
  entityId: string;
  /** Local `HH:MM`. */
  time: string;
  cadence: ReminderCadence;
  /** Days of week (0 = Sunday) for `weekly`. Empty means the day it was created. */
  weekdays?: readonly number[];
  /** Day of month (1-31) for `monthly`. Clamped to the month's length. */
  monthDay?: number;
}

/** Accepts `HH:MM` on a 24-hour clock. Mirrors `validateTime` in `src/utils/validation`. */
export function isValidTime(time: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(time)) return false;
  const [h, m] = time.split(':').map(Number);
  if (h === undefined || m === undefined) return false;
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/** Epoch ms for a local day and `HH:MM`. */
function instant(key: DateKey, time: string): number {
  const [h, m] = time.split(':').map(Number);
  const date = fromDateKey(key);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h ?? 0, m ?? 0, 0, 0).getTime();
}

/**
 * The first occurrence at or after `after` for a spec.
 *
 * Walks forward day by day from `after`'s local date. The walk is bounded, which matters:
 * a monthly reminder on the 31st, or a weekly one whose weekday never matches, would
 * otherwise loop forever. Returning `null` means "this rule can never fire" — for
 * example a weekly rule with no weekdays set — which the service surfaces as a
 * validation error rather than scheduling nothing silently.
 */
export function nextFireAt(spec: ReminderSpec, after: number): number | null {
  if (!isValidTime(spec.time)) return null;

  const start = new Date(after);
  // Search from today's local date; a reminder later today is still today.
  const today = toDateKey(start);

  // 400 days is enough to cover any monthly rule (including 31st in February) plus a
  // full year of slack, and bounds the loop unconditionally.
  const MAX_SCAN_DAYS = 400;

  for (let offset = 0; offset <= MAX_SCAN_DAYS; offset += 1) {
    const key = addDays(today, offset);
    if (!matchesDay(spec, key)) continue;

    const at = instant(key, spec.time);
    // Strictly after: a reminder whose time already passed today belongs to tomorrow.
    if (at > after) return at;
  }

  return null;
}

/** Whether a cadence fires on a given local day. */
function matchesDay(spec: ReminderSpec, key: DateKey): boolean {
  const dayOfWeek = fromDateKey(key).getDay();

  switch (spec.cadence) {
    case 'once':
    case 'daily':
      return true;

    case 'weekdays':
      // Monday-Friday. Named "weekdays" precisely because weekend days are excluded.
      return dayOfWeek >= 1 && dayOfWeek <= 5;

    case 'weekly': {
      const days = spec.weekdays ?? [];
      if (days.length === 0) return false;
      return days.includes(dayOfWeek);
    }

    case 'monthly': {
      const wanted = spec.monthDay ?? 1;
      const date = fromDateKey(key);
      // Clamp: a rule for the 31st must still fire in February, on the 28th or 29th,
      // rather than silently skipping the month.
      const lastDay = daysInMonth(date.getFullYear(), date.getMonth());
      return date.getDate() === Math.min(wanted, lastDay);
    }

    default:
      return false;
  }
}

/** Days in a 0-based month. */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * The complete list of future fire times for a spec, newest first, capped at `limit`.
 *
 * Used by the settings screen to preview "07:00 on Mon, Wed, Fri" rather than making the
 * user schedule reminders blind.
 */
export function upcomingFireTimes(
  spec: ReminderSpec,
  after: number,
  limit = 5,
): number[] {
  const out: number[] = [];
  let cursor = after;

  for (let i = 0; i < Math.max(1, Math.trunc(limit)); i += 1) {
    const next = nextFireAt(spec, cursor);
    if (next === null) break;
    out.push(next);
    // Resume the search just after this firing so the next one is genuinely later.
    cursor = next;
  }

  return out;
}

/**
 * Days between two keys, re-exported for screens that show "in N days".
 *
 * Exists here rather than importing `diffDays` directly in a screen because reminder
 * wording is domain language, and this keeps that vocabulary in one place.
 */
export function daysUntil(from: DateKey, to: DateKey): number {
  return diffDays(from, to);
}

/** `07:00`, normalised from `7:00`, for display. */
export function normaliseTime(time: string): string {
  if (!/^\d{1,2}:\d{2}$/.test(time)) return time;
  const [h, m] = time.split(':');
  return `${(h ?? '0').padStart(2, '0')}:${m ?? '00'}`;
}

/** True when `fireAt` is still in the future relative to `now`. */
export function isUpcoming(fireAt: number, now: number): boolean {
  return fireAt > now;
}
