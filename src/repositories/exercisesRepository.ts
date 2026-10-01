/**
 * Exercise catalogue and custom exercise persistence.
 */

import type { SqlDriver } from '@/database/driver';
import { getDatabase, notify, CHANNELS } from '@/database/database';
import { createId } from '@/utils/id';
import type { Equipment, MuscleGroup } from '@/data/exerciseCatalog';
import { TIMED_EXERCISES } from '@/data/exerciseCatalog';
import type { Exercise } from '@/types/fitness';

interface ExerciseRow {
  id: string;
  name: string;
  muscle_group: MuscleGroup | null;
  equipment: Equipment | null;
  is_custom: number;
  is_archived: number;
  created_at: number;
  updated_at: number;
}

function toExercise(row: ExerciseRow): Exercise {
  return {
    id: row.id,
    name: row.name,
    muscleGroup: row.muscle_group,
    equipment: row.equipment,
    isCustom: row.is_custom === 1,
    isArchived: row.is_archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function driver(): Promise<SqlDriver> {
  return (await getDatabase()).driver;
}

/**
 * Exercises, archived ones excluded.
 *
 * Ordered by name so the picker is predictable; muscle group is available as a filter
 * rather than as the primary sort.
 */
export async function listExercises(options: { muscleGroup?: MuscleGroup } = {}): Promise<Exercise[]> {
  const db = await driver();
  const rows = await db.all<ExerciseRow>(
    `SELECT * FROM exercises
      WHERE deleted_at IS NULL AND is_archived = 0
        AND (? IS NULL OR muscle_group = ?)
      ORDER BY name ASC;`,
    [options.muscleGroup ?? null, options.muscleGroup ?? null],
  );
  return rows.map(toExercise);
}

export async function getExercise(id: string): Promise<Exercise | null> {
  const db = await driver();
  const row = await db.first<ExerciseRow>(
    'SELECT * FROM exercises WHERE id = ? AND deleted_at IS NULL;',
    [id],
  );
  return row ? toExercise(row) : null;
}

export async function createCustomExercise(input: {
  name: string;
  muscleGroup: MuscleGroup | null;
  equipment: Equipment | null;
}): Promise<Exercise> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO exercises (id, name, muscle_group, equipment, is_custom, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?);`,
    [id, input.name, input.muscleGroup, input.equipment, now, now],
  );

  notify(CHANNELS.workouts);
  const created = await getExercise(id);
  if (!created) throw new Error(`Exercise ${id} vanished immediately after insert`);
  return created;
}

export async function setExerciseArchived(id: string, archived: boolean): Promise<void> {
  const db = await driver();
  await db.run(
    'UPDATE exercises SET is_archived = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL;',
    [archived ? 1 : 0, Date.now(), id],
  );
  notify(CHANNELS.workouts);
}

/**
 * Whether an exercise is normally logged as held time rather than reps and weight.
 *
 * Timed movements (plank, dead hang, stretches) would otherwise force a user to invent
 * a rep count. This is a hint for the UI, not a constraint on storage: a timed
 * exercise can still have reps, and a lifting exercise can still have a duration.
 */
export function isTimedExercise(exerciseId: string): boolean {
  return TIMED_EXERCISES.has(exerciseId);
}

/** Distinct muscle groups that actually appear in the catalogue. */
export async function listMuscleGroups(): Promise<MuscleGroup[]> {
  const db = await driver();
  const rows = await db.all<{ muscle_group: MuscleGroup }>(
    `SELECT DISTINCT muscle_group FROM exercises
      WHERE deleted_at IS NULL AND is_archived = 0 AND muscle_group IS NOT NULL
      ORDER BY muscle_group ASC;`,
  );
  return rows.map((r) => r.muscle_group);
}
