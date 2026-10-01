/**
 * Achievement evaluation.
 *
 * ARCHITECTURE.md: "Historical events are the source of truth. Derive totals from
 * logs/sessions where practical." So every metric here is a `SELECT COUNT(*)` or `SUM`
 * over stored records. **No counter column is ever incremented**, which means progress
 * cannot drift from the history it summarises — deleting a workout lowers your workout
 * count again, exactly as it should.
 *
 * This is the deliberate opposite of a badge table that stores `progress = 12` and
 * increments it on every tap. That design cannot recover from a bad write, a restore
 * from backup, or a user deleting a record, and all three of those happen in a local-first
 * app.
 */

import type { SqlDriver, SqlValue } from '@/database/driver';
import type { AchievementMetric } from './catalogue';

/**
 * Every metric as one number, from one pass over the database.
 *
 * A single query per table rather than one per achievement: with 40+ achievements and a
 * hand-written `COUNT` for each, the alternative is 40 queries every time the user opens
 * the screen. This is a deliberate trade of a little SQL for a bounded, predictable cost.
 */
export type MetricSnapshot = {
  [K in AchievementMetric]: number;
};

interface CountRow {
  n: number | null;
}

/** Reads a single count, treating `COUNT(*)` over no rows (0) correctly. */
async function countOf(
  db: SqlDriver,
  sql: string,
  params: readonly SqlValue[] = [],
): Promise<number> {
  const row = await db.first<CountRow>(sql, params);
  return row?.n ?? 0;
}

/**
 * Computes every achievement metric in one call.
 *
 * Called after any write that could change progress, and on opening the achievements
 * screen. It is read-only, so calling it twice is harmless — which matters, because the
 * unlock step below is deliberately idempotent.
 */
export async function computeMetrics(db: SqlDriver): Promise<MetricSnapshot> {
  const [
    habitLogs,
    habitStreak,
    goalsCreated,
    goalsCompleted,
    tasksCompleted,
    workouts,
    sportSessions,
    mobilitySessions,
    booksAdded,
    booksFinished,
    readingMinutes,
    focusSessions,
    focusMinutes,
    journalEntries,
    waterDays,
    sleepNights,
    recoveryDays,
    financeTransactions,
    distinctDays,
  ] = await Promise.all([
    countOf(
      db,
      'SELECT COUNT(*) AS n FROM habit_logs WHERE completed = 1;',
    ),
    longestHabitStreak(db),
    countOf(db, 'SELECT COUNT(*) AS n FROM goals WHERE deleted_at IS NULL;'),
    countOf(
      db,
      `SELECT COUNT(*) AS n FROM goals WHERE deleted_at IS NULL AND status = 'completed';`,
    ),
    countOf(
      db,
      `SELECT COUNT(*) AS n FROM tasks WHERE deleted_at IS NULL AND status = 'done';`,
    ),
    countOf(
      db,
      `SELECT COUNT(*) AS n FROM workouts WHERE deleted_at IS NULL AND status = 'completed';`,
    ),
    countOf(
      db,
      'SELECT COUNT(*) AS n FROM sport_sessions WHERE deleted_at IS NULL AND ended_at IS NOT NULL;',
    ),
    countOf(db, 'SELECT COUNT(*) AS n FROM mobility_sessions WHERE deleted_at IS NULL;'),
    countOf(db, 'SELECT COUNT(*) AS n FROM books WHERE deleted_at IS NULL;'),
    countOf(
      db,
      `SELECT COUNT(*) AS n FROM books WHERE deleted_at IS NULL AND status = 'finished';`,
    ),
    countOf(
      db,
      'SELECT SUM(ended_at - started_at) / 60000 AS n FROM reading_sessions;',
    ),
    countOf(
      db,
      `SELECT COUNT(*) AS n FROM focus_sessions
        WHERE deleted_at IS NULL AND status IN ('completed', 'abandoned');`,
    ),
    countOf(
      db,
      `SELECT COALESCE(SUM(actual_sec), 0) / 60 AS n FROM focus_sessions
        WHERE deleted_at IS NULL AND status = 'completed';`,
    ),
    countOf(db, 'SELECT COUNT(*) AS n FROM journal_entries WHERE deleted_at IS NULL;'),
    countOf(
      db,
      `SELECT COUNT(DISTINCT log_date) AS n FROM water_logs WHERE deleted_at IS NULL;`,
    ),
    countOf(
      db,
      `SELECT COUNT(DISTINCT sleep_date) AS n FROM sleep_logs WHERE deleted_at IS NULL;`,
    ),
    countOf(
      db,
      `SELECT COUNT(*) AS n FROM recovery_logs
        WHERE deleted_at IS NULL
          AND (energy IS NOT NULL OR soreness IS NOT NULL
               OR recovery IS NOT NULL OR mood IS NOT NULL);`,
    ),
    countOf(
      db,
      'SELECT COUNT(*) AS n FROM finance_transactions WHERE deleted_at IS NULL;',
    ),
    activeDayCount(db),
  ]);

  return {
    habit_logs: habitLogs,
    habit_longest_streak: habitStreak,
    goals_created: goalsCreated,
    goals_completed: goalsCompleted,
    tasks_completed: tasksCompleted,
    workouts,
    sport_sessions: sportSessions,
    mobility_sessions: mobilitySessions,
    books_added: booksAdded,
    books_finished: booksFinished,
    reading_minutes: Math.trunc(readingMinutes),
    focus_sessions: focusSessions,
    focus_minutes: Math.trunc(focusMinutes),
    journal_entries: journalEntries,
    water_days: waterDays,
    sleep_nights: sleepNights,
    recovery_days: recoveryDays,
    finance_transactions: financeTransactions,
    distinct_days_logged: distinctDays,
  };
}

/**
 * The longest run of consecutive local days on which any habit was logged.
 *
 * Computed by walking each habit's `log_date` list in SQL order rather than in JS, so a
 * user with years of history does not have to pull every log row onto the JS thread just
 * to count a gap. Dates are `YYYY-MM-DD` local keys, so lexicographic ordering *is*
 * chronological ordering and no date parsing is needed here.
 */
export async function longestHabitStreak(db: SqlDriver): Promise<number> {
  const rows = await db.all<{ habit_id: string; log_date: string }>(
    `SELECT habit_id, log_date FROM habit_logs
      WHERE completed = 1
      GROUP BY habit_id, log_date
      ORDER BY habit_id, log_date;`,
  );

  // Group by habit, preserving the SQL ordering, then walk each list tracking the
  // previous day and the current run.
  let best = 0;
  let current = 0;
  let previousHabit: string | null = null;
  let previousDate: string | null = null;

  for (const row of rows) {
    if (row.habit_id !== previousHabit) {
      // New habit: restart the run rather than chaining it onto the previous habit's.
      previousHabit = row.habit_id;
      current = 1;
      previousDate = row.log_date;
      best = Math.max(best, current);
      continue;
    }

    current = previousDate !== null && isNextDay(previousDate, row.log_date) ? current + 1 : 1;
    previousDate = row.log_date;
    best = Math.max(best, current);
  }

  return best;
}

/**
 * Whether `next` is the calendar day immediately after `previous`.
 *
 * Implemented by parsing the `YYYY-MM-DD` key into UTC parts and adding one day. UTC is
 * safe here specifically because these are *calendar keys*, not instants: `YYYY-MM-DD`
 * parsed as UTC midnight and shifted by exactly 86_400_000 ms lands on the next key with
 * no DST ambiguity, since no local timezone is involved.
 */
function isNextDay(previous: string, next: string): boolean {
  const previousMs = Date.parse(`${previous}T00:00:00Z`);
  const nextMs = Date.parse(`${next}T00:00:00Z`);
  if (Number.isNaN(previousMs) || Number.isNaN(nextMs)) return false;
  return nextMs - previousMs === 86_400_000;
}

/**
 * How many distinct local days have any record at all.
 *
 * This is the "days_logged" metric behind the milestone achievements. It unions the date
 * columns from every log-like table, so it needs a `UNION` (deduplicating) rather than
 * summing each table's count — otherwise logging water and sleep on one day would count
 * as two days.
 */
export async function activeDayCount(db: SqlDriver): Promise<number> {
  const row = await db.first<{ n: number | null }>(
    `SELECT COUNT(*) AS n FROM (
       SELECT log_date AS day FROM habit_logs   WHERE completed = 1
       UNION
       SELECT log_date AS day FROM water_logs   WHERE deleted_at IS NULL
       UNION
       SELECT sleep_date AS day FROM sleep_logs  WHERE deleted_at IS NULL
       UNION
       SELECT log_date AS day FROM recovery_logs WHERE deleted_at IS NULL
       UNION
       SELECT log_date AS day FROM mobility_sessions WHERE deleted_at IS NULL
       UNION
       SELECT entry_date AS day FROM journal_entries WHERE deleted_at IS NULL
       UNION
       SELECT date(started_at / 1000, 'unixepoch', 'localtime') AS day
         FROM sport_sessions WHERE deleted_at IS NULL AND ended_at IS NOT NULL
       UNION
       SELECT date(ended_at / 1000, 'unixepoch', 'localtime') AS day
         FROM workouts WHERE deleted_at IS NULL AND ended_at IS NOT NULL
     );`,
  );
  return row?.n ?? 0;
}

/**
 * Progress toward one achievement, as a 0-100 percentage.
 *
 * Rounded **down**. Rounding up would let 3 of 4 read as "100%" and unlock a milestone
 * the user has not reached, which is precisely the kind of quietly wrong number this
 * project treats as a defect.
 */
export function progressPercent(current: number, threshold: number): number {
  if (threshold <= 0) return 100;
  const ratio = Math.max(0, current) / threshold;
  return Math.min(100, Math.floor(ratio * 100));
}

/** Whether the metric has reached the threshold. */
export function isUnlocked(current: number, threshold: number): boolean {
  return current >= threshold;
}
