/**
 * Workout and set persistence.
 *
 * Two behaviours exist specifically to survive real-world use:
 *
 * 1. **Interrupted workouts are recoverable.** A workout left `in_progress` is a real
 *    row, so a session killed mid-set is not lost; it reopens on next launch. The
 *    `abandoned` status exists so a workout can be retired deliberately without
 *    deleting its history.
 *
 * 2. **Set numbers are assigned atomically.** The next number is computed inside the
 *    INSERT, so two rapid taps cannot both claim set number 3.
 */

import type { SqlDriver, SqlValue } from '@/database/driver';
import { getDatabase, notify, CHANNELS } from '@/database/database';
import { createId } from '@/utils/id';
import type {
  Equipment,
  SetType,
  Workout,
  WorkoutActivityType,
  WorkoutSet,
  WorkoutSetWithExercise,
  WorkoutStatus,
} from '@/types/fitness';

interface WorkoutRow {
  id: string;
  title: string;
  activity_type: WorkoutActivityType;
  template_id: string | null;
  status: WorkoutStatus;
  started_at: number;
  ended_at: number | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

interface SetRow {
  id: string;
  workout_id: string;
  exercise_id: string;
  set_number: number;
  set_type: SetType;
  reps: number | null;
  weight_grams: number | null;
  duration_sec: number | null;
  rpe_x10: number | null;
  is_completed: number;
  created_at: number;
  updated_at: number;
}

function toWorkout(row: WorkoutRow): Workout {
  return {
    id: row.id,
    title: row.title,
    activityType: row.activity_type,
    templateId: row.template_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSet(row: SetRow): WorkoutSet {
  return {
    id: row.id,
    workoutId: row.workout_id,
    exerciseId: row.exercise_id,
    setNumber: row.set_number,
    setType: row.set_type,
    reps: row.reps,
    weightGrams: row.weight_grams,
    durationSec: row.duration_sec,
    rpeScaled: row.rpe_x10,
    isCompleted: row.is_completed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function driver(): Promise<SqlDriver> {
  return (await getDatabase()).driver;
}

function announce(): void {
  notify(CHANNELS.workouts);
  notify(CHANNELS.bodyMetrics);
  notify(CHANNELS.today);
}

/* ------------------------------------------------------------------ reads */

export async function getWorkout(id: string): Promise<Workout | null> {
  const db = await driver();
  const row = await db.first<WorkoutRow>(
    'SELECT * FROM workouts WHERE id = ? AND deleted_at IS NULL;',
    [id],
  );
  return row ? toWorkout(row) : null;
}

export interface WorkoutListFilter {
  status?: readonly WorkoutStatus[];
  sinceDays?: number;
  limit?: number;
}

export async function listWorkouts(filter: WorkoutListFilter = {}): Promise<Workout[]> {
  const db = await driver();
  const statuses = filter.status ?? null;
  const since = filter.sinceDays === undefined ? null : Date.now() - filter.sinceDays * 86_400_000;

  const rows = await db.all<WorkoutRow>(
    `SELECT * FROM workouts
      WHERE deleted_at IS NULL
        AND (? IS NULL OR status IN (SELECT value FROM json_each(?)))
        AND (? IS NULL OR started_at >= ?)
      ORDER BY started_at DESC
      LIMIT ?;`,
    [
      statuses ? statuses.length : null,
      statuses ? JSON.stringify(statuses) : null,
      since,
      since,
      filter.limit ?? 100,
    ],
  );
  return rows.map(toWorkout);
}

/** The workout a user was in the middle of, if any. Used to offer "resume". */
export async function findActiveWorkout(): Promise<Workout | null> {
  const db = await driver();
  const row = await db.first<WorkoutRow>(
    `SELECT * FROM workouts
      WHERE deleted_at IS NULL AND status = 'in_progress'
      ORDER BY started_at DESC LIMIT 1;`,
  );
  return row ? toWorkout(row) : null;
}

export async function listSets(workoutId: string): Promise<WorkoutSetWithExercise[]> {
  const db = await driver();
  const rows = await db.all<SetRow & { exercise_name: string; equipment: Equipment | null }>(
    `SELECT s.*, e.name AS exercise_name, e.equipment
       FROM workout_sets s
       JOIN exercises e ON e.id = s.exercise_id
      WHERE s.workout_id = ?
      ORDER BY e.name ASC, s.set_number ASC;`,
    [workoutId],
  );
  return rows.map((row) => ({ ...toSet(row), exerciseName: row.exercise_name, equipment: row.equipment }));
}

export async function listSetsForExercise(exerciseId: string): Promise<WorkoutSet[]> {
  const db = await driver();
  const rows = await db.all<SetRow>(
    `SELECT s.* FROM workout_sets s
       JOIN workouts w ON w.id = s.workout_id
      WHERE s.exercise_id = ? AND w.deleted_at IS NULL AND w.status = 'completed'
      ORDER BY s.created_at DESC;`,
    [exerciseId],
  );
  return rows.map(toSet);
}
/* ----------------------------------------------------------------- writes */

export async function insertWorkout(input: {
  title: string;
  activityType: WorkoutActivityType;
  templateId: string | null;
  startedAt?: number;
}): Promise<Workout> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO workouts (id, title, activity_type, template_id, status, started_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'in_progress', ?, ?, ?);`,
    [id, input.title, input.activityType, input.templateId, input.startedAt ?? now, now, now],
  );

  announce();
  const created = await getWorkout(id);
  if (!created) throw new Error(`Workout ${id} vanished immediately after insert`);
  return created;
}

export async function updateWorkout(
  id: string,
  patch: Partial<{
    title: string;
    notes: string | null;
    status: WorkoutStatus;
    endedAt: number | null;
    activityType: WorkoutActivityType;
  }>,
): Promise<Workout | null> {
  const db = await driver();
  const columns: string[] = [];
  const params: SqlValue[] = [];
  const set = (column: string, value: SqlValue): void => {
    columns.push(`${column} = ?`);
    params.push(value);
  };

  if (patch.title !== undefined) set('title', patch.title);
  if (patch.notes !== undefined) set('notes', patch.notes);
  if (patch.status !== undefined) set('status', patch.status);
  if (patch.endedAt !== undefined) set('ended_at', patch.endedAt);
  if (patch.activityType !== undefined) set('activity_type', patch.activityType);

  if (columns.length === 0) return getWorkout(id);

  set('updated_at', Date.now());
  params.push(id);

  await db.run(`UPDATE workouts SET ${columns.join(', ')} WHERE id = ? AND deleted_at IS NULL;`, params);
  announce();
  return getWorkout(id);
}

/**
 * Appends a set.
 *
 * The next set number is computed inside the INSERT so two concurrent inserts cannot
 * claim the same number. Numbering is per exercise within a workout, matching how a
 * lifter thinks about "set 3 of squats".
 */
export async function insertSet(input: {
  workoutId: string;
  exerciseId: string;
  reps: number | null;
  weightGrams: number | null;
  durationSec: number | null;
  rpeScaled: number | null;
  setType: SetType;
}): Promise<WorkoutSet> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO workout_sets
       (id, workout_id, exercise_id, set_number, set_type, reps, weight_grams,
        duration_sec, rpe_x10, is_completed, created_at, updated_at)
     VALUES (
       ?,
       ?,
       ?,
       (SELECT COALESCE(MAX(set_number), 0) + 1 FROM workout_sets
         WHERE workout_id = ? AND exercise_id = ?),
       ?, ?, ?, ?, ?, 1, ?, ?);`,
    [
      id,
      input.workoutId,
      input.exerciseId,
      input.workoutId,
      input.exerciseId,
      input.setType,
      input.reps,
      input.weightGrams,
      input.durationSec,
      input.rpeScaled,
      now,
      now,
    ],
  );

  announce();
  const created = await db.first<SetRow>('SELECT * FROM workout_sets WHERE id = ?;', [id]);
  if (!created) throw new Error(`Set ${id} vanished immediately after insert`);
  return toSet(created);
}

export async function updateSet(
  id: string,
  patch: Partial<{
    reps: number | null;
    weightGrams: number | null;
    durationSec: number | null;
    rpeScaled: number | null;
    setType: SetType;
    isCompleted: boolean;
  }>,
): Promise<WorkoutSet | null> {
  const db = await driver();
  const columns: string[] = [];
  const params: SqlValue[] = [];
  const set = (column: string, value: SqlValue): void => {
    columns.push(`${column} = ?`);
    params.push(value);
  };

  if (patch.reps !== undefined) set('reps', patch.reps);
  if (patch.weightGrams !== undefined) set('weight_grams', patch.weightGrams);
  if (patch.durationSec !== undefined) set('duration_sec', patch.durationSec);
  if (patch.rpeScaled !== undefined) set('rpe_x10', patch.rpeScaled);
  if (patch.setType !== undefined) set('set_type', patch.setType);
  if (patch.isCompleted !== undefined) set('is_completed', patch.isCompleted ? 1 : 0);

  if (columns.length === 0) return null;

  set('updated_at', Date.now());
  params.push(id);

  await db.run(`UPDATE workout_sets SET ${columns.join(', ')} WHERE id = ?;`, params);
  announce();

  const row = await db.first<SetRow>('SELECT * FROM workout_sets WHERE id = ?;', [id]);
  return row ? toSet(row) : null;
}

export async function deleteSet(id: string): Promise<void> {
  const db = await driver();
  await db.run('DELETE FROM workout_sets WHERE id = ?;', [id]);
  announce();
}

export async function softDeleteWorkout(id: string): Promise<void> {
  const db = await driver();
  const now = Date.now();
  await db.run(
    'UPDATE workouts SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL;',
    [now, now, id],
  );
  announce();
}

/* ------------------------------------------------------------- analytics */

/** Total volume in grams (weight x reps). Integer arithmetic only. */
export async function totalVolumeGrams(workoutId: string): Promise<number> {
  const db = await driver();
  const row = await db.first<{ total: number | null }>(
    'SELECT SUM(COALESCE(weight_grams, 0) * COALESCE(reps, 0)) AS total FROM workout_sets WHERE workout_id = ?;',
    [workoutId],
  );
  return row?.total ?? 0;
}

/** Seconds spent working, used for timed exercises. */
export async function totalWorkSeconds(workoutId: string): Promise<number> {
  const db = await driver();
  const row = await db.first<{ total: number | null }>(
    'SELECT SUM(COALESCE(duration_sec, 0)) AS total FROM workout_sets WHERE workout_id = ?;',
    [workoutId],
  );
  return row?.total ?? 0;
}

/**
 * Best working set ever recorded for an exercise.
 *
 * "Best" is the heaviest load, and among equal loads the highest rep count — which is
 * how a lifter would judge it. Bodyweight sets (`weight_grams = 0`) are skipped, since
 * a zero-load record is not meaningful.
 */
export async function heaviestSetForExercise(exerciseId: string): Promise<WorkoutSet | null> {
  const db = await driver();
  const row = await db.first<SetRow>(
    `SELECT s.* FROM workout_sets s
       JOIN workouts w ON w.id = s.workout_id
      WHERE s.exercise_id = ? AND w.status = 'completed' AND w.deleted_at IS NULL
        AND s.weight_grams IS NOT NULL AND s.weight_grams > 0
        AND s.set_type = 'working'
      ORDER BY s.weight_grams DESC, COALESCE(s.reps, 0) DESC
      LIMIT 1;`,
    [exerciseId],
  );
  return row ? toSet(row) : null;
}

/** Most reps ever recorded for an exercise at any load. */
export async function maxRepsForExercise(exerciseId: string): Promise<WorkoutSet | null> {
  const db = await driver();
  const row = await db.first<SetRow>(
    `SELECT s.* FROM workout_sets s
       JOIN workouts w ON w.id = s.workout_id
      WHERE s.exercise_id = ? AND w.status = 'completed' AND w.deleted_at IS NULL
        AND s.reps IS NOT NULL
      ORDER BY s.reps DESC
      LIMIT 1;`,
    [exerciseId],
  );
  return row ? toSet(row) : null;
}

/** Total sessions per activity type, for the fitness overview. */
export async function countWorkoutsByType(): Promise<Record<string, number>> {
  const db = await driver();
  const rows = await db.all<{ activity_type: string; count: number }>(
    `SELECT activity_type, COUNT(*) AS count
       FROM workouts
      WHERE deleted_at IS NULL AND status = 'completed'
      GROUP BY activity_type;`,
  );
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.activity_type] = row.count;
    return acc;
  }, {});
}

