/**
 * Focus sessions and reviews persistence.
 *
 * `focus_sessions` stores wall-clock deadlines, never a remaining-tick count, so a
 * session survives the process being killed (ADR-0005). No derived value is cached:
 * everything the UI shows is recomputed from the stored deadlines.
 */

import type { SqlDriver } from '@/database/driver';
import { getDatabase, notify, CHANNELS } from '@/database/database';
import { createId } from '@/utils/id';
import type { FocusKind } from '@/focus/presets';

export type FocusStatus = 'active' | 'completed' | 'abandoned';
export type ReviewPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface FocusSession {
  id: string;
  kind: FocusKind;
  label: string | null;
  intent: string | null;
  status: FocusStatus;
  plannedMin: number;
  breakMin: number;
  cycleIndex: number;
  startedAt: number;
  endsAt: number;
  completedAt: number | null;
  actualSec: number | null;
  taskId: string | null;
  goalId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Review {
  id: string;
  periodType: ReviewPeriod;
  periodKey: string;
  body: string;
  wins: string | null;
  challenges: string | null;
  nextActions: string | null;
  moodScore: number | null;
  createdAt: number;
  updatedAt: number;
}

interface SessionRow {
  id: string;
  kind: FocusKind;
  label: string | null;
  intent: string | null;
  status: FocusStatus;
  planned_min: number;
  break_min: number;
  cycle_index: number;
  started_at: number;
  ends_at: number;
  completed_at: number | null;
  actual_sec: number | null;
  task_id: string | null;
  goal_id: string | null;
  created_at: number;
  updated_at: number;
}

function toSession(row: SessionRow): FocusSession {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    intent: row.intent,
    status: row.status,
    plannedMin: row.planned_min,
    breakMin: row.break_min,
    cycleIndex: row.cycle_index,
    startedAt: row.started_at,
    endsAt: row.ends_at,
    completedAt: row.completed_at,
    actualSec: row.actual_sec,
    taskId: row.task_id,
    goalId: row.goal_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function driver(): Promise<SqlDriver> {
  return (await getDatabase()).driver;
}

function announce(): void {
  notify(CHANNELS.focus);
  notify(CHANNELS.today);
}

/* ------------------------------------------------------------ focus sessions */

export async function insertSession(input: {
  kind: FocusKind;
  label: string | null;
  intent: string | null;
  plannedMin: number;
  breakMin: number;
  cycleIndex: number;
  startedAt: number;
  endsAt: number;
  taskId: string | null;
  goalId: string | null;
}): Promise<FocusSession> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO focus_sessions
       (id, kind, label, intent, status, planned_min, break_min, cycle_index,
        started_at, ends_at, task_id, goal_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.kind,
      input.label,
      input.intent,
      input.plannedMin,
      input.breakMin,
      input.cycleIndex,
      input.startedAt,
      input.endsAt,
      input.taskId,
      input.goalId,
      now,
      now,
    ],
  );

  announce();
  const created = await getSession(id);
  if (!created) throw new Error(`Focus session ${id} vanished immediately after insert`);
  return created;
}

/**
 * The one active session, if any.
 *
 * A partial UNIQUE index means there can only ever be one; this returns it so the app
 * can resume or recover on launch.
 */
export async function getActiveSession(): Promise<FocusSession | null> {
  const db = await driver();
  const row = await db.first<SessionRow>(
    "SELECT * FROM focus_sessions WHERE status = 'active' AND deleted_at IS NULL LIMIT 1;",
  );
  return row ? toSession(row) : null;
}

export async function getSession(id: string): Promise<FocusSession | null> {
  const db = await driver();
  const row = await db.first<SessionRow>(
    'SELECT * FROM focus_sessions WHERE id = ? AND deleted_at IS NULL;',
    [id],
  );
  return row ? toSession(row) : null;
}

export async function listSessions(
  options: { limit?: number; since?: number } = {},
): Promise<FocusSession[]> {
  const db = await driver();
  const limit = Math.min(Math.max(1, options.limit ?? 50), 500);
  const since = options.since;

  const rows = since
    ? await db.all<SessionRow>(
        `SELECT * FROM focus_sessions
          WHERE deleted_at IS NULL AND started_at >= ?
          ORDER BY started_at DESC LIMIT ?;`,
        [since, limit],
      )
    : await db.all<SessionRow>(
        `SELECT * FROM focus_sessions
          WHERE deleted_at IS NULL
          ORDER BY started_at DESC LIMIT ?;`,
        [limit],
      );

  return rows.map(toSession);
}

/**
 * Resolves a session.
 *
 * `actual_sec` is required by the schema whenever status becomes `completed`, so the two
 * are written together and can never disagree. The `status = 'active'` guard makes a
 * double-completion a no-op rather than an error.
 */
export async function resolveSession(
  id: string,
  status: Exclude<FocusStatus, 'active'>,
  input: { completedAt: number; actualSec: number },
): Promise<FocusSession | null> {
  const db = await driver();
  await db.run(
    `UPDATE focus_sessions
        SET status = ?, completed_at = ?, actual_sec = ?, updated_at = ?
      WHERE id = ? AND status = 'active' AND deleted_at IS NULL;`,
    [status, input.completedAt, input.actualSec, Date.now(), id],
  );
  announce();
  return getSession(id);
}
/** Soft delete, used when a session row is removed from the user's history. */
export async function softDeleteSession(id: string): Promise<void> {
  const db = await driver();
  const now = Date.now();
  await db.run('UPDATE focus_sessions SET deleted_at = ?, updated_at = ? WHERE id = ?;', [
    now,
    now,
    id,
  ]);
  announce();
}

/**
 * Focus totals over a period, derived from stored sessions.
 *
 * Aggregated rather than kept as a running counter, so the numbers cannot drift out of
 * step with the sessions they came from.
 */
export async function focusTotals(since: number): Promise<{
  completed: number;
  abandoned: number;
  focusMinutes: number;
}> {
  const db = await driver();
  const rows = await db.all<{ status: FocusStatus; actual_sec: number | null }>(
    'SELECT status, actual_sec FROM focus_sessions WHERE deleted_at IS NULL AND started_at >= ?;',
    [since],
  );

  return rows.reduce(
    (acc, row) => ({
      completed: acc.completed + (row.status === 'completed' ? 1 : 0),
      abandoned: acc.abandoned + (row.status === 'abandoned' ? 1 : 0),
      focusMinutes: acc.focusMinutes + Math.round((row.actual_sec ?? 0) / 60),
    }),
    { completed: 0, abandoned: 0, focusMinutes: 0 },
  );
}

/* ------------------------------------------------------------------- reviews */

interface ReviewRow {
  id: string;
  period_type: ReviewPeriod;
  period_key: string;
  body: string;
  wins: string | null;
  challenges: string | null;
  next_actions: string | null;
  mood_score: number | null;
  created_at: number;
  updated_at: number;
}

function toReview(row: ReviewRow): Review {
  return {
    id: row.id,
    periodType: row.period_type,
    periodKey: row.period_key,
    body: row.body,
    wins: row.wins,
    challenges: row.challenges,
    nextActions: row.next_actions,
    moodScore: row.mood_score,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Creates or replaces the review for a period.
 *
 * One review per period is the useful shape — a daily review is today's, edited in
 * place — and a partial UNIQUE index enforces it. `upsert` means a second save replaces
 * rather than silently creating a duplicate the user cannot see.
 */
export async function upsertReview(input: {
  periodType: ReviewPeriod;
  periodKey: string;
  body: string;
  wins?: string | null;
  challenges?: string | null;
  nextActions?: string | null;
  moodScore?: number | null;
}): Promise<Review> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO reviews
       (id, period_type, period_key, body, wins, challenges, next_actions, mood_score,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (period_type, period_key) WHERE deleted_at IS NULL
     DO UPDATE SET body = excluded.body, wins = excluded.wins,
                   challenges = excluded.challenges, next_actions = excluded.next_actions,
                   mood_score = excluded.mood_score, updated_at = excluded.updated_at;`,
    [
      id,
      input.periodType,
      input.periodKey,
      input.body,
      input.wins ?? null,
      input.challenges ?? null,
      input.nextActions ?? null,
      input.moodScore ?? null,
      now,
      now,
    ],
  );

  announce();
  const saved = await getReview(input.periodType, input.periodKey);
  if (!saved) throw new Error('Review vanished immediately after upsert');
  return saved;
}

export async function getReview(
  periodType: ReviewPeriod,
  periodKey: string,
): Promise<Review | null> {
  const db = await driver();
  const row = await db.first<ReviewRow>(
    `SELECT * FROM reviews
      WHERE period_type = ? AND period_key = ? AND deleted_at IS NULL;`,
    [periodType, periodKey],
  );
  return row ? toReview(row) : null;
}

export async function listReviews(limit = 20): Promise<Review[]> {
  const db = await driver();
  const safeLimit = Math.min(Math.max(1, limit), 200);
  const rows = await db.all<ReviewRow>(
    'SELECT * FROM reviews WHERE deleted_at IS NULL ORDER BY period_key DESC, updated_at DESC LIMIT ?;',
    [safeLimit],
  );
  return rows.map(toReview);
}

export async function removeReview(id: string): Promise<void> {
  const db = await driver();
  await db.run('UPDATE reviews SET deleted_at = ? WHERE id = ?;', [Date.now(), id]);
  announce();
}

