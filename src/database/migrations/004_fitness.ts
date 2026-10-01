import type { Migration } from './types';

/**
 * 004 — Fitness.
 *
 * One activity model serves gym, home workouts and sports rather than three
 * parallel systems:
 *
 *  - `exercises`   catalog (seeded defaults + user custom entries)
 *  - `workouts`    a session header; `status` models an interrupted workout, which is
 *                  recoverable instead of being lost when the app is killed mid-set
 *  - `workout_sets` the historical rows every statistic derives from
 *  - `sport_sessions` the same idea for timed sports, with a per-sport metric schema
 *  - `body_metrics` bodyweight and body composition over time
 *
 * Weights are stored as INTEGER grams and RPE as an integer scaled by 10. Floating
 * point is never used for measured quantities, so `0.1 + 0.2` problems cannot reach a
 * user's history or a personal record.
 */
export const migration004: Migration = {
  version: 4,
  name: 'fitness',
  statements: [
    `CREATE TABLE exercises (
       id            TEXT PRIMARY KEY NOT NULL,
       name          TEXT NOT NULL,
       muscle_group  TEXT,
       equipment     TEXT,
       is_custom     INTEGER NOT NULL DEFAULT 0,
       is_archived   INTEGER NOT NULL DEFAULT 0,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       deleted_at    INTEGER,
       CHECK (is_custom IN (0, 1)),
       CHECK (is_archived IN (0, 1))
     );`,

    `CREATE UNIQUE INDEX idx_exercises_name_custom ON exercises (name) WHERE is_custom = 1;`,
    `CREATE INDEX idx_exercises_muscle ON exercises (muscle_group);`,

    `CREATE TABLE workouts (
       id            TEXT PRIMARY KEY NOT NULL,
       title         TEXT NOT NULL,
       activity_type TEXT NOT NULL DEFAULT 'gym',
       template_id   TEXT,
       status        TEXT NOT NULL DEFAULT 'in_progress',
       started_at    INTEGER NOT NULL,
       ended_at      INTEGER,
       notes         TEXT,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       deleted_at    INTEGER,
       CHECK (activity_type IN ('gym', 'home', 'mobility', 'stretching', 'cross_training')),
       -- status must agree with the presence of ended_at, so analytics never has to guess
       CHECK (status != 'completed' OR ended_at IS NOT NULL),
       CHECK (ended_at IS NULL OR ended_at >= started_at)
     );`,

    `CREATE INDEX idx_workouts_started ON workouts (started_at DESC);`,
    `CREATE INDEX idx_workouts_status ON workouts (status);`,

    `CREATE TABLE workout_sets (
       id            TEXT PRIMARY KEY NOT NULL,
       workout_id    TEXT NOT NULL,
       exercise_id   TEXT NOT NULL,
       set_number    INTEGER NOT NULL,
       set_type      TEXT NOT NULL DEFAULT 'working',
       reps          INTEGER,
       weight_grams  INTEGER,
       duration_sec  INTEGER,
       rpe_x10       INTEGER,
       is_completed  INTEGER NOT NULL DEFAULT 1,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       CHECK (set_type IN ('warmup', 'working', 'drop')),
       CHECK (set_number >= 1),
       CHECK (reps IS NULL OR reps >= 0),
       CHECK (weight_grams IS NULL OR weight_grams >= 0),
       CHECK (duration_sec IS NULL OR duration_sec >= 0),
       -- RPE 1..10 stored scaled by 10 so it stays an integer
       CHECK (rpe_x10 IS NULL OR (rpe_x10 >= 10 AND rpe_x10 <= 100)),
       CHECK (is_completed IN (0, 1)),
       CHECK (weight_grams IS NOT NULL OR reps IS NOT NULL OR duration_sec IS NOT NULL),
       FOREIGN KEY (workout_id) REFERENCES workouts (id) ON DELETE CASCADE,
       FOREIGN KEY (exercise_id) REFERENCES exercises (id) ON DELETE RESTRICT
     );`,

    `CREATE INDEX idx_workout_sets_workout ON workout_sets (workout_id, exercise_id, set_number);`,
    `CREATE INDEX idx_workout_sets_exercise ON workout_sets (exercise_id);`,

    `CREATE TABLE body_metrics (
       id            TEXT PRIMARY KEY NOT NULL,
       measured_at   INTEGER NOT NULL,
       weight_grams  INTEGER,
       body_fat_x10  INTEGER,
       note          TEXT,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       deleted_at    INTEGER,
       CHECK (weight_grams IS NULL OR weight_grams >= 0),
       CHECK (body_fat_x10 IS NULL OR (body_fat_x10 >= 0 AND body_fat_x10 <= 1000))
     );`,

    `CREATE UNIQUE INDEX idx_body_metrics_measured ON body_metrics (measured_at) WHERE deleted_at IS NULL;`,
    `CREATE INDEX idx_body_metrics_recent ON body_metrics (measured_at DESC);`,

    `CREATE TABLE sports (
       id            TEXT PRIMARY KEY NOT NULL,
       name          TEXT NOT NULL,
       category      TEXT NOT NULL,
       metric_schema TEXT,
       is_custom     INTEGER NOT NULL DEFAULT 0,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       deleted_at    INTEGER,
       CHECK (is_custom IN (0, 1))
     );`,

    `CREATE UNIQUE INDEX idx_sports_name ON sports (name) WHERE is_custom = 1;`,

    `CREATE TABLE sport_sessions (
       id            TEXT PRIMARY KEY NOT NULL,
       sport_id      TEXT NOT NULL,
       started_at    INTEGER NOT NULL,
       ended_at      INTEGER,
       duration_sec  INTEGER,
       intensity     TEXT,
       metrics       TEXT,
       notes         TEXT,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       deleted_at    INTEGER,
       CHECK (intensity IS NULL OR intensity IN ('easy', 'moderate', 'hard', 'max')),
       CHECK (ended_at IS NULL OR ended_at >= started_at),
       FOREIGN KEY (sport_id) REFERENCES sports (id) ON DELETE RESTRICT
     );`,

    `CREATE INDEX idx_sport_sessions_sport ON sport_sessions (sport_id, started_at DESC);`,
    `CREATE INDEX idx_sport_sessions_started ON sport_sessions (started_at DESC);`,
  ],
};
