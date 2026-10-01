/**
 * Reference data seeding.
 *
 * The exercise and sport catalogues are *data*, not schema, so they are seeded
 * idempotently after migrations rather than baked into a migration. A released
 * migration is immutable (ADR-0007); a catalogue addition should not require editing
 * shipped SQL.
 *
 * Seeding is safe to run on every launch: `INSERT ... ON CONFLICT DO NOTHING` means an
 * existing row is never overwritten, so a user's rename or custom entry survives.
 */

import type { SqlDriver } from './driver';
import { EXERCISE_CATALOG } from '@/data/exerciseCatalog';
import { SPORTS_CATALOG } from '@/data/sportsCatalog';
import { logger } from '@/utils/logger';

export interface SeedResult {
  exercisesInserted: number;
  sportsInserted: number;
}

/**
 * Inserts any missing catalogue rows.
 *
 * Uses `ON CONFLICT DO NOTHING` rather than `INSERT OR REPLACE`: replacing a row would
 * discard any user edits and reset `is_archived`.
 */
export async function seedReferenceData(driver: SqlDriver): Promise<SeedResult> {
  const now = Date.now();

  let exercisesInserted = 0;
  for (const item of EXERCISE_CATALOG) {
    const result = await driver.run(
      `INSERT INTO exercises (id, name, muscle_group, equipment, is_custom, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(id) DO NOTHING;`,
      [item.id, item.name, item.muscleGroup, item.equipment, now, now],
    );
    exercisesInserted += result.changes;
  }

  let sportsInserted = 0;
  for (const item of SPORTS_CATALOG) {
    const result = await driver.run(
      `INSERT INTO sports (id, name, category, metric_schema, is_custom, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(id) DO NOTHING;`,
      [item.id, item.name, item.category, JSON.stringify(item.metrics), now, now],
    );
    sportsInserted += result.changes;
  }

  const result: SeedResult = { exercisesInserted, sportsInserted };
  if (exercisesInserted > 0 || sportsInserted > 0) {
    logger.info(
      `Seeded reference data: ${exercisesInserted} exercises, ${sportsInserted} sports`,
    );
  }
  return result;
}
