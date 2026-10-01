/**
 * Seeded exercise catalogue.
 *
 * This is data, not schema, so it is a typed TypeScript module rather than a
 * migration. It is inserted idempotently on first database open by
 * `src/database/seed.ts`. Keeping it here means every entry is type-checked and the
 * catalogue is reviewable in isolation.
 *
 * IDs are stable and human-readable (`ex-squat`) so that fixtures, tests and any
 * future built-in workout templates can refer to an exercise without depending on a
 * generated UUID.
 */

export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'arms'
  | 'legs'
  | 'glutes'
  | 'core'
  | 'full_body'
  | 'cardio'
  | 'mobility';

export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'cable'
  | 'bodyweight'
  | 'kettlebell'
  | 'band'
  | 'cardio_machine'
  | 'none';

export interface CatalogExercise {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  equipment: Equipment;
}

/**
 * The default catalogue. `is_custom` is deliberately absent: every entry here is a
 * built-in, and `src/database/seed.ts` writes `is_custom = 0`. User exercises are a
 * separate concept and are never inserted into this list.
 */
export const EXERCISE_CATALOG: readonly CatalogExercise[] = [
  // Chest
  { id: 'ex-bench-press', name: 'Bench Press', muscleGroup: 'chest', equipment: 'barbell' },
  { id: 'ex-incline-bench', name: 'Incline Bench Press', muscleGroup: 'chest', equipment: 'barbell' },
  { id: 'ex-db-bench', name: 'Dumbbell Bench Press', muscleGroup: 'chest', equipment: 'dumbbell' },
  { id: 'ex-chest-fly', name: 'Chest Fly', muscleGroup: 'chest', equipment: 'cable' },
  { id: 'ex-push-up', name: 'Push Up', muscleGroup: 'chest', equipment: 'bodyweight' },
  { id: 'ex-dip', name: 'Dip', muscleGroup: 'chest', equipment: 'bodyweight' },

  // Back
  { id: 'ex-pull-up', name: 'Pull Up', muscleGroup: 'back', equipment: 'bodyweight' },
  { id: 'ex-lat-pulldown', name: 'Lat Pulldown', muscleGroup: 'back', equipment: 'cable' },
  { id: 'ex-barbell-row', name: 'Barbell Row', muscleGroup: 'back', equipment: 'barbell' },
  { id: 'ex-db-row', name: 'Dumbbell Row', muscleGroup: 'back', equipment: 'dumbbell' },
  { id: 'ex-seated-row', name: 'Seated Cable Row', muscleGroup: 'back', equipment: 'cable' },
  { id: 'ex-deadlift', name: 'Deadlift', muscleGroup: 'back', equipment: 'barbell' },

  // Shoulders
  { id: 'ex-overhead-press', name: 'Overhead Press', muscleGroup: 'shoulders', equipment: 'barbell' },
  { id: 'ex-db-shoulder-press', name: 'Dumbbell Shoulder Press', muscleGroup: 'shoulders', equipment: 'dumbbell' },
  { id: 'ex-lateral-raise', name: 'Lateral Raise', muscleGroup: 'shoulders', equipment: 'dumbbell' },
  { id: 'ex-face-pull', name: 'Face Pull', muscleGroup: 'shoulders', equipment: 'cable' },

  // Arms
  { id: 'ex-db-curl', name: 'Dumbbell Curl', muscleGroup: 'arms', equipment: 'dumbbell' },
  { id: 'ex-barbell-curl', name: 'Barbell Curl', muscleGroup: 'arms', equipment: 'barbell' },
  { id: 'ex-triceps-pushdown', name: 'Triceps Pushdown', muscleGroup: 'arms', equipment: 'cable' },
  { id: 'ex-skullcrusher', name: 'Skull Crusher', muscleGroup: 'arms', equipment: 'barbell' },

  // Legs
  { id: 'ex-back-squat', name: 'Back Squat', muscleGroup: 'legs', equipment: 'barbell' },
  { id: 'ex-front-squat', name: 'Front Squat', muscleGroup: 'legs', equipment: 'barbell' },
  { id: 'ex-leg-press', name: 'Leg Press', muscleGroup: 'legs', equipment: 'machine' },
  { id: 'ex-lunge', name: 'Walking Lunge', muscleGroup: 'legs', equipment: 'dumbbell' },
  { id: 'ex-leg-curl', name: 'Leg Curl', muscleGroup: 'legs', equipment: 'machine' },
  { id: 'ex-calf-raise', name: 'Calf Raise', muscleGroup: 'legs', equipment: 'machine' },
  { id: 'ex-hang', name: 'Dead Hang', muscleGroup: 'legs', equipment: 'bodyweight' },

  // Glutes
  { id: 'ex-hip-thrust', name: 'Hip Thrust', muscleGroup: 'glutes', equipment: 'barbell' },
  { id: 'ex-glute-bridge', name: 'Glute Bridge', muscleGroup: 'glutes', equipment: 'bodyweight' },
  { id: 'ex-kb-swing', name: 'Kettlebell Swing', muscleGroup: 'glutes', equipment: 'kettlebell' },

  // Core
  { id: 'ex-plank', name: 'Plank', muscleGroup: 'core', equipment: 'bodyweight' },
  { id: 'ex-crunch', name: 'Crunch', muscleGroup: 'core', equipment: 'bodyweight' },
  { id: 'ex-hanging-leg-raise', name: 'Hanging Leg Raise', muscleGroup: 'core', equipment: 'bodyweight' },
  { id: 'ex-cable-crunch', name: 'Cable Crunch', muscleGroup: 'core', equipment: 'cable' },

  // Full body
  { id: 'ex-clean-and-press', name: 'Clean and Press', muscleGroup: 'full_body', equipment: 'barbell' },
  { id: 'ex-burpee', name: 'Burpee', muscleGroup: 'full_body', equipment: 'bodyweight' },
  { id: 'ex-kb-clean', name: 'Kettlebell Clean', muscleGroup: 'full_body', equipment: 'kettlebell' },

  // Mobility and stretching
  { id: 'ex-cat-cow', name: 'Cat Cow', muscleGroup: 'mobility', equipment: 'none' },
  { id: 'ex-90-90', name: '90/90 Hip Switch', muscleGroup: 'mobility', equipment: 'none' },
  { id: 'ex-hip-flexor-stretch', name: 'Hip Flexor Stretch', muscleGroup: 'mobility', equipment: 'none' },
  { id: 'ex-thoracic-rotation', name: 'Thoracic Rotation', muscleGroup: 'mobility', equipment: 'none' },
  { id: 'ex-bird-dog', name: 'Bird Dog', muscleGroup: 'mobility', equipment: 'none' },
  { id: 'ex-worlds-greatest-stretch', name: "World's Greatest Stretch", muscleGroup: 'mobility', equipment: 'none' },
];

/** Exercises that record duration rather than reps and weight. */
export const TIMED_EXERCISES: ReadonlySet<string> = new Set([
  'ex-plank',
  'ex-hang',
  'ex-90-90',
  'ex-cat-cow',
  'ex-hip-flexor-stretch',
  'ex-thoracic-rotation',
  'ex-bird-dog',
  'ex-worlds-greatest-stretch',
]);

export function findCatalogExercise(id: string): CatalogExercise | undefined {
  return EXERCISE_CATALOG.find((e) => e.id === id);
}
