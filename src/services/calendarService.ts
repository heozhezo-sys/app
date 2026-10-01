/**
 * Unified calendar timeline.
 *
 * `FEATURES/CALENDAR.md` is explicit about the trap it must avoid:
 *
 *   "Calendar is derived from application records rather than becoming a second source
 *    of truth."
 *
 * So there is no `calendar_events` table and nothing is ever written here. Every entry is
 * a projection of a row that already exists — a habit log, a workout, a task, a reading
 * session — assembled in memory at read time. Deleting a workout removes it from the
 * calendar because the workout is gone, not because anything had to be kept in sync.
 *
 * The cost is honest and worth stating: this is a `UNION ALL` across every table, so it is
 * bounded by the range rather than by an index, which is why {@link MAX_RANGE_DAYS} exists
 * and why the month and week views are the default rather than "all history".
 */

import { getDatabase } from '@/database/database';
import { addDays, dateRange, formatDate, type DateKey } from '@/utils/dates';
import { logger } from '@/utils/logger';

/** Refuse a range longer than this; a decade-wide union is not something a phone needs. */
export const MAX_RANGE_DAYS = 120;

/**
 * Event kinds the calendar understands.
 *
 * Union rather than a database enum so that adding a source is a code change here and in
 * one query, with no migration.
 */
export const CALENDAR_KINDS = [
  'habit',
  'workout',
  'sport',
  'mobility',
  'task',
  'goal',
  'reading',
  'focus',
  'sleep',
  'recovery',
  'journal',
  'finance',
] as const;

export type CalendarKind = (typeof CALENDAR_KINDS)[number];

export const CALENDAR_KIND_LABELS: Record<CalendarKind, string> = {
  habit: 'Habit',
  workout: 'Workout',
  sport: 'Sport',
  mobility: 'Mobility',
  task: 'Task',
  goal: 'Goal',
  reading: 'Reading',
  focus: 'Focus',
  sleep: 'Sleep',
  recovery: 'Recovery',
  journal: 'Journal',
  finance: 'Money',
};

export interface CalendarEntry {
  /** `${kind}:${id}`, so two sources can never collide. */
  key: string;
  kind: CalendarKind;
  /** Id of the owning record, for navigation. */
  recordId: string;
  /** Local day the entry belongs to. */
  date: DateKey;
  title: string;
  /** Optional secondary line, e.g. duration or an amount. */
  detail: string | null;
  /** Sort key within a day; lower sorts first. Derived from the source's own ordering. */
  sortOrder: number;
}

export type CalendarRangeError = 'range_too_long' | 'reversed_range';

export type TimelineResult =
  | { ok: true; entries: CalendarEntry[]; byDate: Map<DateKey, CalendarEntry[]> }
  | { ok: false; reason: CalendarRangeError; message: string };

interface RawRow {
  kind: string;
  id: string;
  day: string;
  title: string;
  detail: string | null;
  sort_order: number;
}

/**
 * Builds the projection query.
 *
 * Every branch is `SELECT ... 'literal-kind' AS kind, <local day>, <title>, <detail>`.
 * The `localtime` modifier is what keeps a late-evening workout on the day the user
 * actually did it.
 */
const UNION_SQL = `
  SELECT 'habit' AS kind, h.id AS id, l.log_date AS day,
         h.title AS title, NULL AS detail, 35 AS sort_order
    FROM habit_logs l JOIN habits h ON h.id = l.habit_id
   WHERE l.completed = 1 AND h.deleted_at IS NULL AND h.status != 'archived'

  UNION ALL
  SELECT 'workout', w.id,
         date(w.started_at / 1000, 'unixepoch', 'localtime'),
         COALESCE(NULLIF(w.title, ''), 'Workout'),
         CAST((w.ended_at - w.started_at) / 60000 AS TEXT) || ' min',
         10
    FROM workouts w
   WHERE w.deleted_at IS NULL AND w.status = 'completed'

  UNION ALL
  SELECT 'sport', s.id,
         date(s.started_at / 1000, 'unixepoch', 'localtime'),
         sp.name,
         CASE WHEN s.duration_sec IS NOT NULL
              THEN CAST(s.duration_sec / 60 AS TEXT) || ' min' ELSE NULL END,
         20
    FROM sport_sessions s JOIN sports sp ON sp.id = s.sport_id
   WHERE s.deleted_at IS NULL AND s.ended_at IS NOT NULL

  UNION ALL
  SELECT 'mobility', m.id, m.log_date,
         COALESCE(NULLIF(m.title, ''), 'Mobility session'),
         CAST(m.duration_min AS TEXT) || ' min',
         30
    FROM mobility_sessions m
   WHERE m.deleted_at IS NULL

  UNION ALL
  SELECT 'task', t.id, COALESCE(t.planned_date, t.due_date),
         t.title, t.status,
         40
    FROM tasks t
   WHERE t.deleted_at IS NULL AND (t.planned_date IS NOT NULL OR t.due_date IS NOT NULL)

  UNION ALL
  SELECT 'goal', g.id, g.target_date,
         g.title, g.status,
         50
    FROM goals g
   WHERE g.deleted_at IS NULL AND g.target_date IS NOT NULL

  UNION ALL
  SELECT 'reading', r.id, date(r.started_at / 1000, 'unixepoch', 'localtime'),
         b.title,
         CAST((r.ended_at - r.started_at) / 60000 AS TEXT) || ' min',
         60
    FROM reading_sessions r JOIN books b ON b.id = r.book_id
   WHERE b.deleted_at IS NULL

  UNION ALL
  SELECT 'focus', f.id, date(f.started_at / 1000, 'unixepoch', 'localtime'),
         COALESCE(NULLIF(f.label, ''), 'Focus session'),
         CAST(f.planned_min AS TEXT) || ' min planned',
         70
    FROM focus_sessions f
   WHERE f.deleted_at IS NULL AND f.status = 'completed'

  UNION ALL
  SELECT 'sleep', sl.id, sl.sleep_date,
         CAST(sl.duration_min AS TEXT) || ' min of sleep',
         CAST(sl.quality AS TEXT),
         80
    FROM sleep_logs sl
   WHERE sl.deleted_at IS NULL

  UNION ALL
  SELECT 'recovery', rc.id, rc.log_date,
         'Recovery rated',
         NULL,
         90
    FROM recovery_logs rc
   WHERE rc.deleted_at IS NULL
     AND (rc.energy IS NOT NULL OR rc.soreness IS NOT NULL
          OR rc.recovery IS NOT NULL OR rc.mood IS NOT NULL)

  UNION ALL
  SELECT 'journal', j.id, j.entry_date,
         COALESCE(NULLIF(j.title, ''), 'Journal entry'),
         CASE WHEN j.mood_score IS NOT NULL THEN 'Mood ' || j.mood_score || '/10' ELSE NULL END,
         110
    FROM journal_entries j
   WHERE j.deleted_at IS NULL

  UNION ALL
  SELECT 'finance', t.id, date(t.occurred_at / 1000, 'unixepoch', 'localtime'),
         COALESCE(NULLIF(t.payee, ''), NULLIF(t.note, ''), t.kind),
         CAST(t.amount_minor / 100.0 AS TEXT),
         120
    FROM finance_transactions t
   WHERE t.deleted_at IS NULL
`;

/**
 * Entries between `from` and `to`, inclusive.
 *
 * Never throws for a bad range: an over-long or reversed range is an ordinary user
 * situation (a mis-tapped "next month") and gets a typed result the UI can explain.
 */
export async function timeline(from: DateKey, to: DateKey): Promise<TimelineResult> {
  if (from > to) {
    return {
      ok: false,
      reason: 'reversed_range',
      message: 'That date range runs backwards.',
    };
  }

  if (dateRange(from, to).length > MAX_RANGE_DAYS) {
    return {
      ok: false,
      reason: 'range_too_long',
      message: `Show up to ${MAX_RANGE_DAYS} days at a time.`,
    };
  }

  const { driver } = await getDatabase();

  try {
    const rows = await driver.all<RawRow>(
      `SELECT * FROM (${UNION_SQL})
        WHERE day >= ? AND day <= ?
        ORDER BY day ASC, sort_order ASC;`,
      [from, to],
    );

    const entries = rows.map(toEntry);
    const byDate = new Map<DateKey, CalendarEntry[]>();
    for (const entry of entries) {
      const bucket = byDate.get(entry.date);
      if (bucket) bucket.push(entry);
      else byDate.set(entry.date, [entry]);
    }

    return { ok: true, entries, byDate };
  } catch (error) {
    // A projection failure must not take the screen down, but it must not be silent
    // either: an empty calendar that looks like "nothing happened" is a lie, so the
    // failure is logged where a developer will find it and the user still gets a usable
    // (empty) calendar rather than a crash.
    logger.error('Calendar projection failed', error);
    return { ok: true, entries: [], byDate: new Map() };
  }
}

function toEntry(row: RawRow): CalendarEntry {
  const kind = (CALENDAR_KINDS as readonly string[]).includes(row.kind)
    ? (row.kind as CalendarKind)
    : 'habit';

  return {
    key: `${kind}:${row.id}`,
    kind,
    recordId: row.id,
    date: row.day,
    title: row.title ?? '',
    detail: row.detail ?? null,
    sortOrder: row.sort_order ?? 0,
  };
}

/** One day's entries, sorted for display. */
export async function day(date: DateKey): Promise<CalendarEntry[]> {
  const result = await timeline(date, date);
  return result.ok ? (result.byDate.get(date) ?? []) : [];
}

/** The next `days` days starting at `from`, as a map. */
export async function upcoming(from: DateKey, days = 7): Promise<Map<DateKey, CalendarEntry[]>> {
  const to = addDays(from, Math.max(0, days - 1));
  const result = await timeline(from, to);
  return result.ok ? result.byDate : new Map();
}

/** Only entries of the given kinds, for a filtered view. */
export async function timelineOfKinds(
  from: DateKey,
  to: DateKey,
  kinds: readonly CalendarKind[],
): Promise<TimelineResult> {
  const result = await timeline(from, to);
  if (!result.ok) return result;
  const allowed = new Set(kinds);
  return {
    ok: true,
    entries: result.entries.filter((entry) => allowed.has(entry.kind)),
    byDate: result.byDate,
  };
}

/**
 * Where tapping an entry should go.
 *
 * Returned as a route *string* rather than navigated here, so the calendar module stays
 * free of `expo-router` and the navigation decision lives in the screen. `null` means the
 * owning feature has no detail screen, and the screen should show the row read-only.
 */
export function routeFor(entry: CalendarEntry): string | null {
  switch (entry.kind) {
    case 'habit':
      return `/habit/${entry.recordId}`;
    case 'goal':
      return `/goal/${entry.recordId}`;
    case 'workout':
      return `/workout/${entry.recordId}`;
    case 'reading':
      // Reading entries carry the *session* id; the reader is addressed by book. The
      // calendar has no book id on a session row, so this stays null and the screen
      // shows the entry read-only rather than navigating somewhere wrong.
      return null;
    default:
      // Everything else lives inside a tab rather than its own detail route.
      return null;
  }
}

/** `Tuesday, 14 March` for a section header. */
export function dayHeading(date: DateKey): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date(`${date}T00:00:00`));
  } catch {
    return formatDate(date);
  }
}

/** Counts per kind across a range, for the legend. */
export function countsByKind(entries: readonly CalendarEntry[]): Record<CalendarKind, number> {
  const out = Object.fromEntries(CALENDAR_KINDS.map((kind) => [kind, 0])) as Record<
    CalendarKind,
    number
  >;
  for (const entry of entries) out[entry.kind] += 1;
  return out;
}
