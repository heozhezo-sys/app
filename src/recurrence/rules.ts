/**
 * Recurrence arithmetic.
 *
 * `FEATURES/PRODUCTIVITY.md` requires recurring tasks and `FEATURES/FINANCE.md` implies
 * scheduled money. Both reduce to the same question — "does this rule fire on this local
 * calendar day?" — so they share this one implementation rather than growing two
 * half-correct copies of date logic.
 *
 * Three decisions worth stating:
 *
 * 1. **Occurrences are lazily materialised.** A daily rule does not create 3650 rows a
 *    year in advance. Occurrences are created for the days a user actually visits, or up
 *    to the current day for scheduled money. A rule that materialised every future date
 *    would grow without bound and make "delete this one instance" impossible.
 * 2. **`interval_count` carries "every 3 weeks" / "every 2 months"** without needing a
 *    separate vocabulary per unit.
 * 3. **Month-end clamps rather than skipping.** A rule for the 31st fires on 28 or 29
 *    February. The alternative — skipping the month — silently loses a rent payment,
 *    which is the worst possible failure for the one feature using this.
 */

import { addDays, diffDays, fromDateKey, type DateKey } from '@/utils/dates';

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;

export type Frequency = (typeof FREQUENCIES)[number];

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

/** The complete rule, as stored in `task_recurrence` / `recurring_transactions`. */
export interface RecurrenceRule {
  frequency: Frequency;
  /** 1 = every period, 3 = every third. Always a positive integer. */
  intervalCount: number;
  /** Days of week (0 = Sunday .. 6 = Saturday) for `weekly`. */
  weekdays?: readonly number[];
  /** Day of month 1-31 for `monthly`. Clamped to the month's length when it fires. */
  monthDay?: number;
  /** Inclusive first day. */
  startDate: DateKey;
  /** Inclusive last day, or null for open-ended. */
  endDate?: DateKey | null;
  /** Stop after this many occurrences, or null. */
  untilOccurrence?: number | null;
}

export function isValidFrequency(value: string): value is Frequency {
  return (FREQUENCIES as readonly string[]).includes(value);
}

/** Last day of a 0-based month. */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Whether a rule fires on `date`.
 *
 * The interval test is an index calculation rather than a scan:
 *
 *  - **daily/weekly-with-no-days**: whole days since the start must be a multiple of the
 *    interval.
 *  - **weekly with named days**: the day must be listed, *and* the number of whole weeks
 *    since the week containing the start must be a multiple of the interval. This is what
 *    makes "every 2 weeks on Mon and Thu" mean alternating weeks rather than every second
 *    Monday and the Thursday after it.
 *  - **monthly**: same month index modulo the interval, and the day matches (clamped).
 *  - **yearly**: same year index modulo the interval, and the month and day match.
 */
export function firesOn(rule: RecurrenceRule, date: DateKey): boolean {
  if (date < rule.startDate) return false;
  if (rule.endDate && date > rule.endDate) return false;

  const interval = Math.max(1, Math.trunc(rule.intervalCount));

  switch (rule.frequency) {
    case 'daily': {
      const elapsed = diffDays(rule.startDate, date);
      return elapsed >= 0 && elapsed % interval === 0;
    }

    case 'weekly': {
      const days = rule.weekdays ?? [];
      if (days.length === 0) {
        // No named days: behave like a daily rule stepped by the interval in weeks.
        const elapsed = diffDays(rule.startDate, date);
        return elapsed >= 0 && elapsed % (interval * 7) === 0;
      }
      if (!days.includes(fromDateKey(date).getDay())) return false;
      // Whole weeks since the week containing the start. This is what makes "every 2 weeks
      // on Mon and Thu" alternate weeks, instead of pairing every second Monday with the
      // Thursday that follows it.
      const elapsedDays = diffDays(rule.startDate, date);
      return elapsedDays >= 0 && Math.floor(elapsedDays / 7) % interval === 0;
    }

    case 'monthly': {
      const wanted = Math.min(rule.monthDay ?? 1, daysInMonthYear(date));
      if (fromDateKey(date).getDate() !== wanted) return false;
      const months = wholeMonthsApart(rule.startDate, date);
      return months >= 0 && months % interval === 0;
    }

    case 'yearly': {
      const start = fromDateKey(rule.startDate);
      const current = fromDateKey(date);
      if (current.getMonth() !== start.getMonth()) return false;
      const yearDelta = current.getFullYear() - start.getFullYear();
      if (yearDelta < 0 || yearDelta % interval !== 0) return false;
      // February 29 in a non-leap year clamps to the 28th rather than being skipped.
      const wantedDay = Math.min(start.getDate(), daysInMonth(current.getFullYear(), current.getMonth()));
      return current.getDate() === wantedDay;
    }

    default:
      return false;
  }
}

function daysInMonthYear(date: DateKey): number {
  const d = fromDateKey(date);
  return daysInMonth(d.getFullYear(), d.getMonth());
}

/**
 * Whole calendar months between two date keys.
 *
 * Computed from year/month indices rather than by dividing a millisecond difference: a
 * 30-day month would drift the count by a full week across a year.
 */
function wholeMonthsApart(start: DateKey, date: DateKey): number {
  const from = fromDateKey(start);
  const to = fromDateKey(date);
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

/**
 * The next date at or after `from` on which the rule fires.
 *
 * Returns `null` when the rule can never fire again — an end date already past, or an
 * `untilOccurrence` already exhausted. The caller must treat `null` as "retire this rule"
 * rather than retrying forever, which is why the scan is bounded.
 */
export function nextOccurrence(
  rule: RecurrenceRule,
  from: DateKey,
  occurrencesSoFar = 0,
): DateKey | null {
  if (rule.endDate && from > rule.endDate) return null;

  if (rule.untilOccurrence !== null && rule.untilOccurrence !== undefined) {
    if (occurrencesSoFar >= rule.untilOccurrence) return null;
  }

  // 800 days covers yearly rules plus a full cycle of February clamping. A yearly rule
  // whose end date is further out is handled by the first guard above.
  const MAX_SCAN = 800;

  for (let offset = 0; offset <= MAX_SCAN; offset += 1) {
    const candidate = addDays(from < rule.startDate ? rule.startDate : from, offset);
    if (rule.endDate && candidate > rule.endDate) return null;
    if (firesOn(rule, candidate)) return candidate;
  }

  return null;
}

/** Every firing date in a range, oldest first. */
export function occurrencesInRange(
  rule: RecurrenceRule,
  from: DateKey,
  to: DateKey,
  limit = 400,
): DateKey[] {
  const out: DateKey[] = [];
  let cursor = from < rule.startDate ? rule.startDate : from;

  for (let i = 0; i < Math.max(1, limit); i += 1) {
    const next = nextOccurrence(rule, cursor);
    if (next === null || next > to) break;
    out.push(next);
    cursor = addDays(next, 1);
  }

  return out;
}

/** How many times the rule has fired up to and including `date`. */
export function occurrencesBetween(rule: RecurrenceRule, from: DateKey, to: DateKey): number {
  return occurrencesInRange(rule, from, to, 1000).length;
}

/** Plain-language summary for the schedule editor, e.g. "Every 2 weeks on Mon, Thu". */
export function describeRule(rule: RecurrenceRule): string {
  const interval = Math.max(1, Math.trunc(rule.intervalCount));
  const every = interval === 1 ? 'Every' : `Every ${interval}`;

  switch (rule.frequency) {
    case 'daily':
      return interval === 1 ? 'Every day' : `${every} days`;

    case 'weekly': {
      const days = rule.weekdays ?? [];
      const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      if (days.length === 0) return interval === 1 ? 'Every week' : `${every} weeks`;
      const sorted = [...days].sort((a, b) => a - b);
      const list = sorted.map((day) => names[day] ?? '?').join(', ');
      return interval === 1 ? `Every week on ${list}` : `${every} weeks on ${list}`;
    }

    case 'monthly': {
      const day = rule.monthDay ?? 1;
      return interval === 1 ? `On day ${day} of the month` : `${every} months on day ${day}`;
    }

    case 'yearly': {
      const start = fromDateKey(rule.startDate);
      const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ];
      const name = months[start.getMonth()] ?? '';
      return interval === 1
        ? `Every year on ${start.getDate()} ${name}`
        : `${every} years on ${start.getDate()} ${name}`;
    }

    default:
      return 'Never';
  }
}

/** Validates a rule, returning a reason it is unusable or null. */
export function validateRule(rule: RecurrenceRule): string | null {
  if (!isValidFrequency(rule.frequency)) return 'Choose how often this repeats.';
  if (!Number.isInteger(rule.intervalCount) || rule.intervalCount < 1) {
    return 'Repeat must be at least once.';
  }
  if (rule.intervalCount > 52) return 'That repeat interval is too long.';
  if (rule.endDate && rule.endDate < rule.startDate) {
    return 'The end date is before the start date.';
  }
  if (rule.frequency === 'weekly') {
    const days = rule.weekdays ?? [];
    if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      return 'Days must run from Sunday (0) to Saturday (6).';
    }
  }
  if (rule.frequency === 'monthly') {
    const day = rule.monthDay ?? 1;
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return 'Choose a day between 1 and 31.';
    }
  }
  return null;
}
