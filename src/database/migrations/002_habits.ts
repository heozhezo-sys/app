import type { Migration } from './types';

/**
 * 002 — Habits.
 *
 * `habits` holds the definition; `habit_logs` holds one row per completion of one
 * habit on one local calendar day. Logs — not a counter — are the source of truth,
 * so a corrupted or deleted counter can always be recomputed from history, and
 * back-filling a missed day changes derived statistics correctly.
 *
 * The UNIQUE (habit_id, log_date) constraint is what makes duplicate completion
 * impossible at the storage layer, not merely in application code.
 */
export const migration002: Migration = {
  version: 2,
  name: 'habits',
  statements: [
    `CREATE TABLE habits (
       id                  TEXT PRIMARY KEY NOT NULL,
       title               TEXT NOT NULL,
       description         TEXT,
       icon                TEXT,
       color_index         INTEGER NOT NULL DEFAULT 0,
       cadence             TEXT NOT NULL DEFAULT 'daily',
       cadence_config      TEXT,
       target_per_period   INTEGER NOT NULL DEFAULT 1,
       reminder_time       TEXT,
       reminder_days       TEXT,
       sort_order          INTEGER NOT NULL DEFAULT 0,
       status              TEXT NOT NULL DEFAULT 'active',
       archived_at         INTEGER,
       created_at          INTEGER NOT NULL,
       updated_at          INTEGER NOT NULL,
       deleted_at          INTEGER,
       CHECK (status IN ('active', 'archived')),
       CHECK (cadence IN ('daily', 'weekly', 'specific_days')),
       CHECK (target_per_period >= 1),
       CHECK (deleted_at IS NULL OR deleted_at >= created_at)
     );`,

    `CREATE INDEX idx_habits_status ON habits (status, sort_order);`,
    `CREATE INDEX idx_habits_live ON habits (deleted_at);`,

    `CREATE TABLE habit_logs (
       id           TEXT PRIMARY KEY NOT NULL,
       habit_id     TEXT NOT NULL,
       log_date     TEXT NOT NULL,
       completed    INTEGER NOT NULL DEFAULT 1,
       count_value  INTEGER NOT NULL DEFAULT 1,
       note         TEXT,
       source       TEXT NOT NULL DEFAULT 'manual',
       created_at   INTEGER NOT NULL,
       updated_at   INTEGER NOT NULL,
       CHECK (completed IN (0, 1)),
       CHECK (count_value >= 1),
       CHECK (log_date LIKE '____-__-__'),
       FOREIGN KEY (habit_id) REFERENCES habits (id) ON DELETE CASCADE
     );`,

    // The integrity guarantee for "taps twice".
    `CREATE UNIQUE INDEX idx_habit_logs_unique ON habit_logs (habit_id, log_date);`,
    // Serves streak and calendar queries without a table scan.
    `CREATE INDEX idx_habit_logs_date ON habit_logs (log_date DESC);`,
    `CREATE INDEX idx_habit_logs_habit_date ON habit_logs (habit_id, log_date DESC);`,
  ],
};
