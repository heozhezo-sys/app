import type { Migration } from './types';

/**
 * 010 — Achievements and personal records.
 *
 * `achievement_unlocks` is append-only and uniquely constrained per achievement, so a
 * duplicate unlock is impossible even if the evaluator runs twice.
 *
 * `personal_records` records the best observed value and when it happened. It is a
 * derived convenience view over workout_sets, not the source of truth — dropping it
 * and rebuilding changes no statistic.
 */
export const migration010: Migration = {
  version: 10,
  name: 'achievements',
  statements: [
    `CREATE TABLE achievements (
       id            TEXT PRIMARY KEY NOT NULL,
       code          TEXT NOT NULL,
       title         TEXT NOT NULL,
       description   TEXT,
       icon          TEXT,
       metric        TEXT NOT NULL,
       threshold     INTEGER NOT NULL,
       is_secret     INTEGER NOT NULL DEFAULT 0,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       CHECK (threshold > 0),
       CHECK (is_secret IN (0, 1))
     );`,

    `CREATE UNIQUE INDEX idx_achievements_code ON achievements (code);`,

    `CREATE TABLE achievement_unlocks (
       id             TEXT PRIMARY KEY NOT NULL,
       achievement_id TEXT NOT NULL,
       unlocked_at    INTEGER NOT NULL,
       progress_at_unlock INTEGER NOT NULL DEFAULT 0,
       FOREIGN KEY (achievement_id) REFERENCES achievements (id) ON DELETE CASCADE
     );`,

    `CREATE UNIQUE INDEX idx_unlocks_unique ON achievement_unlocks (achievement_id);`,
    `CREATE INDEX idx_unlocks_recent ON achievement_unlocks (unlocked_at DESC);`,

    `CREATE TABLE personal_records (
       id           TEXT PRIMARY KEY NOT NULL,
       scope        TEXT NOT NULL,
       subject_id   TEXT,
       metric       TEXT NOT NULL,
       value        INTEGER NOT NULL,
       unit         TEXT NOT NULL,
       achieved_at  INTEGER NOT NULL,
       created_at   INTEGER NOT NULL,
       updated_at   INTEGER NOT NULL,
       UNIQUE (scope, subject_id, metric)
     );`,

    `CREATE INDEX idx_pr_subject ON personal_records (subject_id);`,
  ],
};
