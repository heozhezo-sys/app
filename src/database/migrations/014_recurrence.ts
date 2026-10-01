import type { Migration } from './types';

/**
 * 014 — Recurrence.
 *
 * `FEATURES/PRODUCTIVITY.md` requires recurring tasks and `FEATURES/FINANCE.md` implies
 * scheduled money. Neither `tasks` (003) nor `finance_transactions` (009) has anywhere to
 * record a repeat rule, so this adds the two rule tables and the bookkeeping they need.
 *
 * Design note — why a rule is a separate table rather than columns on `tasks`:
 *
 * A rule must outlive the individual occurrences it generates, and editing a rule must
 * change *future* occurrences without rewriting history. Keeping the rule in its own row
 * means "delete this task" (soft delete of one occurrence) and "stop repeating this"
 * (deleting the rule) are two different, separately auditable acts.
 *
 * `start_date` is stored as a local-calendar `YYYY-MM-DD` key, never a timestamp,
 * because recurrence is a calendar concept: "every Monday" means the same thing in every
 * timezone. An instant would drift a day either side of midnight.
 *
 * `interval_count > 1` gives weekly/monthly/yearly rules "every 3 weeks", "every 2 months"
 * without needing a separate vocabulary per unit.
 */
export const migration014: Migration = {
  version: 14,
  name: 'recurrence',
  statements: [
    // An occurrence points back at the task that defines the rule.
    //
    // Without this, "has today's occurrence already been created?" needs a query across
    // every task planned for that day matching on title, which is both slow and wrong (two
    // rules can legitimately share a title). With it the check is one indexed lookup, and
    // "delete every occurrence of this rule" becomes possible at all.
    //
    // `SET NULL` on delete because deleting the source task must not cascade away history:
    // the occurrences are real tasks the user may have completed.
    `ALTER TABLE tasks ADD COLUMN recurring_from_task_id TEXT;`,

    `CREATE INDEX idx_tasks_recurring ON tasks (recurring_from_task_id, planned_date)
       WHERE recurring_from_task_id IS NOT NULL;`,

    // Repeating task rules. Occurrences are real rows in `tasks`, created lazily for the
    // days a user actually visits, so a 10-year daily rule never materialises 3650 rows.
    `CREATE TABLE task_recurrence (
       id             TEXT PRIMARY KEY NOT NULL,
       task_id        TEXT NOT NULL,
       frequency      TEXT NOT NULL,
       interval_count INTEGER NOT NULL DEFAULT 1,
       weekdays       TEXT,
       month_day      INTEGER,
       start_date     TEXT NOT NULL,
       end_date       TEXT,
       until_occurrence INTEGER,
       created_at     INTEGER NOT NULL,
       updated_at     INTEGER NOT NULL,
       deleted_at     INTEGER,
       CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
       CHECK (interval_count > 0),
       CHECK (start_date LIKE '____-__-__'),
       CHECK (end_date IS NULL OR end_date LIKE '____-__-__'),
       -- Weekly rules store the days as a compact JSON array of 0..6, which keeps the
       -- schema free of a join table for what is at most seven small integers.
       CHECK (weekdays IS NULL OR (frequency = 'weekly' AND length(weekdays) > 2)),
       CHECK (month_day IS NULL OR (frequency = 'monthly' AND month_day BETWEEN 1 AND 31)),
       CHECK (until_occurrence IS NULL OR until_occurrence > 0),
       FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
     );`,

    // Partial, so changing a task's schedule can soft-delete the old rule and insert a new
    // one. A plain UNIQUE(task_id) would make that impossible, because the tombstoned row
    // would still occupy the key.
    `CREATE UNIQUE INDEX idx_task_recurrence_task ON task_recurrence (task_id) WHERE deleted_at IS NULL;`,

    `CREATE INDEX idx_task_recurrence_start ON task_recurrence (start_date);`,

    // Recurring money. A rule materialises a real `finance_transactions` row, because a
    // scheduled payment that is only "computed" cannot be edited, categorised or
    // disputed by the user once it lands.
    `CREATE TABLE recurring_transactions (
       id             TEXT PRIMARY KEY NOT NULL,
       account_id     TEXT NOT NULL,
       category_id    TEXT,
       kind           TEXT NOT NULL,
       amount_minor   INTEGER NOT NULL,
       currency       TEXT NOT NULL DEFAULT 'USD',
       frequency      TEXT NOT NULL,
       interval_count INTEGER NOT NULL DEFAULT 1,
       month_day      INTEGER,
       weekdays       TEXT,
       start_date     TEXT NOT NULL,
       end_date       TEXT,
       payee          TEXT,
       note           TEXT,
       last_posted_date TEXT,
       created_at     INTEGER NOT NULL,
       updated_at     INTEGER NOT NULL,
       deleted_at     INTEGER,
       CHECK (kind IN ('income', 'expense')),
       CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
       CHECK (interval_count > 0),
       CHECK (amount_minor > 0),
       CHECK (length(currency) = 3),
       CHECK (category_id IS NOT NULL),
       CHECK (start_date LIKE '____-__-__'),
       CHECK (end_date IS NULL OR end_date LIKE '____-__-__'),
       CHECK (last_posted_date IS NULL OR last_posted_date LIKE '____-__-__'),
       CHECK (month_day IS NULL OR (frequency = 'monthly' AND month_day BETWEEN 1 AND 31)),
       FOREIGN KEY (account_id) REFERENCES finance_accounts (id) ON DELETE CASCADE,
       FOREIGN KEY (category_id) REFERENCES finance_categories (id) ON DELETE RESTRICT
     );`,

    `CREATE INDEX idx_recurring_account ON recurring_transactions (account_id, deleted_at);`,
    `CREATE INDEX idx_recurring_next ON recurring_transactions (last_posted_date, deleted_at);`,
  ],
};
