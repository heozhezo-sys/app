import type { Migration } from './types';

/**
 * 003 — Goals, milestones and tasks.
 *
 * Goal status transitions are validated in the service layer *and* constrained here.
 * A CHECK on the status column means an impossible state cannot exist on disk even if
 * a future caller bypasses the service.
 *
 * `completed_at` is stamped by the service so the completion date is a historical fact
 * rather than something re-derivable and therefore arguable.
 */
export const migration003: Migration = {
  version: 3,
  name: 'goals',
  statements: [
    `CREATE TABLE goals (
       id            TEXT PRIMARY KEY NOT NULL,
       title         TEXT NOT NULL,
       description   TEXT,
       category      TEXT,
       color_index   INTEGER NOT NULL DEFAULT 0,
       status        TEXT NOT NULL DEFAULT 'active',
       progress_pct  INTEGER NOT NULL DEFAULT 0,
       target_date   TEXT,
       started_at    INTEGER NOT NULL,
       completed_at  INTEGER,
       archived_at   INTEGER,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       deleted_at    INTEGER,
       CHECK (status IN ('active', 'paused', 'completed', 'cancelled', 'archived')),
       CHECK (progress_pct >= 0 AND progress_pct <= 100)
     );`,

    `CREATE INDEX idx_goals_status ON goals (status, deleted_at);`,
    `CREATE INDEX idx_goals_target_date ON goals (target_date);`,

    `CREATE TABLE milestones (
       id           TEXT PRIMARY KEY NOT NULL,
       goal_id      TEXT NOT NULL,
       title        TEXT NOT NULL,
       status       TEXT NOT NULL DEFAULT 'pending',
       due_date     TEXT,
       completed_at INTEGER,
       sort_order   INTEGER NOT NULL DEFAULT 0,
       created_at   INTEGER NOT NULL,
       updated_at   INTEGER NOT NULL,
       deleted_at   INTEGER,
       CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
       FOREIGN KEY (goal_id) REFERENCES goals (id) ON DELETE CASCADE
     );`,

    `CREATE INDEX idx_milestones_goal ON milestones (goal_id, sort_order);`,

    `CREATE TABLE tasks (
       id            TEXT PRIMARY KEY NOT NULL,
       title         TEXT NOT NULL,
       notes         TEXT,
       goal_id       TEXT,
       milestone_id  TEXT,
       priority      TEXT NOT NULL DEFAULT 'medium',
       status        TEXT NOT NULL DEFAULT 'todo',
       planned_date  TEXT,
       due_date      TEXT,
       completed_at  INTEGER,
       estimate_min  INTEGER,
       sort_order    INTEGER NOT NULL DEFAULT 0,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       deleted_at    INTEGER,
       CHECK (priority IN ('low', 'medium', 'high')),
       CHECK (status IN ('todo', 'in_progress', 'done', 'archived')),
       CHECK (estimate_min IS NULL OR estimate_min >= 0),
       -- A task cannot be marked done without recording when it was done.
       CHECK (status != 'done' OR completed_at IS NOT NULL),
       FOREIGN KEY (goal_id) REFERENCES goals (id) ON DELETE SET NULL,
       FOREIGN KEY (milestone_id) REFERENCES milestones (id) ON DELETE SET NULL
     );`,

    `CREATE INDEX idx_tasks_status_date ON tasks (status, planned_date, sort_order);`,
    `CREATE INDEX idx_tasks_goal ON tasks (goal_id);`,
    `CREATE INDEX idx_tasks_due ON tasks (due_date);`,
  ],
};
