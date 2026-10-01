/**
 * Recovery persistence: daily ratings and mobility sessions.
 *
 * Two conventions from migration 013 are load-bearing here:
 *
 * - `recovery_logs` is UNIQUE on `log_date`, so rating a day twice **updates** that day
 *   rather than accumulating contradictory rows. The upsert below is what enforces it;
 *   a plain INSERT would throw a constraint error on the user's second tap.
 * - `mobility_sessions` is an event stream, so repeats on one day are legal and each gets
 *   its own row.
 *
 * Ratings are stored exactly as the user entered them. No derived "score" column exists,
 * because `FEATURES/RECOVERY.md` forbids presenting these as measurements.
 */

import type { SqlDriver } from '@/database/driver';
import { getDatabase, notify, CHANNELS } from '@/database/database';
import { createId } from '@/utils/id';
import type { DateKey } from '@/utils/dates';
import type { RecoveryRating, RecoveryRatings } from '@/health/recoveryMath';
import type { MobilityKind } from '@/health/mobilityMath';

export interface RecoveryLog {
  id: string;
  logDate: DateKey;
  energy: number | null;
  soreness: number | null;
  recovery: number | null;
  mood: number | null;
  notes: string | null;
  loggedAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface MobilitySession {
  id: string;
  logDate: DateKey;
  kind: MobilityKind;
  title: string | null;
  durationMin: number;
  intensity: number | null;
  notes: string | null;
  performedAt: number;
  createdAt: number;
  updatedAt: number;
}

async function driver(): Promise<SqlDriver> {
  return (await getDatabase()).driver;
}

function announce(): void {
  notify(CHANNELS.health);
  notify(CHANNELS.today);
}

/** Narrows a partial rating map to the four nullable columns the table stores. */
function ratingColumns(ratings: RecoveryRatings): {
  energy: number | null;
  soreness: number | null;
  recovery: number | null;
  mood: number | null;
} {
  return {
    energy: ratings.energy ?? null,
    soreness: ratings.soreness ?? null,
    recovery: ratings.recovery ?? null,
    mood: ratings.mood ?? null,
  };
}

/* ------------------------------------------------------------- daily ratings */

interface RecoveryRow {
  id: string;
  log_date: DateKey;
  energy: number | null;
  soreness: number | null;
  recovery: number | null;
  mood: number | null;
  notes: string | null;
  logged_at: number;
  created_at: number;
  updated_at: number;
}

function toRecovery(row: RecoveryRow): RecoveryLog {
  return {
    id: row.id,
    logDate: row.log_date,
    energy: row.energy,
    soreness: row.soreness,
    recovery: row.recovery,
    mood: row.mood,
    notes: row.notes,
    loggedAt: row.logged_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Writes a day's ratings, replacing that day's previous values.
 *
 * The upsert matches on the partial unique index (`WHERE deleted_at IS NULL`), which is
 * why the conflict target carries the same predicate. Re-rating today is the normal
 * case — a user's mood at 09:00 and again at 21:00 is one day, described twice.
 */
export async function upsertRecoveryLog(input: {
  logDate: DateKey;
  ratings: RecoveryRatings;
  notes: string | null;
  loggedAt: number;
}): Promise<RecoveryLog> {
  const db = await driver();
  const now = Date.now();
  const { energy, soreness, recovery, mood } = ratingColumns(input.ratings);

  await db.run(
    `INSERT INTO recovery_logs
       (id, log_date, energy, soreness, recovery, mood, notes, logged_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(log_date) WHERE deleted_at IS NULL DO UPDATE SET
       energy     = excluded.energy,
       soreness   = excluded.soreness,
       recovery   = excluded.recovery,
       mood       = excluded.mood,
       notes      = excluded.notes,
       logged_at  = excluded.logged_at,
       updated_at = excluded.updated_at;`,
    [
      createId(),
      input.logDate,
      energy,
      soreness,
      recovery,
      mood,
      input.notes,
      input.loggedAt,
      now,
      now,
    ],
  );

  announce();
  const saved = await getRecoveryLog(input.logDate);
  if (!saved) throw new Error(`Recovery log for ${input.logDate} vanished after upsert`);
  return saved;
}

export async function getRecoveryLog(logDate: DateKey): Promise<RecoveryLog | null> {
  const db = await driver();
  const row = await db.first<RecoveryRow>(
    'SELECT * FROM recovery_logs WHERE log_date = ? AND deleted_at IS NULL;',
    [logDate],
  );
  return row ? toRecovery(row) : null;
}

/** Ratings for an inclusive date range, newest first. */
export async function listRecoveryLogs(from: DateKey, to: DateKey): Promise<RecoveryLog[]> {
  const db = await driver();
  const rows = await db.all<RecoveryRow>(
    `SELECT * FROM recovery_logs
      WHERE log_date >= ? AND log_date <= ? AND deleted_at IS NULL
      ORDER BY log_date DESC;`,
    [from, to],
  );
  return rows.map(toRecovery);
}

export async function softDeleteRecoveryLog(id: string): Promise<void> {
  const db = await driver();
  await db.run('UPDATE recovery_logs SET deleted_at = ? WHERE id = ?;', [Date.now(), id]);
  announce();
}

/**
 * Distinct local days in the range that carry at least one rating.
 *
 * Used by analytics to say "you rated on 9 of 14 days", which is a fact about coverage
 * rather than about how the user felt.
 */
export async function ratedDayCount(from: DateKey, to: DateKey): Promise<number> {
  const db = await driver();
  const row = await db.first<{ days: number | null }>(
    `SELECT COUNT(*) AS days FROM recovery_logs
      WHERE log_date >= ? AND log_date <= ? AND deleted_at IS NULL
        AND (energy IS NOT NULL OR soreness IS NOT NULL
             OR recovery IS NOT NULL OR mood IS NOT NULL);`,
    [from, to],
  );
  return row?.days ?? 0;
}

/** Convenience for callers that want a single rating as a plain number. */
export function readRating(log: RecoveryLog | null, rating: RecoveryRating): number | null {
  if (!log) return null;
  return log[rating] ?? null;
}

/* ------------------------------------------------------- mobility sessions */

interface MobilityRow {
  id: string;
  log_date: DateKey;
  kind: MobilityKind;
  title: string | null;
  duration_min: number;
  intensity: number | null;
  notes: string | null;
  performed_at: number;
  created_at: number;
  updated_at: number;
}

function toMobility(row: MobilityRow): MobilitySession {
  return {
    id: row.id,
    logDate: row.log_date,
    kind: row.kind,
    title: row.title,
    durationMin: row.duration_min,
    intensity: row.intensity,
    notes: row.notes,
    performedAt: row.performed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertMobilitySession(input: {
  logDate: DateKey;
  kind: MobilityKind;
  title: string | null;
  durationMin: number;
  intensity: number | null;
  notes: string | null;
  performedAt: number;
}): Promise<MobilitySession> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO mobility_sessions
       (id, log_date, kind, title, duration_min, intensity, notes, performed_at,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.logDate,
      input.kind,
      input.title,
      input.durationMin,
      input.intensity,
      input.notes,
      input.performedAt,
      now,
      now,
    ],
  );

  announce();
  const created = await db.first<MobilityRow>(
    'SELECT * FROM mobility_sessions WHERE id = ?;',
    [id],
  );
  if (!created) throw new Error(`Mobility session ${id} vanished immediately after insert`);
  return toMobility(created);
}

export async function listMobilitySessions(
  from: DateKey,
  to: DateKey,
): Promise<MobilitySession[]> {
  const db = await driver();
  const rows = await db.all<MobilityRow>(
    `SELECT * FROM mobility_sessions
      WHERE log_date >= ? AND log_date <= ? AND deleted_at IS NULL
      ORDER BY performed_at DESC;`,
    [from, to],
  );
  return rows.map(toMobility);
}

export async function softDeleteMobilitySession(id: string): Promise<void> {
  const db = await driver();
  await db.run('UPDATE mobility_sessions SET deleted_at = ? WHERE id = ?;', [Date.now(), id]);
  announce();
}

/** Total mobility minutes in an inclusive range. */
export async function mobilityMinutes(from: DateKey, to: DateKey): Promise<number> {
  const db = await driver();
  const row = await db.first<{ total: number | null }>(
    `SELECT SUM(duration_min) AS total FROM mobility_sessions
      WHERE log_date >= ? AND log_date <= ? AND deleted_at IS NULL;`,
    [from, to],
  );
  // SUM over no rows is NULL, which means zero minutes, not a missing total.
  return row?.total ?? 0;
}
