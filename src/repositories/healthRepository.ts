/**
 * Health persistence: hydration, foods, nutrition entries and sleep.
 *
 * Two conventions from migration 007 are load-bearing here and are preserved rather than
 * worked around:
 *
 * - Quantities are integers with an explicit scale (`amount_ml`, `_g_x10`, `_min`). Nothing
 *   in this file introduces a float column or a float comparison.
 * - `nutrition_entries` **snapshots** the consumed calories and macros. The entry does not
 *   read its numbers from `foods` at display time, so editing a food definition later can
 *   never rewrite what someone ate on a past date.
 */

import type { SqlDriver, SqlValue } from '@/database/driver';
import { getDatabase, notify, CHANNELS } from '@/database/database';
import { createId } from '@/utils/id';
import type { DateKey } from '@/utils/dates';
import type { Meal, NutritionSnapshot } from '@/health/nutritionMath';

export interface WaterLog {
  id: string;
  logDate: DateKey;
  amountMl: number;
  loggedAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface Food {
  id: string;
  name: string;
  servingGrams: number;
  calories: number;
  /** Tenths of a gram. */
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  isCustom: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface NutritionEntry {
  id: string;
  foodId: string | null;
  name: string;
  meal: Meal;
  eatenAt: number;
  servingsX100: number;
  /** Snapshot values, not a live reference to the food. */
  nutrition: NutritionSnapshot;
  createdAt: number;
  updatedAt: number;
}

export interface SleepLog {
  id: string;
  sleepDate: DateKey;
  bedtime: number;
  wakeTime: number;
  durationMin: number;
  quality: number | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

async function driver(): Promise<SqlDriver> {
  return (await getDatabase()).driver;
}

function announceHydration(): void {
  notify(CHANNELS.health);
  notify(CHANNELS.today);
}

function announceNutrition(): void {
  notify(CHANNELS.nutrition);
  notify(CHANNELS.today);
}

function announceSleep(): void {
  notify(CHANNELS.sleep);
  notify(CHANNELS.today);
}

/* --------------------------------------------------------------- hydration */

interface WaterRow {
  id: string;
  log_date: DateKey;
  amount_ml: number;
  logged_at: number;
  created_at: number;
  updated_at: number;
}

function toWater(row: WaterRow): WaterLog {
  return {
    id: row.id,
    logDate: row.log_date,
    amountMl: row.amount_ml,
    loggedAt: row.logged_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertWaterLog(input: {
  logDate: DateKey;
  amountMl: number;
  loggedAt: number;
}): Promise<WaterLog> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    'INSERT INTO water_logs (id, log_date, amount_ml, logged_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?);',
    [id, input.logDate, input.amountMl, input.loggedAt, now, now],
  );

  announceHydration();
  const created = await getWaterLog(id);
  if (!created) throw new Error(`Water log ${id} vanished immediately after insert`);
  return created;
}

export async function getWaterLog(id: string): Promise<WaterLog | null> {
  const db = await driver();
  const row = await db.first<WaterRow>(
    'SELECT * FROM water_logs WHERE id = ? AND deleted_at IS NULL;',
    [id],
  );
  return row ? toWater(row) : null;
}

export async function listWaterLogs(date: DateKey): Promise<WaterLog[]> {
  const db = await driver();
  const rows = await db.all<WaterRow>(
    'SELECT * FROM water_logs WHERE log_date = ? AND deleted_at IS NULL ORDER BY logged_at DESC;',
    [date],
  );
  return rows.map(toWater);
}

export async function listWaterRange(from: DateKey, to: DateKey): Promise<WaterLog[]> {
  const db = await driver();
  const rows = await db.all<WaterRow>(
    `SELECT * FROM water_logs
      WHERE log_date >= ? AND log_date <= ? AND deleted_at IS NULL
      ORDER BY log_date DESC, logged_at DESC;`,
    [from, to],
  );
  return rows.map(toWater);
}

/** Total millilitres for one local calendar day. */
export async function waterTotal(date: DateKey): Promise<number> {
  const db = await driver();
  const row = await db.first<{ total: number | null }>(
    'SELECT SUM(amount_ml) AS total FROM water_logs WHERE log_date = ? AND deleted_at IS NULL;',
    [date],
  );
  // SUM over no rows is NULL, which means zero millilitres, not a missing total.
  return row?.total ?? 0;
}

export async function softDeleteWaterLog(id: string): Promise<void> {
  const db = await driver();
  await db.run('UPDATE water_logs SET deleted_at = ? WHERE id = ?;', [Date.now(), id]);
  announceHydration();
}
/* ------------------------------------------------------------------ foods */

interface FoodRow {
  id: string;
  name: string;
  serving_grams: number;
  calories: number;
  protein_g_x10: number;
  carbs_g_x10: number;
  fat_g_x10: number;
  fiber_g_x10: number;
  is_custom: number;
  created_at: number;
  updated_at: number;
}

function toFood(row: FoodRow): Food {
  return {
    id: row.id,
    name: row.name,
    servingGrams: row.serving_grams,
    calories: row.calories,
    proteinG: row.protein_g_x10,
    carbsG: row.carbs_g_x10,
    fatG: row.fat_g_x10,
    fiberG: row.fiber_g_x10,
    isCustom: row.is_custom === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertFood(input: {
  name: string;
  servingGrams: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
}): Promise<Food> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO foods
       (id, name, serving_grams, calories, protein_g_x10, carbs_g_x10, fat_g_x10,
        fiber_g_x10, is_custom, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?);`,
    [
      id,
      input.name,
      input.servingGrams,
      input.calories,
      input.proteinG,
      input.carbsG,
      input.fatG,
      input.fiberG,
      now,
      now,
    ],
  );

  announceNutrition();
  const created = await getFood(id);
  if (!created) throw new Error(`Food ${id} vanished immediately after insert`);
  return created;
}

export async function getFood(id: string): Promise<Food | null> {
  const db = await driver();
  const row = await db.first<FoodRow>(
    'SELECT * FROM foods WHERE id = ? AND deleted_at IS NULL;',
    [id],
  );
  return row ? toFood(row) : null;
}

export async function listFoods(limit = 100): Promise<Food[]> {
  const db = await driver();
  const rows = await db.all<FoodRow>(
    'SELECT * FROM foods WHERE deleted_at IS NULL ORDER BY name ASC LIMIT ?;',
    [Math.min(Math.max(1, limit), 500)],
  );
  return rows.map(toFood);
}

/**
 * Updates a food definition.
 *
 * Safe with respect to history precisely because entries snapshot their values: existing
 * nutrition entries are not touched and keep reporting what was actually eaten. A test
 * asserts this, because it is the whole reason the snapshot exists.
 */
export async function updateFood(
  id: string,
  patch: Partial<{
    name: string;
    servingGrams: number;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
  }>,
): Promise<Food | null> {
  const db = await driver();
  const columns: string[] = [];
  const params: SqlValue[] = [];

  const set = (column: string, value: SqlValue): void => {
    columns.push(`${column} = ?`);
    params.push(value);
  };

  if (patch.name !== undefined) set('name', patch.name);
  if (patch.servingGrams !== undefined) set('serving_grams', patch.servingGrams);
  if (patch.calories !== undefined) set('calories', patch.calories);
  if (patch.proteinG !== undefined) set('protein_g_x10', patch.proteinG);
  if (patch.carbsG !== undefined) set('carbs_g_x10', patch.carbsG);
  if (patch.fatG !== undefined) set('fat_g_x10', patch.fatG);
  if (patch.fiberG !== undefined) set('fiber_g_x10', patch.fiberG);

  if (columns.length === 0) return getFood(id);

  set('updated_at', Date.now());
  params.push(id);
  await db.run(`UPDATE foods SET ${columns.join(', ')} WHERE id = ?;`, params);
  announceNutrition();
  return getFood(id);
}

/* -------------------------------------------------------- nutrition entries */

interface EntryRow {
  id: string;
  food_id: string | null;
  name: string;
  meal: Meal;
  eaten_at: number;
  servings_x100: number;
  calories: number;
  protein_g_x10: number;
  carbs_g_x10: number;
  fat_g_x10: number;
  fiber_g_x10: number;
  created_at: number;
  updated_at: number;
}

function toEntry(row: EntryRow): NutritionEntry {
  return {
    id: row.id,
    foodId: row.food_id,
    name: row.name,
    meal: row.meal,
    eatenAt: row.eaten_at,
    servingsX100: row.servings_x100,
    nutrition: {
      calories: row.calories,
      proteinG: row.protein_g_x10,
      carbsG: row.carbs_g_x10,
      fatG: row.fat_g_x10,
      fiberG: row.fiber_g_x10,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Logs an intake.
 *
 * The `nutrition` passed in is written as-is. Nothing here reads the food row, which is
 * what makes the stored entry an immutable record of what was eaten.
 */
export async function insertNutritionEntry(input: {
  foodId: string | null;
  name: string;
  meal: Meal;
  eatenAt: number;
  servingsX100: number;
  nutrition: NutritionSnapshot;
}): Promise<NutritionEntry> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO nutrition_entries
       (id, food_id, name, meal, eaten_at, servings_x100, calories, protein_g_x10,
        carbs_g_x10, fat_g_x10, fiber_g_x10, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.foodId,
      input.name,
      input.meal,
      input.eatenAt,
      input.servingsX100,
      input.nutrition.calories,
      input.nutrition.proteinG,
      input.nutrition.carbsG,
      input.nutrition.fatG,
      input.nutrition.fiberG,
      now,
      now,
    ],
  );

  announceNutrition();
  const created = await getNutritionEntry(id);
  if (!created) throw new Error(`Nutrition entry ${id} vanished immediately after insert`);
  return created;
}

export async function getNutritionEntry(id: string): Promise<NutritionEntry | null> {
  const db = await driver();
  const row = await db.first<EntryRow>(
    'SELECT * FROM nutrition_entries WHERE id = ? AND deleted_at IS NULL;',
    [id],
  );
  return row ? toEntry(row) : null;
}

/** Entries within a local-calendar day, oldest first, for meal grouping. */
export async function listNutritionEntries(from: number, to: number): Promise<NutritionEntry[]> {
  const db = await driver();
  const rows = await db.all<EntryRow>(
    `SELECT * FROM nutrition_entries
      WHERE eaten_at >= ? AND eaten_at <= ? AND deleted_at IS NULL
      ORDER BY eaten_at ASC;`,
    [from, to],
  );
  return rows.map(toEntry);
}

export async function softDeleteNutritionEntry(id: string): Promise<void> {
  const db = await driver();
  await db.run('UPDATE nutrition_entries SET deleted_at = ? WHERE id = ?;', [Date.now(), id]);
  announceNutrition();
}

/* ------------------------------------------------------------------ sleep */

interface SleepRow {
  id: string;
  sleep_date: DateKey;
  bedtime: number;
  wake_time: number;
  duration_min: number;
  quality: number | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

function toSleep(row: SleepRow): SleepLog {
  return {
    id: row.id,
    sleepDate: row.sleep_date,
    bedtime: row.bedtime,
    wakeTime: row.wake_time,
    durationMin: row.duration_min,
    quality: row.quality,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertSleepLog(input: {
  sleepDate: DateKey;
  bedtime: number;
  wakeTime: number;
  durationMin: number;
  quality: number | null;
  notes: string | null;
}): Promise<SleepLog> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO sleep_logs
       (id, sleep_date, bedtime, wake_time, duration_min, quality, notes,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.sleepDate,
      input.bedtime,
      input.wakeTime,
      input.durationMin,
      input.quality,
      input.notes,
      now,
      now,
    ],
  );

  announceSleep();
  const created = await getSleepLog(id);
  if (!created) throw new Error(`Sleep log ${id} vanished immediately after insert`);
  return created;
}

export async function getSleepLog(id: string): Promise<SleepLog | null> {
  const db = await driver();
  const row = await db.first<SleepRow>(
    'SELECT * FROM sleep_logs WHERE id = ? AND deleted_at IS NULL;',
    [id],
  );
  return row ? toSleep(row) : null;
}

/**
 * Sleep logs for a date range, newest first.
 *
 * Ordered by `sleep_date` rather than by bedtime, because `sleep_date` is the wake day —
 * the day a user means when they say "last night's sleep".
 */
export async function listSleepLogs(from: DateKey, to: DateKey): Promise<SleepLog[]> {
  const db = await driver();
  const rows = await db.all<SleepRow>(
    `SELECT * FROM sleep_logs
      WHERE sleep_date >= ? AND sleep_date <= ? AND deleted_at IS NULL
      ORDER BY sleep_date DESC;`,
    [from, to],
  );
  return rows.map(toSleep);
}

export async function softDeleteSleepLog(id: string): Promise<void> {
  const db = await driver();
  await db.run('UPDATE sleep_logs SET deleted_at = ? WHERE id = ?;', [Date.now(), id]);
  announceSleep();
}
