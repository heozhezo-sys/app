/**
 * Fitness domain types.
 *
 * One activity architecture serves gym, home workouts, mobility and stretching:
 * a `Workout` is a session header and `WorkoutSet` rows are the history every
 * statistic derives from. Timed sports use `SportSession` instead. There is no
 * separate system per sport.
 */

import type { Equipment, MuscleGroup } from '@/data/exerciseCatalog';
import type { SportCategory, SportMetric } from '@/data/sportsCatalog';

export type { Equipment, MuscleGroup, SportCategory, SportMetric };

export type WorkoutActivityType = 'gym' | 'home' | 'mobility' | 'stretching' | 'cross_training';

export type WorkoutStatus = 'in_progress' | 'completed' | 'abandoned';

export type SetType = 'warmup' | 'working' | 'drop';

export interface Exercise {
  id: string;
  name: string;
  muscleGroup: MuscleGroup | null;
  equipment: Equipment | null;
  /** True for entries the user created rather than catalogue ones. */
  isCustom: boolean;
  isArchived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Workout {
  id: string;
  title: string;
  activityType: WorkoutActivityType;
  templateId: string | null;
  status: WorkoutStatus;
  startedAt: number;
  endedAt: number | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface WorkoutSet {
  id: string;
  workoutId: string;
  exerciseId: string;
  setNumber: number;
  setType: SetType;
  reps: number | null;
  /** INTEGER grams. `0` is a real bodyweight set; `null` means not applicable. */
  weightGrams: number | null;
  durationSec: number | null;
  /** RPE scaled by 10, so 7.5 is stored as 75. */
  rpeScaled: number | null;
  isCompleted: boolean;
  createdAt: number;
  updatedAt: number;
}

/** A set joined with the exercise it belongs to, for list rendering. */
export interface WorkoutSetWithExercise extends WorkoutSet {
  exerciseName: string;
  equipment: Equipment | null;
}

export interface BodyMetric {
  id: string;
  measuredAt: number;
  weightGrams: number | null;
  /** Body fat as a percentage scaled by 10, so 18.5% is stored as 185. */
  bodyFatScaled: number | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Sport {
  id: string;
  name: string;
  category: SportCategory;
  metrics: SportMetric[];
  isCustom: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SportSession {
  id: string;
  sportId: string;
  startedAt: number;
  endedAt: number | null;
  durationSec: number | null;
  intensity: 'easy' | 'moderate' | 'hard' | 'max' | null;
  /** Values keyed by the sport's metric keys. See `src/data/sportsCatalog.ts`. */
  metrics: Record<string, number>;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SportSessionWithSport extends SportSession {
  sportName: string;
  metricSchema: SportMetric[];
}

export interface PersonalRecord {
  scope: 'exercise' | 'sport';
  subjectId: string;
  metric: string;
  value: number;
  unit: string;
  achievedAt: number;
  updatedAt: number;
}

/* ---------------------------------------------------------------- inputs */

export interface WorkoutCreateInput {
  title: string;
  activityType: WorkoutActivityType;
  templateId?: string | null;
}

export interface SetInput {
  exerciseId: string;
  reps?: number | null;
  /** Grams. Pass `0` for bodyweight work, `null`/omit when not applicable. */
  weightGrams?: number | null;
  durationSec?: number | null;
  /** 1-10, may be a half point. Converted to the scaled integer on write. */
  rpe?: number | null;
  setType?: SetType;
}

export interface BodyMetricInput {
  measuredAt?: number;
  weightGrams?: number | null;
  bodyFatPercent?: number | null;
  note?: string | null;
}

export interface SportSessionInput {
  sportId: string;
  startedAt?: number;
  endedAt?: number | null;
  intensity?: SportSession['intensity'];
  metrics?: Record<string, number>;
  notes?: string | null;
}

export interface CustomExerciseInput {
  name: string;
  muscleGroup?: MuscleGroup | null;
  equipment?: Equipment | null;
}

export interface CustomSportInput {
  name: string;
  category: SportCategory;
  metrics: SportMetric[];
}
