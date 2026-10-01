/**
 * Fitness use-cases.
 *
 * One activity architecture for gym, home workouts, mobility and stretching, plus a
 * single session model for timed sports. Nothing here is per-sport.
 *
 * The edge cases the specification calls out are handled here rather than left to the
 * UI: bodyweight and zero loads, fractional plate weights, interrupted workouts,
 * incomplete sets, and duplicate taps.
 */

import * as workoutsRepo from '@/repositories/workoutsRepository';
import * as exercisesRepo from '@/repositories/exercisesRepository';
import * as bodyRepo from '@/repositories/bodyMetricsRepository';
import * as sportsRepo from '@/repositories/sportsRepository';
import { ValidationError } from './errors';
import { logger } from '@/utils/logger';
import { validateTitle, sanitiseText } from '@/utils/validation';
import { rpeToScaled } from '@/utils/units';
import type {
  BodyMetric,
  BodyMetricInput,
  CustomExerciseInput,
  CustomSportInput,
  Exercise,
  SetInput,
  Sport,
  SportSession,
  SportSessionInput,
  SportSessionWithSport,
  Workout,
  WorkoutCreateInput,
  WorkoutSet,
  WorkoutSetWithExercise,
  WorkoutStatus,
} from '@/types/fitness';

/** An absurd value almost certainly means a typo rather than a real lift. */
const MAX_PLAUSIBLE_LOAD_GRAMS = 700_000; // 700 kg
const MAX_PLAUSIBLE_REPS = 1000;
const MAX_PLAUSIBLE_DURATION_SEC = 24 * 3600;

/**
 * Optional-integer parsing for set fields.
 *
 * `null`/`undefined` means "not provided" and is stored as SQL NULL — a set may
 * legitimately have reps but no weight. An out-of-range or non-integer value is a
 * *different* thing and must be rejected, so the two are never conflated.
 */
function parseOptionalCount(
  value: number | null | undefined,
  field: string,
  max: number,
): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new ValidationError({ [field]: 'Whole number, 0 or more' });
  }
  return value;
}

/** Zero is valid: it is how bodyweight work is recorded. */
function parseOptionalLoad(value: number | null | undefined): number | null {
  return parseOptionalCount(value, 'weightGrams', MAX_PLAUSIBLE_LOAD_GRAMS);
}

function parseOptionalSeconds(value: number | null | undefined): number | null {
  return parseOptionalCount(value, 'durationSec', MAX_PLAUSIBLE_DURATION_SEC);
}

/* -------------------------------------------------------------- exercises */

export async function listExercises(muscleGroup?: Exercise['muscleGroup']): Promise<Exercise[]> {
  return exercisesRepo.listExercises(muscleGroup ? { muscleGroup } : {});
}

export async function createCustomExercise(input: CustomExerciseInput): Promise<Exercise> {
  const name = sanitiseText(input.name ?? '');
  const error = validateTitle(name);
  if (error) throw new ValidationError({ name: error });

  return exercisesRepo.createCustomExercise({
    name,
    muscleGroup: input.muscleGroup ?? null,
    equipment: input.equipment ?? null,
  });
}

export function isTimedExercise(exerciseId: string): boolean {
  return exercisesRepo.isTimedExercise(exerciseId);
}

/* --------------------------------------------------------------- workouts */

export async function startWorkout(input: WorkoutCreateInput): Promise<Workout> {
  const title = sanitiseText(input.title ?? '') || 'Workout';
  return workoutsRepo.insertWorkout({
    title,
    activityType: input.activityType,
    templateId: input.templateId ?? null,
  });
}

export async function getWorkout(id: string): Promise<Workout | null> {
  return workoutsRepo.getWorkout(id);
}

export async function listWorkouts(
  options: { sinceDays?: number; limit?: number } = {},
): Promise<Workout[]> {
  return workoutsRepo.listWorkouts(options);
}

export async function listSets(workoutId: string): Promise<WorkoutSetWithExercise[]> {
  return workoutsRepo.listSets(workoutId);
}

/**
 * The workout left in progress, if any.
 *
 * This is what makes an interrupted workout recoverable: the row already exists, so
 * the app can offer to resume rather than telling the user their session was lost.
 */
export async function findResumableWorkout(): Promise<Workout | null> {
  return workoutsRepo.findActiveWorkout();
}

/**
 * Finishes a workout. Completion requires `ended_at`; the schema enforces that too,
 * so a half-written "completed" row cannot exist.
 */
export async function completeWorkout(id: string, notes?: string | null): Promise<Workout | null> {
  const workout = await workoutsRepo.getWorkout(id);
  if (!workout) throw new ValidationError({ id: 'That workout no longer exists' });
  if (workout.status === 'completed') return workout;

  return workoutsRepo.updateWorkout(id, {
    status: 'completed',
    endedAt: Math.max(Date.now(), workout.startedAt),
    ...(notes === undefined ? {} : { notes: notes ? sanitiseText(notes) : null }),
  });
}

/** Retires a workout the user chose not to finish, keeping its sets. */
export async function abandonWorkout(id: string): Promise<Workout | null> {
  const workout = await workoutsRepo.getWorkout(id);
  if (!workout) throw new ValidationError({ id: 'That workout no longer exists' });
  return workoutsRepo.updateWorkout(id, {
    status: 'abandoned',
    endedAt: Math.max(Date.now(), workout.startedAt),
  });
}

export async function setWorkoutStatus(id: string, status: WorkoutStatus): Promise<Workout | null> {
  if (status === 'completed') return completeWorkout(id);
  if (status === 'abandoned') return abandonWorkout(id);

  const workout = await workoutsRepo.getWorkout(id);
  if (!workout) throw new ValidationError({ id: 'That workout no longer exists' });
  // Back to in_progress: clear the end time, otherwise the duration is nonsense.
  return workoutsRepo.updateWorkout(id, { status: 'in_progress', endedAt: null });
}
/**
 * Logs a set.
 *
 * Handles the cases the specification names:
 *
 *  - **Bodyweight / zero weight.** `weightGrams: 0` is a legitimate value and is kept
 *    as 0 rather than coerced to null, so "bodyweight" stays distinguishable from
 *    "did not record a weight".
 *  - **Fractional weights.** Grams are integers, so 2.5 lb is exactly 1134 g.
 *  - **Incomplete sets.** The schema requires at least one of weight, reps or
 *    duration; this layer turns that into a readable message instead of a constraint
 *    failure.
 */
export async function logSet(workoutId: string, input: SetInput): Promise<WorkoutSet> {
  const workout = await workoutsRepo.getWorkout(workoutId);
  if (!workout) throw new ValidationError({ workoutId: 'That workout no longer exists' });

  const exercise = await exercisesRepo.getExercise(input.exerciseId);
  if (!exercise) throw new ValidationError({ exerciseId: 'Choose an exercise' });

  const reps = parseOptionalCount(input.reps, 'reps', MAX_PLAUSIBLE_REPS);
  const weightGrams = parseOptionalLoad(input.weightGrams);
  const durationSec = parseOptionalSeconds(input.durationSec);

  // A completely blank set is almost always a mis-tap, and the database would reject
  // it anyway. Saying so plainly beats surfacing a constraint error.
  if (reps === null && weightGrams === null && durationSec === null) {
    throw new ValidationError({ reps: 'Enter reps, weight or time before saving the set' });
  }

  const rpeScaled = input.rpe === null || input.rpe === undefined ? null : rpeToScaled(input.rpe);
  if (input.rpe !== null && input.rpe !== undefined && rpeScaled === null) {
    throw new ValidationError({ rpe: 'Between 1 and 10' });
  }

  return workoutsRepo.insertSet({
    workoutId,
    exerciseId: input.exerciseId,
    reps,
    weightGrams,
    durationSec,
    rpeScaled,
    setType: input.setType ?? 'working',
  });
}

export async function updateSet(
  setId: string,
  patch: Partial<{
    reps: number | null;
    weightGrams: number | null;
    durationSec: number | null;
    rpe: number | null;
    setType: WorkoutSet['setType'];
    isCompleted: boolean;
  }>,
): Promise<WorkoutSet | null> {
  const payload: Parameters<typeof workoutsRepo.updateSet>[1] = {};

  if (patch.reps !== undefined) payload.reps = parseOptionalCount(patch.reps, 'reps', MAX_PLAUSIBLE_REPS);
  if (patch.weightGrams !== undefined) payload.weightGrams = parseOptionalLoad(patch.weightGrams);
  if (patch.durationSec !== undefined) payload.durationSec = parseOptionalSeconds(patch.durationSec);
  if (patch.rpe !== undefined) {
    if (patch.rpe === null) {
      payload.rpeScaled = null;
    } else {
      const scaled = rpeToScaled(patch.rpe);
      if (scaled === null) throw new ValidationError({ rpe: 'Between 1 and 10' });
      payload.rpeScaled = scaled;
    }
  }
  if (patch.setType !== undefined) payload.setType = patch.setType;
  if (patch.isCompleted !== undefined) payload.isCompleted = patch.isCompleted;

  return workoutsRepo.updateSet(setId, payload);
}

export async function deleteSet(setId: string): Promise<void> {
  await workoutsRepo.deleteSet(setId);
}

export async function deleteWorkout(id: string): Promise<void> {
  await workoutsRepo.softDeleteWorkout(id);
}

export interface WorkoutSummary {
  workout: Workout;
  setCount: number;
  exerciseCount: number;
  volumeGrams: number;
  workSeconds: number;
}

/** A workout with the aggregates a list row needs. */
export async function workoutSummary(id: string): Promise<WorkoutSummary | null> {
  const workout = await workoutsRepo.getWorkout(id);
  if (!workout) return null;

  const [volumeGrams, workSeconds] = await Promise.all([
    workoutsRepo.totalVolumeGrams(id),
    workoutsRepo.totalWorkSeconds(id),
  ]);

  const sets = await workoutsRepo.listSets(id);
  return {
    workout,
    setCount: sets.length,
    exerciseCount: new Set(sets.map((s) => s.exerciseId)).size,
    volumeGrams,
    workSeconds,
  };
}

/* ---------------------------------------------------------- body metrics */

export async function listBodyMetrics(limit?: number): Promise<BodyMetric[]> {
  return bodyRepo.listBodyMetrics(limit);
}

export async function latestBodyMetric(): Promise<BodyMetric | null> {
  return bodyRepo.latestBodyMetric();
}

/**
 * Records a bodyweight measurement.
 *
 * Body fat is stored scaled by 10, so 18.5% is 185 and no float reaches the database.
 * Re-measuring at the same instant updates the existing row instead of duplicating it.
 */
export async function recordBodyMetric(input: BodyMetricInput): Promise<BodyMetric> {
  const measuredAt = input.measuredAt ?? Date.now();

  let weightGrams: number | null = null;
  if (input.weightGrams !== undefined && input.weightGrams !== null) {
    weightGrams = parseOptionalLoad(input.weightGrams);
  }

  let bodyFatScaled: number | null = null;
  if (input.bodyFatPercent !== undefined && input.bodyFatPercent !== null) {
    if (
      !Number.isFinite(input.bodyFatPercent) ||
      input.bodyFatPercent < 0 ||
      input.bodyFatPercent > 100
    ) {
      throw new ValidationError({ bodyFatPercent: 'Between 0 and 100' });
    }
    bodyFatScaled = Math.round(input.bodyFatPercent * 10);
  }

  if (weightGrams === null && bodyFatScaled === null && !input.note) {
    throw new ValidationError({ weightGrams: 'Record a weight, body fat or a note' });
  }

  try {
    return await bodyRepo.upsertBodyMetric({
      measuredAt,
      weightGrams,
      bodyFatScaled,
      note: input.note ? sanitiseText(input.note) : null,
    });
  } catch (error) {
    logger.error('Failed to record body metric', error);
    throw error;
  }
}

export async function deleteBodyMetric(id: string): Promise<void> {
  await bodyRepo.deleteBodyMetric(id);
}

/* ----------------------------------------------------------------- sports */

export async function listSports(category?: Sport['category']): Promise<Sport[]> {
  return sportsRepo.listSports(category);
}

export async function createCustomSport(input: CustomSportInput): Promise<Sport> {
  const name = sanitiseText(input.name ?? '');
  const error = validateTitle(name);
  if (error) throw new ValidationError({ name: error });

  // Metric keys are the storage contract, so they must be unique and namespaced.
  const seen = new Set<string>();
  for (const metric of input.metrics) {
    if (!/^[a-z][a-z0-9_]*$/.test(metric.key)) {
      throw new ValidationError({ metrics: `Invalid metric key: ${metric.key}` });
    }
    if (seen.has(metric.key)) {
      throw new ValidationError({ metrics: `Duplicate metric key: ${metric.key}` });
    }
    seen.add(metric.key);
  }

  return sportsRepo.insertCustomSport({ name, category: input.category, metrics: input.metrics });
}

/**
 * Records a sport session.
 *
 * Only metrics the sport declares are accepted, so a session cannot accumulate keys
 * that no report will ever read. This is what keeps "metrics are configurable" from
 * turning into "metrics are arbitrary".
 */
export async function logSportSession(input: SportSessionInput): Promise<SportSession> {
  const sport = await sportsRepo.getSport(input.sportId);
  if (!sport) throw new ValidationError({ sportId: 'Choose a sport' });

  const declared = new Set(sport.metrics.map((m) => m.key));
  const metrics: Record<string, number> = {};
  for (const [key, value] of Object.entries(input.metrics ?? {})) {
    if (declared.size > 0 && !declared.has(key)) continue;
    if (!Number.isFinite(value) || value < 0) {
      throw new ValidationError({ metrics: `${key} must be zero or more` });
    }
    metrics[key] = value;
  }

  const startedAt = input.startedAt ?? Date.now();
  const endedAt = input.endedAt ?? null;
  if (endedAt !== null && endedAt < startedAt) {
    throw new ValidationError({ endedAt: 'Cannot finish before you started' });
  }

  // Duration is derived from the timestamps when both are known, rather than trusted
  // from a field the user typed twice.
  const durationSec =
    endedAt !== null ? Math.round((endedAt - startedAt) / 1000) : (metrics.duration_s ?? null);

  return sportsRepo.insertSportSession({
    sportId: input.sportId,
    startedAt,
    endedAt,
    durationSec,
    intensity: input.intensity ?? null,
    metrics,
    notes: input.notes ? sanitiseText(input.notes) : null,
  });
}

export async function listSportSessions(options: {
  sportId?: string;
  sinceDays?: number;
  limit?: number;
} = {}): Promise<SportSessionWithSport[]> {
  return sportsRepo.listSportSessions(options);
}

export async function deleteSportSession(id: string): Promise<void> {
  await sportsRepo.softDeleteSportSession(id);
}

/* ------------------------------------------------------- personal records */

export interface PersonalRecordSummary {
  exerciseId: string;
  exerciseName: string;
  heaviestWeightGrams: number | null;
  heaviestReps: number | null;
  maxReps: number | null;
}

/**
 * Personal records for an exercise, derived from history.
 *
 * Derived rather than stored: `personal_records` is a convenience cache and this is
 * the rule that would repopulate it. Recomputing means a corrected set immediately
 * corrects the record instead of leaving a stale best.
 */
export async function personalRecordsForExercise(
  exerciseId: string,
): Promise<PersonalRecordSummary | null> {
  const exercise = await exercisesRepo.getExercise(exerciseId);
  if (!exercise) return null;

  const [heaviest, maxReps] = await Promise.all([
    workoutsRepo.heaviestSetForExercise(exerciseId),
    workoutsRepo.maxRepsForExercise(exerciseId),
  ]);

  return {
    exerciseId,
    exerciseName: exercise.name,
    heaviestWeightGrams: heaviest?.weightGrams ?? null,
    heaviestReps: heaviest?.reps ?? null,
    maxReps: maxReps?.reps ?? null,
  };
}

/** Total distance for one sport, in metres. */
export async function sportDistanceMetres(sportId: string): Promise<number> {
  return sportsRepo.totalDistanceMetres(sportId);
}

