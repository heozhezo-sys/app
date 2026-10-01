import type { Migration } from './types';

/**
 * 007 — Health: hydration, nutrition and sleep.
 *
 * All quantities are integers with an explicit scale (`_ml`, `_g_x10`, `_min`) so that
 * arithmetic on user history is exact. No float column exists anywhere in this schema.
 *
 * Nutrition entries snapshot the consumed amounts instead of referencing the food row
 * for its numbers. Editing a food definition later therefore never silently rewrites
 * what a user ate on a past date.
 */
export const migration007: Migration = {
  version: 7,
  name: 'health',
  statements: [
    `CREATE TABLE water_logs (
       id           TEXT PRIMARY KEY NOT NULL,
       log_date     TEXT NOT NULL,
       amount_ml    INTEGER NOT NULL,
       logged_at    INTEGER NOT NULL,
       created_at   INTEGER NOT NULL,
       updated_at   INTEGER NOT NULL,
       deleted_at   INTEGER,
       CHECK (amount_ml > 0),
       CHECK (log_date LIKE '____-__-__')
     );`,

    `CREATE INDEX idx_water_logs_date ON water_logs (log_date DESC, deleted_at);`,

    `CREATE TABLE foods (
       id             TEXT PRIMARY KEY NOT NULL,
       name           TEXT NOT NULL,
       serving_grams  INTEGER NOT NULL DEFAULT 100,
       calories       INTEGER NOT NULL DEFAULT 0,
       protein_g_x10  INTEGER NOT NULL DEFAULT 0,
       carbs_g_x10    INTEGER NOT NULL DEFAULT 0,
       fat_g_x10      INTEGER NOT NULL DEFAULT 0,
       fiber_g_x10    INTEGER NOT NULL DEFAULT 0,
       is_custom      INTEGER NOT NULL DEFAULT 1,
       created_at     INTEGER NOT NULL,
       updated_at     INTEGER NOT NULL,
       deleted_at     INTEGER,
       CHECK (serving_grams > 0),
       CHECK (calories >= 0),
       CHECK (protein_g_x10 >= 0 AND carbs_g_x10 >= 0 AND fat_g_x10 >= 0 AND fiber_g_x10 >= 0),
       CHECK (is_custom IN (0, 1))
     );`,

    `CREATE UNIQUE INDEX idx_foods_name_custom ON foods (name) WHERE is_custom = 1 AND deleted_at IS NULL;`,

    `CREATE TABLE nutrition_entries (
       id             TEXT PRIMARY KEY NOT NULL,
       food_id        TEXT,
       name           TEXT NOT NULL,
       meal           TEXT NOT NULL DEFAULT 'snack',
       eaten_at       INTEGER NOT NULL,
       servings_x100  INTEGER NOT NULL DEFAULT 100,
       calories       INTEGER NOT NULL DEFAULT 0,
       protein_g_x10  INTEGER NOT NULL DEFAULT 0,
       carbs_g_x10    INTEGER NOT NULL DEFAULT 0,
       fat_g_x10      INTEGER NOT NULL DEFAULT 0,
       fiber_g_x10    INTEGER NOT NULL DEFAULT 0,
       created_at     INTEGER NOT NULL,
       updated_at     INTEGER NOT NULL,
       deleted_at     INTEGER,
       CHECK (meal IN ('breakfast', 'lunch', 'dinner', 'snack')),
       CHECK (servings_x100 > 0),
       CHECK (calories >= 0),
       FOREIGN KEY (food_id) REFERENCES foods (id) ON DELETE SET NULL
     );`,

    `CREATE INDEX idx_nutrition_eaten ON nutrition_entries (eaten_at DESC, deleted_at);`,

    `CREATE TABLE sleep_logs (
       id            TEXT PRIMARY KEY NOT NULL,
       sleep_date    TEXT NOT NULL,
       bedtime       INTEGER NOT NULL,
       wake_time     INTEGER NOT NULL,
       duration_min  INTEGER NOT NULL,
       quality       INTEGER,
       notes         TEXT,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       deleted_at    INTEGER,
       CHECK (sleep_date LIKE '____-__-__'),
       CHECK (wake_time >= bedtime),
       CHECK (duration_min > 0),
       CHECK (quality IS NULL OR (quality >= 1 AND quality <= 10))
     );`,

    `CREATE INDEX idx_sleep_date ON sleep_logs (sleep_date DESC, deleted_at);`,
  ],
};
