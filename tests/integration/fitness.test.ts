/**
 * Fitness end-to-end through service -> repository -> real SQLite.
 *
 * The edge cases named in the specification are the focus: bodyweight, zero weight,
 * fractional weight, incomplete sets, an interrupted workout, duplicate taps and
 * invalid values.
 */

import { NodeSqliteDriver } from '../support/nodeSqliteDriver';
import {
  __resetDatabaseHandleForTests,
  __setDatabaseHandleForTests,
} from '@/database/database';
import { runMigrations } from '@/database/migrator';
import { LATEST_SCHEMA_VERSION } from '@/database/migrations/types';
import { seedReferenceData } from '@/database/seed';
import { EXERCISE_CATALOG } from '@/data/exerciseCatalog';
import { SPORTS_CATALOG } from '@/data/sportsCatalog';
import * as fitness from '@/services/fitnessService';
import { ValidationError } from '@/services/errors';

const SQUAT = 'ex-back-squat';
const PUSH_UP = 'ex-push-up';
const PLANK = 'ex-plank';

let driver: NodeSqliteDriver;

beforeEach(async () => {
  driver = new NodeSqliteDriver();
  await runMigrations(driver);
  await seedReferenceData(driver);
  __setDatabaseHandleForTests(driver, LATEST_SCHEMA_VERSION);
});

afterEach(async () => {
  __resetDatabaseHandleForTests();
  await driver.close();
});

async function startGym() {
  return fitness.startWorkout({ title: 'Push day', activityType: 'gym' });
}

describe('seeding reference data', () => {
  it('inserts the exercise and sport catalogues on first open', async () => {
    expect((await fitness.listExercises()).length).toBe(EXERCISE_CATALOG.length);
    expect((await fitness.listSports()).length).toBe(SPORTS_CATALOG.length);
  });

  it('is idempotent, so a second launch adds nothing', async () => {
    const again = await seedReferenceData(driver);
    expect(again.exercisesInserted).toBe(0);
    expect(again.sportsInserted).toBe(0);
    expect((await fitness.listExercises()).length).toBe(EXERCISE_CATALOG.length);
  });

  it('includes every sport the specification requires', async () => {
    const names = (await fitness.listSports()).map((s) => s.name.toLowerCase());
    for (const required of [
      'basketball', 'soccer', 'tennis', 'boxing', 'muay thai', 'swimming', 'hiking',
      'trail running', 'skiing', 'gymnastics', 'archery', 'fencing', 'pickleball',
      'brazilian jiu-jitsu', 'paddleboarding', 'snowboarding', 'bowling', 'darts',
    ]) {
      expect(names).toContain(required);
    }
  });

  it('gives each sport its own metric schema', async () => {
    const sports = await fitness.listSports();
    const swimming = sports.find((s) => s.name === 'Swimming');
    const boxing = sports.find((s) => s.name === 'Boxing');

    expect(swimming?.metrics.map((m) => m.key)).toContain('distance_m');
    expect(boxing?.metrics.map((m) => m.key)).toContain('rounds');
    expect(boxing?.metrics.map((m) => m.key)).not.toContain('distance_m');
  });

  it('treats seeded entries as built-in, not user-created', async () => {
    expect((await fitness.listExercises()).every((e) => e.isCustom)).toBe(false);
  });
});
describe('logging sets', () => {
  it('records a weighted set and numbers it per exercise', async () => {
    const workout = await startGym();

    const first = await fitness.logSet(workout.id, { exerciseId: SQUAT, reps: 5, weightGrams: 60_000 });
    const second = await fitness.logSet(workout.id, { exerciseId: SQUAT, reps: 5, weightGrams: 70_000 });

    expect(first.setNumber).toBe(1);
    expect(second.setNumber).toBe(2);
    expect(second.weightGrams).toBe(70_000);
  });

  it('restarts numbering for a different exercise', async () => {
    const workout = await startGym();
    await fitness.logSet(workout.id, { exerciseId: SQUAT, reps: 5, weightGrams: 60_000 });
    const other = await fitness.logSet(workout.id, { exerciseId: PUSH_UP, reps: 10, weightGrams: 0 });

    expect(other.setNumber).toBe(1);
  });

  it('keeps bodyweight as a real zero rather than null', async () => {
    const workout = await startGym();
    const set = await fitness.logSet(workout.id, { exerciseId: PUSH_UP, reps: 15, weightGrams: 0 });

    // Zero must survive: "bodyweight" is different information from "not recorded".
    expect(set.weightGrams).toBe(0);
    expect(set.weightGrams).not.toBeNull();
  });

  it('stores a fractional plate weight exactly', async () => {
    const workout = await startGym();
    const set = await fitness.logSet(workout.id, { exerciseId: SQUAT, reps: 10, weightGrams: 1134 });
    expect(set.weightGrams).toBe(1134);
  });

  it('records a timed set for a held exercise', async () => {
    const workout = await startGym();
    const set = await fitness.logSet(workout.id, { exerciseId: PLANK, durationSec: 90 });

    expect(set.durationSec).toBe(90);
    expect(set.reps).toBeNull();
    expect(set.weightGrams).toBeNull();
  });

  it('records RPE as a scaled integer', async () => {
    const workout = await startGym();
    const set = await fitness.logSet(workout.id, {
      exerciseId: SQUAT,
      reps: 5,
      weightGrams: 80_000,
      rpe: 8.5,
    });

    expect(set.rpeScaled).toBe(85);
  });

  it('refuses an entirely empty set with a readable message', async () => {
    const workout = await startGym();
    expect.assertions(2);
    try {
      await fitness.logSet(workout.id, {
        exerciseId: SQUAT,
        reps: null,
        weightGrams: null,
        durationSec: null,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fields.reps).toContain('Enter reps');
    }
  });

  it('refuses invalid values', async () => {
    const workout = await startGym();

    await expect(
      fitness.logSet(workout.id, { exerciseId: SQUAT, reps: -1, weightGrams: 1000 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      fitness.logSet(workout.id, { exerciseId: SQUAT, reps: 5, weightGrams: 99_999_999 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      fitness.logSet(workout.id, { exerciseId: SQUAT, reps: 5, weightGrams: 1000, rpe: 42 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      fitness.logSet(workout.id, { exerciseId: 'no-such-exercise', reps: 5, weightGrams: 1000 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('assigns distinct set numbers under concurrent logging', async () => {
    const workout = await startGym();

    await Promise.all([
      fitness.logSet(workout.id, { exerciseId: SQUAT, reps: 5, weightGrams: 60_000 }),
      fitness.logSet(workout.id, { exerciseId: SQUAT, reps: 5, weightGrams: 60_000 }),
      fitness.logSet(workout.id, { exerciseId: SQUAT, reps: 5, weightGrams: 60_000 }),
    ]);

    const sets = await fitness.listSets(workout.id);
    expect(sets.map((s) => s.setNumber).sort()).toEqual([1, 2, 3]);
  });
});

describe('completing and interrupting workouts', () => {
  it('stamps an end time on completion', async () => {
    const workout = await startGym();
    await fitness.logSet(workout.id, { exerciseId: SQUAT, reps: 5, weightGrams: 60_000 });

    const done = await fitness.completeWorkout(workout.id);
    expect(done?.status).toBe('completed');
    expect(done?.endedAt).not.toBeNull();
    expect((done?.endedAt ?? 0) >= (done?.startedAt ?? 0)).toBe(true);
  });

  it('recovers an interrupted workout after a restart', async () => {
    const workout = await startGym();
    await fitness.logSet(workout.id, { exerciseId: SQUAT, reps: 5, weightGrams: 60_000 });

    // Simulate the process being killed: drop every in-memory handle.
    __resetDatabaseHandleForTests();
    __setDatabaseHandleForTests(driver, LATEST_SCHEMA_VERSION);

    expect((await fitness.findResumableWorkout())?.id).toBe(workout.id);
    expect(await fitness.listSets(workout.id)).toHaveLength(1);
  });

  it('keeps sets when a workout is abandoned rather than deleted', async () => {
    const workout = await startGym();
    await fitness.logSet(workout.id, { exerciseId: SQUAT, reps: 5, weightGrams: 60_000 });

    await fitness.abandonWorkout(workout.id);

    expect((await fitness.getWorkout(workout.id))?.status).toBe('abandoned');
    expect(await fitness.listSets(workout.id)).toHaveLength(1);
  });

  it('clears the end time when a workout is reopened', async () => {
    const workout = await startGym();
    await fitness.completeWorkout(workout.id);

    const reopened = await fitness.setWorkoutStatus(workout.id, 'in_progress');
    expect(reopened?.status).toBe('in_progress');
    expect(reopened?.endedAt).toBeNull();
  });

  it('reports volume and duration for a workout', async () => {
    const workout = await startGym();
    await fitness.logSet(workout.id, { exerciseId: SQUAT, reps: 5, weightGrams: 60_000 });
    await fitness.logSet(workout.id, { exerciseId: SQUAT, reps: 5, weightGrams: 60_000 });
    await fitness.logSet(workout.id, { exerciseId: PLANK, durationSec: 60 });

    const summary = await fitness.workoutSummary(workout.id);
    expect(summary?.setCount).toBe(3);
    expect(summary?.exerciseCount).toBe(2);
    // 60 kg x 10 reps = 600 kg, stored as 600000 grams.
    expect(summary?.volumeGrams).toBe(600_000);
    expect(summary?.workSeconds).toBe(60);
  });
});

describe('personal records', () => {
  it('reports the heaviest working set', async () => {
    const first = await startGym();
    await fitness.logSet(first.id, { exerciseId: SQUAT, reps: 5, weightGrams: 100_000 });
    await fitness.completeWorkout(first.id);

    const second = await startGym();
    await fitness.logSet(second.id, { exerciseId: SQUAT, reps: 3, weightGrams: 110_000 });
    await fitness.completeWorkout(second.id);

    const record = await fitness.personalRecordsForExercise(SQUAT);
    expect(record?.heaviestWeightGrams).toBe(110_000);
    expect(record?.heaviestReps).toBe(3);
  });

  it('ignores warm-up sets when choosing a heaviest lift', async () => {
    const workout = await startGym();
    await fitness.logSet(workout.id, {
      exerciseId: SQUAT,
      reps: 10,
      weightGrams: 40_000,
      setType: 'warmup',
    });
    await fitness.logSet(workout.id, { exerciseId: SQUAT, reps: 5, weightGrams: 100_000 });
    await fitness.completeWorkout(workout.id);

    expect((await fitness.personalRecordsForExercise(SQUAT))?.heaviestWeightGrams).toBe(100_000);
  });

  it('recomputes the record when an earlier set is corrected', async () => {
    const workout = await startGym();
    const heavy = await fitness.logSet(workout.id, { exerciseId: SQUAT, reps: 5, weightGrams: 120_000 });
    await fitness.logSet(workout.id, { exerciseId: SQUAT, reps: 5, weightGrams: 90_000 });
    await fitness.completeWorkout(workout.id);

    expect((await fitness.personalRecordsForExercise(SQUAT))?.heaviestWeightGrams).toBe(120_000);

    // Correct the mistake; the derived record must follow immediately.
    await fitness.updateSet(heavy.id, { weightGrams: 50_000 });
    expect((await fitness.personalRecordsForExercise(SQUAT))?.heaviestWeightGrams).toBe(90_000);
  });

  it('ignores bodyweight sets when picking a heaviest lift', async () => {
    const workout = await startGym();
    await fitness.logSet(workout.id, { exerciseId: PUSH_UP, reps: 20, weightGrams: 0 });
    await fitness.completeWorkout(workout.id);

    // A zero-load "record" is not meaningful.
    expect((await fitness.personalRecordsForExercise(PUSH_UP))?.heaviestWeightGrams).toBeNull();
  });

  it('excludes unfinished workouts from records', async () => {
    const workout = await startGym();
    await fitness.logSet(workout.id, { exerciseId: SQUAT, reps: 5, weightGrams: 200_000 });
    // Still in progress, so it must not count.

    expect((await fitness.personalRecordsForExercise(SQUAT))?.heaviestWeightGrams).toBeNull();
  });
});

describe('body metrics', () => {
  const T0 = 1_767_225_600_000; // a fixed instant, so the test is not clock-dependent

  it('records weight and scaled body fat', async () => {
    const metric = await fitness.recordBodyMetric({
      measuredAt: T0,
      weightGrams: 82_400,
      bodyFatPercent: 18.5,
    });

    expect(metric.weightGrams).toBe(82_400);
    // 18.5% is stored as 185, so no float reaches the database.
    expect(metric.bodyFatScaled).toBe(185);
  });

  it('is idempotent when measuring twice at the same instant', async () => {
    await fitness.recordBodyMetric({ measuredAt: T0, weightGrams: 82_400 });
    await fitness.recordBodyMetric({ measuredAt: T0, weightGrams: 82_100 });

    const all = await fitness.listBodyMetrics();
    expect(all).toHaveLength(1);
    expect(all[0]?.weightGrams).toBe(82_100);
  });

  it('refuses an out-of-range body fat percentage', async () => {
    await expect(
      fitness.recordBodyMetric({ measuredAt: T0, bodyFatPercent: 150 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a measurement with nothing recorded', async () => {
    await expect(fitness.recordBodyMetric({ measuredAt: T0 })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('sport sessions', () => {
  it('records a session using the sport own metrics', async () => {
    const swimming = (await fitness.listSports()).find((s) => s.name === 'Swimming');
    const startedAt = 1_767_225_600_000;

    const session = await fitness.logSportSession({
      sportId: swimming?.id ?? '',
      startedAt,
      endedAt: startedAt + 2_700_000,
      metrics: { distance_m: 2000, duration_s: 2700 },
      intensity: 'moderate',
    });

    expect(session.metrics.distance_m).toBe(2000);
    // Duration is derived from the timestamps rather than trusted from a field.
    expect(session.durationSec).toBe(2700);
  });

  it('drops metrics the sport does not declare', async () => {
    const boxing = (await fitness.listSports()).find((s) => s.name === 'Boxing');

    const session = await fitness.logSportSession({
      sportId: boxing?.id ?? '',
      metrics: { rounds: 12, distance_m: 5000 },
    });

    // Boxing has no distance; accepting it would create a key no report reads.
    expect(session.metrics.rounds).toBe(12);
    expect(session.metrics.distance_m).toBeUndefined();
  });

  it('rejects finishing before starting', async () => {
    const sports = await fitness.listSports();
    const startedAt = 1_767_225_600_000;

    await expect(
      fitness.logSportSession({ sportId: sports[0]?.id ?? '', startedAt, endedAt: startedAt - 1000 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('supports a user-defined sport with custom metrics', async () => {
    const custom = await fitness.createCustomSport({
      name: 'Indoor climbing',
      category: 'outdoor',
      metrics: [{ key: 'routes_sent', label: 'Routes sent', unit: 'count' }],
    });

    expect(custom.isCustom).toBe(true);

    const session = await fitness.logSportSession({ sportId: custom.id, metrics: { routes_sent: 7 } });
    expect(session.metrics.routes_sent).toBe(7);
  });

  it('refuses a custom sport with a malformed metric key', async () => {
    await expect(
      fitness.createCustomSport({
        name: 'Bad',
        category: 'outdoor',
        metrics: [{ key: 'Bad Key!', label: 'Nope', unit: 'count' }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('totals distance for a sport', async () => {
    const hiking = (await fitness.listSports()).find((s) => s.name === 'Hiking');
    const sportId = hiking?.id ?? '';

    await fitness.logSportSession({ sportId, metrics: { distance_m: 5000 } });
    await fitness.logSportSession({ sportId, metrics: { distance_m: 7500 } });

    expect(await fitness.sportDistanceMetres(sportId)).toBe(12_500);
  });
});

describe('custom exercises', () => {
  it('creates a user-defined exercise', async () => {
    const created = await fitness.createCustomExercise({
      name: 'Zercher Squat',
      muscleGroup: 'legs',
      equipment: 'barbell',
    });

    expect(created.isCustom).toBe(true);
    expect((await fitness.listExercises()).some((e) => e.id === created.id)).toBe(true);
  });

  it('refuses an empty name', async () => {
    await expect(fitness.createCustomExercise({ name: '  ' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

