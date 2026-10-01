import type { Migration } from './types';

/**
 * 006 — Productivity: focus sessions, custom timers and reviews.
 *
 * A focus session stores a wall-clock deadline (`ends_at`), never a remaining-tick
 * count. If the OS suspends the app, the phone sleeps, or the process is killed, the
 * elapsed time is still correct because it is recomputed from the clock. This is the
 * difference between a timer that survives termination and one that silently resets.
 */
export const migration006: Migration = {
  version: 6,
  name: 'productivity',
  statements: [
    `CREATE TABLE focus_sessions (
       id            TEXT PRIMARY KEY NOT NULL,
       kind          TEXT NOT NULL DEFAULT 'pomodoro',
       label         TEXT,
       intent        TEXT,
       status        TEXT NOT NULL DEFAULT 'active',
       planned_min   INTEGER NOT NULL,
       break_min     INTEGER NOT NULL DEFAULT 5,
       cycle_index   INTEGER NOT NULL DEFAULT 1,
       started_at    INTEGER NOT NULL,
       ends_at       INTEGER NOT NULL,
       completed_at  INTEGER,
       actual_sec    INTEGER,
       task_id       TEXT,
       goal_id       TEXT,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       deleted_at    INTEGER,
       CHECK (kind IN ('pomodoro', 'short_focus', 'long_focus', 'custom')),
       CHECK (status IN ('active', 'completed', 'abandoned')),
       CHECK (planned_min > 0),
       CHECK (break_min >= 0),
       CHECK (cycle_index >= 1),
       CHECK (ends_at >= started_at),
       -- A completed session must record when it finished and for how long.
       CHECK (status != 'completed' OR (completed_at IS NOT NULL AND actual_sec IS NOT NULL))
     );`,

    // At most one focus timer may be active; this index makes a second one impossible.
    `CREATE UNIQUE INDEX idx_focus_single_active ON focus_sessions (status) WHERE status = 'active' AND deleted_at IS NULL;`,
    `CREATE INDEX idx_focus_sessions_started ON focus_sessions (started_at DESC);`,
    `CREATE INDEX idx_focus_sessions_task ON focus_sessions (task_id);`,

    `CREATE TABLE reviews (
       id            TEXT PRIMARY KEY NOT NULL,
       period_type   TEXT NOT NULL,
       period_key    TEXT NOT NULL,
       body          TEXT NOT NULL,
       wins          TEXT,
       challenges    TEXT,
       next_actions  TEXT,
       mood_score    INTEGER,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       deleted_at    INTEGER,
       CHECK (period_type IN ('daily', 'weekly', 'monthly', 'yearly')),
       CHECK (mood_score IS NULL OR (mood_score >= 1 AND mood_score <= 10))
     );`,

    `CREATE UNIQUE INDEX idx_reviews_period ON reviews (period_type, period_key) WHERE deleted_at IS NULL;`,
  ],
};
