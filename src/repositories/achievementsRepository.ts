/**
 * Achievements, unlocks and personal records.
 *
 * `achievements` holds the catalogue rows (seeded from `ACHIEVEMENT_CATALOGUE`), and
 * `achievement_unlocks` holds **only** what has already been unlocked — never progress.
 * Progress is derived on read from historical records (ADR: derived over stored counters),
 * so this file stores no counter that could disagree with the history it summarises.
 *
 * The UNIQUE index on `achievement_unlocks (achievement_id)` is what makes unlocking
 * idempotent: a duplicate unlock is impossible even if the evaluator runs twice, which it
 * will, because it runs after writes and again when the screen opens.
 */

import type { SqlDriver } from '@/database/driver';
import { getDatabase, notify, CHANNELS } from '@/database/database';
import { createId } from '@/utils/id';
import type { AchievementCategory, AchievementMetric } from '@/achievements/catalogue';

export interface AchievementRow {
  id: string;
  code: string;
  title: string;
  description: string | null;
  icon: string | null;
  metric: AchievementMetric;
  threshold: number;
  isSecret: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AchievementUnlock {
  id: string;
  achievementId: string;
  unlockedAt: number;
  /** The metric's value at the moment of unlocking, for the "you were at 10" detail. */
  progressAtUnlock: number;
}

export interface PersonalRecord {
  id: string;
  scope: string;
  subjectId: string | null;
  metric: string;
  value: number;
  unit: string;
  achievedAt: number;
  createdAt: number;
  updatedAt: number;
}

async function driver(): Promise<SqlDriver> {
  return (await getDatabase()).driver;
}

function announce(): void {
  notify(CHANNELS.achievements);
}

/* --------------------------------------------------------------- catalogue */

interface AchievementDbRow {
  id: string;
  code: string;
  title: string;
  description: string | null;
  icon: string | null;
  metric: string;
  threshold: number;
  is_secret: number;
  created_at: number;
  updated_at: number;
}

function toAchievement(row: AchievementDbRow): AchievementRow {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description,
    icon: row.icon,
    metric: row.metric as AchievementMetric,
    threshold: row.threshold,
    isSecret: row.is_secret === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Ensures every catalogue entry exists, without overwriting anything.
 *
 * `ON CONFLICT (code) DO NOTHING` means a catalogue change to `title` or `description`
 * will *not* rewrite the user's existing row. That is intentional: the unlock history and
 * the unlock date already reference these rows, and silently rewriting what an unlocked
 * badge says afterwards would be worse than keeping the shipped wording. Shipping a
 * correction requires a new code.
 */
export async function syncAchievementCatalogue(
  db: SqlDriver,
  entries: readonly {
    code: string;
    title: string;
    description: string;
    metric: AchievementMetric;
    threshold: number;
    isSecret?: boolean;
  }[],
): Promise<number> {
  const now = Date.now();
  let inserted = 0;

  for (const entry of entries) {
    const result = await db.run(
      `INSERT INTO achievements
         (id, code, title, description, icon, metric, threshold, is_secret, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO NOTHING;`,
      [
        createId(),
        entry.code,
        entry.title,
        entry.description,
        entry.metric,
        entry.threshold,
        entry.isSecret ? 1 : 0,
        now,
        now,
      ],
    );
    inserted += result.changes;
  }

  if (inserted > 0) announce();
  return inserted;
}

export async function listAchievements(): Promise<AchievementRow[]> {
  const db = await driver();
  const rows = await db.all<AchievementDbRow>(
    'SELECT * FROM achievements ORDER BY threshold ASC, code ASC;',
  );
  return rows.map(toAchievement);
}

export async function findAchievementByCode(code: string): Promise<AchievementRow | null> {
  const db = await driver();
  const row = await db.first<AchievementDbRow>('SELECT * FROM achievements WHERE code = ?;', [
    code,
  ]);
  return row ? toAchievement(row) : null;
}

/* ---------------------------------------------------------------- unlocks */

interface UnlockDbRow {
  id: string;
  achievement_id: string;
  unlocked_at: number;
  progress_at_unlock: number;
}

/**
 * Records an unlock, or does nothing if it is already unlocked.
 *
 * Returns `true` when a new row was written. The service uses that to decide whether to
 * announce the unlock, so a user who backgrounds and re-enters the app does not get the
 * same celebration every time.
 */
export async function insertUnlock(input: {
  achievementId: string;
  unlockedAt: number;
  progressAtUnlock: number;
}): Promise<boolean> {
  const db = await driver();
  const result = await db.run(
    `INSERT INTO achievement_unlocks (id, achievement_id, unlocked_at, progress_at_unlock)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(achievement_id) DO NOTHING;`,
    [createId(), input.achievementId, input.unlockedAt, input.progressAtUnlock],
  );

  if (result.changes === 0) return false;
  announce();
  return true;
}

export async function listUnlocks(): Promise<AchievementUnlock[]> {
  const db = await driver();
  const rows = await db.all<UnlockDbRow>(
    'SELECT * FROM achievement_unlocks ORDER BY unlocked_at DESC;',
  );
  return rows.map((row) => ({
    id: row.id,
    achievementId: row.achievement_id,
    unlockedAt: row.unlocked_at,
    progressAtUnlock: row.progress_at_unlock,
  }));
}

export async function isUnlockedByCode(code: string): Promise<boolean> {
  const db = await driver();
  const row = await db.first<{ n: number | null }>(
    `SELECT COUNT(*) AS n FROM achievement_unlocks u
       JOIN achievements a ON a.id = u.achievement_id
      WHERE a.code = ?;`,
    [code],
  );
  return (row?.n ?? 0) > 0;
}

/* --------------------------------------------------------- personal records */

interface RecordDbRow {
  id: string;
  scope: string;
  subject_id: string | null;
  metric: string;
  value: number;
  unit: string;
  achieved_at: number;
  created_at: number;
  updated_at: number;
}

function toRecord(row: RecordDbRow): PersonalRecord {
  return {
    id: row.id,
    scope: row.scope,
    subjectId: row.subject_id,
    metric: row.metric,
    value: row.value,
    unit: row.unit,
    achievedAt: row.achieved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Records a personal best, keeping the highest value ever seen.
 *
 * The `WHERE value < excluded.value` guard means calling this with a worse figure is a
 * no-op rather than an error, so the evaluator can be called unconditionally after every
 * write without first checking whether it improved anything.
 */
export async function recordBest(input: {
  scope: string;
  subjectId: string | null;
  metric: string;
  value: number;
  unit: string;
  achievedAt: number;
}): Promise<boolean> {
  const db = await driver();
  const now = Date.now();

  const result = await db.run(
    `INSERT INTO personal_records
       (id, scope, subject_id, metric, value, unit, achieved_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope, subject_id, metric) DO UPDATE SET
       value       = excluded.value,
       unit        = excluded.unit,
       achieved_at = excluded.achieved_at,
       updated_at  = excluded.updated_at
     WHERE excluded.value > personal_records.value;`,
    [
      createId(),
      input.scope,
      input.subjectId,
      input.metric,
      input.value,
      input.unit,
      input.achievedAt,
      now,
      now,
    ],
  );

  if (result.changes === 0) return false;
  announce();
  return true;
}

export async function listPersonalRecords(): Promise<PersonalRecord[]> {
  const db = await driver();
  const rows = await db.all<RecordDbRow>(
    'SELECT * FROM personal_records ORDER BY achieved_at DESC;',
  );
  return rows.map(toRecord);
}

/** Categories present in the catalogue, for grouping. Re-exported for the service layer. */
export type { AchievementCategory };
