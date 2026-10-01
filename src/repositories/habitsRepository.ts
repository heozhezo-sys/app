/**
 * Habit persistence.
 *
 * Repositories are the ONLY layer that writes SQL. They convert rows to domain
 * objects, so no screen ever sees a snake_case column name.
 *
 * Soft deletes are used throughout (`deleted_at`). A hard delete cascades into
 * history; a soft delete hides the record while preserving it. Nothing in the app
 * hard-deletes user data outside an explicit, confirmed "erase" flow.
 */

import type { SqlDriver, SqlValue } from '@/database/driver';
import { getDatabase, notify, CHANNELS } from '@/database/database';
import { createId } from '@/utils/id';
import { addDays, dateRange, todayKey, type DateKey } from '@/utils/dates';
import type {
  Habit,
  HabitCadence,
  HabitLog,
  HabitLogSource,
  HabitStats,
  HabitStatus,
} from '@/types/habits';

interface HabitRow {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  color_index: number;
  cadence: HabitCadence;
  cadence_config: string | null;
  target_per_period: number;
  reminder_time: string | null;
  sort_order: number;
  status: HabitStatus;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

interface HabitLogRow {
  id: string;
  habit_id: string;
  log_date: string;
  count_value: number;
  note: string | null;
  source: HabitLogSource;
  created_at: number;
  updated_at: number;
}

function parseCadenceDays(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((d): d is number => typeof d === 'number') : [];
  } catch {
    // A corrupt cadence config must not make a habit unreadable.
    return [];
  }
}

function toHabit(row: HabitRow): Habit {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    icon: row.icon,
    colorIndex: row.color_index,
    cadence: row.cadence,
    cadenceDays: parseCadenceDays(row.cadence_config),
    targetPerPeriod: row.target_per_period,
    reminderTime: row.reminder_time,
    sortOrder: row.sort_order,
    status: row.status,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toLog(row: HabitLogRow): HabitLog {
  return {
    id: row.id,
    habitId: row.habit_id,
    logDate: row.log_date,
    countValue: row.count_value,
    note: row.note,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function driver(): Promise<SqlDriver> {
  return (await getDatabase()).driver;
}

/** True when the habit is scheduled on the given local day. */
export function isScheduledOn(habit: Habit, date: DateKey): boolean {
  if (habit.cadence === 'daily' || habit.cadence === 'weekly') return true;
  if (habit.cadenceDays.length === 0) return true;
  // Noon avoids any chance of a DST boundary shifting the weekday.
  const day = new Date(`${date}T12:00:00`).getDay();
  return habit.cadenceDays.includes(day);
}

export async function listHabits(includeArchived = false): Promise<Habit[]> {
  const db = await driver();
  const rows = await db.all<HabitRow>(
    `SELECT * FROM habits
     WHERE deleted_at IS NULL
       AND (? = 1 OR status = 'active')
     ORDER BY sort_order ASC, created_at ASC;`,
    [includeArchived ? 1 : 0],
  );
  return rows.map(toHabit);
}

export async function getHabit(id: string): Promise<Habit | null> {
  const db = await driver();
  const row = await db.first<HabitRow>(
    'SELECT * FROM habits WHERE id = ? AND deleted_at IS NULL;',
    [id],
  );
  return row ? toHabit(row) : null;
}

export interface HabitInsert {
  title: string;
  description: string | null;
  icon: string | null;
  colorIndex: number;
  cadence: HabitCadence;
  cadenceDays: number[];
  targetPerPeriod: number;
  reminderTime: string | null;
  sortOrder: number;
}

export async function insertHabit(input: HabitInsert): Promise<Habit> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO habits
       (id, title, description, icon, color_index, cadence, cadence_config,
        target_per_period, reminder_time, sort_order, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?);`,
    [
      id,
      input.title,
      input.description,
      input.icon,
      input.colorIndex,
      input.cadence,
      input.cadenceDays.length ? JSON.stringify(input.cadenceDays) : null,
      input.targetPerPeriod,
      input.reminderTime,
      input.sortOrder,
      now,
      now,
    ],
  );

  notify(CHANNELS.habits);
  notify(CHANNELS.today);

  const created = await getHabit(id);
  if (!created) throw new Error(`Habit ${id} vanished immediately after insert`);
  return created;
}

export async function updateHabit(
  id: string,
  patch: Partial<Omit<HabitInsert, 'sortOrder'>> & { sortOrder?: number },
): Promise<Habit | null> {
  const db = await driver();
  const now = Date.now();

  const columns: string[] = [];
  const params: SqlValue[] = [];
  const set = (column: string, value: SqlValue): void => {
    columns.push(`${column} = ?`);
    params.push(value);
  };

  if (patch.title !== undefined) set('title', patch.title);
  if (patch.description !== undefined) set('description', patch.description);
  if (patch.icon !== undefined) set('icon', patch.icon);
  if (patch.colorIndex !== undefined) set('color_index', patch.colorIndex);
  if (patch.cadence !== undefined) set('cadence', patch.cadence);
  if (patch.cadenceDays !== undefined) {
    set('cadence_config', patch.cadenceDays.length ? JSON.stringify(patch.cadenceDays) : null);
  }
  if (patch.targetPerPeriod !== undefined) set('target_per_period', patch.targetPerPeriod);
  if (patch.reminderTime !== undefined) set('reminder_time', patch.reminderTime);
  if (patch.sortOrder !== undefined) set('sort_order', patch.sortOrder);

  if (columns.length === 0) return getHabit(id);

  set('updated_at', now);
  params.push(id);

  await db.run(`UPDATE habits SET ${columns.join(', ')} WHERE id = ? AND deleted_at IS NULL;`, params);

  notify(CHANNELS.habits);
  notify(CHANNELS.today);
  return getHabit(id);
}

/** Archive hides a habit from the active list while keeping all history. */
export async function setHabitArchived(id: string, archived: boolean): Promise<void> {
  const db = await driver();
  const now = Date.now();
  await db.run(
    `UPDATE habits
     SET status = ?, archived_at = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL;`,
    [archived ? 'archived' : 'active', archived ? now : null, now, id],
  );
  notify(CHANNELS.habits);
  notify(CHANNELS.today);
}

/** Soft delete. History is retained; nothing cascades away. */
export async function softDeleteHabit(id: string): Promise<void> {
  const db = await driver();
  const now = Date.now();
  await db.run(
    `UPDATE habits SET deleted_at = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL;`,
    [now, now, id],
  );
  notify(CHANNELS.habits);
  notify(CHANNELS.today);
}

/**
 * Records a completion for one habit on one local day.
 *
 * Race-safe by construction. An earlier implementation did SELECT-then-INSERT, which
 * is NOT safe: two taps dispatched before either re-read both observe "no row" and
 * both attempt the INSERT, so one fails with a UNIQUE violation. (Found by
 * `habits.test.ts` -> "is idempotent under rapid duplicate taps".)
 *
 * The insert is therefore a single atomic `INSERT ... ON CONFLICT DO NOTHING`, and
 * the stored row is re-read afterwards. Two callers writing the same day always
 * converge on one row, and both receive it.
 */
export async function logCompletion(
  habitId: string,
  logDate: DateKey,
  options: { note?: string | null; source?: HabitLogSource; increment?: boolean } = {},
): Promise<HabitLog> {
  const db = await driver();
  const now = Date.now();

  const existing = await db.first<HabitLogRow>(
    'SELECT * FROM habit_logs WHERE habit_id = ? AND log_date = ?;',
    [habitId, logDate],
  );

  if (existing && options.increment) {
    await db.run('UPDATE habit_logs SET count_value = count_value + 1, updated_at = ? WHERE id = ?;', [
      now,
      existing.id,
    ]);
  } else if (!existing) {
    const id = createId();
    await db.run(
      `INSERT INTO habit_logs (id, habit_id, log_date, count_value, note, source, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?)
       ON CONFLICT (habit_id, log_date) DO NOTHING;`,
      [id, habitId, logDate, options.note ?? null, options.source ?? 'manual', now, now],
    );
  }

  // Read back whatever is actually stored, so the caller sees the winning row.
  const stored = await db.first<HabitLogRow>(
    'SELECT * FROM habit_logs WHERE habit_id = ? AND log_date = ?;',
    [habitId, logDate],
  );
  if (!stored) throw new Error(`Habit log for ${habitId} on ${logDate} could not be stored`);

  notify(CHANNELS.habits);
  notify(CHANNELS.today);
  return toLog(stored);
}

/** Removes a completion. Undo is a first-class operation, not a bug workaround. */
export async function removeCompletion(habitId: string, logDate: DateKey): Promise<void> {
  const db = await driver();
  await db.run('DELETE FROM habit_logs WHERE habit_id = ? AND log_date = ?;', [habitId, logDate]);
  notify(CHANNELS.habits);
  notify(CHANNELS.today);
}

export async function getLogsBetween(habitId: string, from: DateKey, to: DateKey): Promise<HabitLog[]> {
  const db = await driver();
  const rows = await db.all<HabitLogRow>(
    `SELECT * FROM habit_logs
     WHERE habit_id = ? AND log_date >= ? AND log_date <= ?
     ORDER BY log_date ASC;`,
    [habitId, from, to],
  );
  return rows.map(toLog);
}

/** Every completion in a day range, for the Today dashboard. */
export async function getLogsForRange(from: DateKey, to: DateKey): Promise<HabitLog[]> {
  const db = await driver();
  const rows = await db.all<HabitLogRow>(
    `SELECT * FROM habit_logs
     WHERE log_date >= ? AND log_date <= ?
     ORDER BY log_date ASC;`,
    [from, to],
  );
  return rows.map(toLog);
}

/**
 * Derives streaks and counts from history.
 *
 * Nothing is stored as a running total, so a corrupt counter cannot survive: these
 * numbers are always recomputed from the log rows.
 */
export async function computeHabitStats(habit: Habit, now: Date = new Date()): Promise<HabitStats> {
  const today = todayKey(now);
  const from = addDays(today, -365);
  const logs = await getLogsBetween(habit.id, from, today);
  const done = new Set(logs.map((l) => l.logDate));

  let currentStreak = 0;
  // A streak survives "today not done yet": we only break on a *missed* past day.
  for (let i = 0; ; i += 1) {
    const day = addDays(today, -i);
    if (done.has(day)) {
      currentStreak += 1;
      continue;
    }
    if (i === 0) continue; // today is still in progress
    if (!isScheduledOn(habit, day)) continue; // not a scheduled day
    break;
  }

  let longestStreak = 0;
  let running = 0;
  for (const day of dateRange(from, today)) {
    if (!isScheduledOn(habit, day)) continue;
    if (done.has(day)) {
      running += 1;
      if (running > longestStreak) longestStreak = running;
    } else if (day !== today) {
      running = 0;
    }
  }

  const last30 = dateRange(addDays(today, -29), today);
  const scheduledLast30 = last30.filter((day) => isScheduledOn(habit, day)).length;

  return {
    currentStreak,
    longestStreak,
    completedLast30Days: last30.filter((day) => done.has(day)).length,
    scheduledLast30Days: scheduledLast30,
    totalCompletions: logs.length,
  };
}
