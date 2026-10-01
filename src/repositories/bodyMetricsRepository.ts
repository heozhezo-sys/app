/**
 * Bodyweight and body-composition history.
 *
 * `body_metrics` has a unique index on `measured_at` where not deleted, so measuring
 * at the same instant twice updates the existing row rather than creating a
 * conflicting pair. That turns "I pressed save twice" into a no-op instead of a
 * duplicate.
 */

import type { SqlDriver } from '@/database/driver';
import { getDatabase, notify, CHANNELS } from '@/database/database';
import { createId } from '@/utils/id';
import type { BodyMetric } from '@/types/fitness';

interface BodyMetricRow {
  id: string;
  measured_at: number;
  weight_grams: number | null;
  body_fat_x10: number | null;
  note: string | null;
  created_at: number;
  updated_at: number;
}

function toBodyMetric(row: BodyMetricRow): BodyMetric {
  return {
    id: row.id,
    measuredAt: row.measured_at,
    weightGrams: row.weight_grams,
    bodyFatScaled: row.body_fat_x10,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function driver(): Promise<SqlDriver> {
  return (await getDatabase()).driver;
}

function announce(): void {
  notify(CHANNELS.bodyMetrics);
  notify(CHANNELS.today);
}

export async function listBodyMetrics(limit = 200): Promise<BodyMetric[]> {
  const db = await driver();
  const rows = await db.all<BodyMetricRow>(
    `SELECT * FROM body_metrics
      WHERE deleted_at IS NULL
      ORDER BY measured_at DESC
      LIMIT ?;`,
    [limit],
  );
  return rows.map(toBodyMetric);
}

export async function latestBodyMetric(): Promise<BodyMetric | null> {
  const db = await driver();
  const row = await db.first<BodyMetricRow>(
    'SELECT * FROM body_metrics WHERE deleted_at IS NULL ORDER BY measured_at DESC LIMIT 1;',
  );
  return row ? toBodyMetric(row) : null;
}

/**
 * Records or updates a measurement at a given instant.
 *
 * Uses `ON CONFLICT (measured_at) DO UPDATE` against the partial unique index, so
 * re-measuring at the same timestamp is idempotent rather than an error.
 */
export async function upsertBodyMetric(input: {
  measuredAt: number;
  weightGrams: number | null;
  bodyFatScaled: number | null;
  note: string | null;
}): Promise<BodyMetric> {
  const db = await driver();
  const now = Date.now();

  await db.run(
    `INSERT INTO body_metrics (id, measured_at, weight_grams, body_fat_x10, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (measured_at) WHERE deleted_at IS NULL
     DO UPDATE SET
       weight_grams = excluded.weight_grams,
       body_fat_x10 = excluded.body_fat_x10,
       note = excluded.note,
       updated_at = excluded.updated_at;`,
    [
      createId(),
      input.measuredAt,
      input.weightGrams,
      input.bodyFatScaled,
      input.note,
      now,
      now,
    ],
  );

  announce();
  const stored = await db.first<BodyMetricRow>(
    'SELECT * FROM body_metrics WHERE measured_at = ? AND deleted_at IS NULL;',
    [input.measuredAt],
  );
  if (!stored) throw new Error(`Body metric at ${input.measuredAt} could not be stored`);
  return toBodyMetric(stored);
}

export async function deleteBodyMetric(id: string): Promise<void> {
  const db = await driver();
  await db.run(
    'UPDATE body_metrics SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL;',
    [Date.now(), Date.now(), id],
  );
  announce();
}
