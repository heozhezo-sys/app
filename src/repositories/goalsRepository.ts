/**
 * Goal, milestone and task persistence.
 *
 * Repositories own SQL and row mapping; they contain no business rules. Transition
 * legality is enforced upstream by `services/stateTransitions`.
 *
 * Progress is *derived*: when a goal has milestones, `progress_pct` is recomputed from
 * how many are completed. A manually-set percentage is only kept for goals with no
 * milestones. The column is therefore always a cache of a rule, never an independent
 * fact that can drift.
 */

import type { SqlDriver, SqlValue } from '@/database/driver';
import { getDatabase, notify, CHANNELS } from '@/database/database';
import { createId } from '@/utils/id';
import type {
  Goal,
  GoalCategory,
  GoalStatus,
  GoalSummary,
  Milestone,
  MilestoneStatus,
  Task,
  TaskPriority,
  TaskStatus,
} from '@/types/goals';

interface GoalRow {
  id: string;
  title: string;
  description: string | null;
  category: GoalCategory | null;
  color_index: number;
  status: GoalStatus;
  progress_pct: number;
  target_date: string | null;
  started_at: number;
  completed_at: number | null;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
}

interface MilestoneRow {
  id: string;
  goal_id: string;
  title: string;
  status: MilestoneStatus;
  due_date: string | null;
  completed_at: number | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  goal_id: string | null;
  milestone_id: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  planned_date: string | null;
  due_date: string | null;
  completed_at: number | null;
  estimate_min: number | null;
  sort_order: number;
  /** Added by migration 014. Absent on rows read from a pre-014 snapshot. */
  recurring_from_task_id?: string | null;
  created_at: number;
  updated_at: number;
}

function toGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    colorIndex: row.color_index,
    status: row.status,
    progressPct: row.progress_pct,
    targetDate: row.target_date,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMilestone(row: MilestoneRow): Milestone {
  return {
    id: row.id,
    goalId: row.goal_id,
    title: row.title,
    status: row.status,
    dueDate: row.due_date,
    completedAt: row.completed_at,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    goalId: row.goal_id,
    milestoneId: row.milestone_id,
    priority: row.priority,
    status: row.status,
    plannedDate: row.planned_date,
    dueDate: row.due_date,
    completedAt: row.completed_at,
    estimateMin: row.estimate_min,
    sortOrder: row.sort_order,
    recurringFromTaskId: row.recurring_from_task_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function driver(): Promise<SqlDriver> {
  return (await getDatabase()).driver;
}

function announce(includeGoals: boolean): void {
  if (includeGoals) {
    notify(CHANNELS.goals);
    notify(CHANNELS.today);
  }
  notify(CHANNELS.tasks);
  notify(CHANNELS.today);
}

/* ---------------------------------------------------------------- goals */

export interface GoalListFilter {
  includeArchived?: boolean;
  statuses?: readonly GoalStatus[];
}

/**
 * Goals with milestone and task counts, in one round trip.
 *
 * The counts are correlated subqueries rather than separate queries so the list cannot
 * render a half-consistent snapshot where a goal shows but its counts do not.
 */
export async function listGoals(filter: GoalListFilter = {}): Promise<GoalSummary[]> {
  const db = await driver();
  const statuses = filter.statuses ?? null;

  const rows = await db.all<
    GoalRow & {
      total_milestones: number;
      completed_milestones: number;
      total_tasks: number;
      completed_tasks: number;
    }
  >(
    `SELECT g.*,
            (SELECT COUNT(*) FROM milestones m
              WHERE m.goal_id = g.id AND m.deleted_at IS NULL) AS total_milestones,
            (SELECT COUNT(*) FROM milestones m
              WHERE m.goal_id = g.id AND m.deleted_at IS NULL AND m.status = 'completed')
              AS completed_milestones,
            (SELECT COUNT(*) FROM tasks t
              WHERE t.goal_id = g.id AND t.deleted_at IS NULL) AS total_tasks,
            (SELECT COUNT(*) FROM tasks t
              WHERE t.goal_id = g.id AND t.deleted_at IS NULL AND t.status = 'done')
              AS completed_tasks
       FROM goals g
      WHERE g.deleted_at IS NULL
        AND (? = 1 OR g.status != 'archived')
        AND (? IS NULL OR g.status IN (SELECT value FROM json_each(?)))
      ORDER BY g.created_at DESC;`,
    [
      filter.includeArchived ? 1 : 0,
      statuses ? statuses.length : null,
      statuses ? JSON.stringify(statuses) : null,
    ],
  );

  return rows.map((row) => ({
    ...toGoal(row),
    totalMilestones: row.total_milestones,
    completedMilestones: row.completed_milestones,
    totalTasks: row.total_tasks,
    completedTasks: row.completed_tasks,
  }));
}

export async function getGoal(id: string): Promise<Goal | null> {
  const db = await driver();
  const row = await db.first<GoalRow>('SELECT * FROM goals WHERE id = ? AND deleted_at IS NULL;', [
    id,
  ]);
  return row ? toGoal(row) : null;
}

export interface GoalInsert {
  title: string;
  description: string | null;
  category: GoalCategory | null;
  colorIndex: number;
  targetDate: string | null;
}

export async function insertGoal(input: GoalInsert): Promise<Goal> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO goals
       (id, title, description, category, color_index, status, progress_pct,
        target_date, started_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, ?);`,
    [id, input.title, input.description, input.category, input.colorIndex, input.targetDate, now, now, now],
  );

  announce(true);
  const created = await getGoal(id);
  if (!created) throw new Error(`Goal ${id} vanished immediately after insert`);
  return created;
}

export interface GoalPatch {
  title?: string;
  description?: string | null;
  category?: GoalCategory | null;
  colorIndex?: number;
  targetDate?: string | null;
  status?: GoalStatus;
  progressPct?: number;
  completedAt?: number | null;
  archivedAt?: number | null;
}

export async function updateGoal(id: string, patch: GoalPatch): Promise<Goal | null> {
  const db = await driver();
  const columns: string[] = [];
  const params: SqlValue[] = [];
  const set = (column: string, value: SqlValue): void => {
    columns.push(`${column} = ?`);
    params.push(value);
  };

  if (patch.title !== undefined) set('title', patch.title);
  if (patch.description !== undefined) set('description', patch.description);
  if (patch.category !== undefined) set('category', patch.category);
  if (patch.colorIndex !== undefined) set('color_index', patch.colorIndex);
  if (patch.targetDate !== undefined) set('target_date', patch.targetDate);
  if (patch.status !== undefined) set('status', patch.status);
  if (patch.progressPct !== undefined) set('progress_pct', patch.progressPct);
  if (patch.completedAt !== undefined) set('completed_at', patch.completedAt);
  if (patch.archivedAt !== undefined) set('archived_at', patch.archivedAt);

  if (columns.length === 0) return getGoal(id);

  set('updated_at', Date.now());
  params.push(id);

  await db.run(`UPDATE goals SET ${columns.join(', ')} WHERE id = ? AND deleted_at IS NULL;`, params);
  announce(true);
  return getGoal(id);
}

export async function softDeleteGoal(id: string): Promise<void> {
  const db = await driver();
  const now = Date.now();
  await db.run(
    'UPDATE goals SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL;',
    [now, now, id],
  );
  announce(true);
}
/**
 * Recomputes `progress_pct` from milestones.
 *
 * Called after every milestone change, so the cached column can never disagree with
 * the rows it summarises. Goals with no milestones are left alone: there is nothing to
 * derive from, and a manually-set percentage stays meaningful.
 */
export async function recomputeGoalProgress(goalId: string): Promise<number> {
  const db = await driver();
  const row = await db.first<{ total: number; done: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS done
       FROM milestones
      WHERE goal_id = ? AND deleted_at IS NULL;`,
    [goalId],
  );

  const total = row?.total ?? 0;
  if (total === 0) return 0;

  const pct = Math.round(((row?.done ?? 0) / total) * 100);
  await db.run('UPDATE goals SET progress_pct = ?, updated_at = ? WHERE id = ?;', [
    pct,
    Date.now(),
    goalId,
  ]);
  return pct;
}

/* ------------------------------------------------------------ milestones */

export async function listMilestones(goalId: string): Promise<Milestone[]> {
  const db = await driver();
  const rows = await db.all<MilestoneRow>(
    `SELECT * FROM milestones
      WHERE goal_id = ? AND deleted_at IS NULL
      ORDER BY sort_order ASC, created_at ASC;`,
    [goalId],
  );
  return rows.map(toMilestone);
}

export async function getMilestone(id: string): Promise<Milestone | null> {
  const db = await driver();
  const row = await db.first<MilestoneRow>(
    'SELECT * FROM milestones WHERE id = ? AND deleted_at IS NULL;',
    [id],
  );
  return row ? toMilestone(row) : null;
}

export async function insertMilestone(input: {
  goalId: string;
  title: string;
  dueDate: string | null;
}): Promise<Milestone> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  const orderRow = await db.first<{ next: number }>(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM milestones WHERE goal_id = ?;',
    [input.goalId],
  );

  await db.run(
    `INSERT INTO milestones (id, goal_id, title, status, due_date, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, ?);`,
    [id, input.goalId, input.title, input.dueDate, orderRow?.next ?? 0, now, now],
  );

  await recomputeGoalProgress(input.goalId);
  announce(true);

  const created = await db.first<MilestoneRow>('SELECT * FROM milestones WHERE id = ?;', [id]);
  if (!created) throw new Error(`Milestone ${id} vanished immediately after insert`);
  return toMilestone(created);
}

export async function updateMilestone(
  id: string,
  patch: Partial<{
    title: string;
    status: MilestoneStatus;
    dueDate: string | null;
    completedAt: number | null;
    sortOrder: number;
  }>,
): Promise<Milestone | null> {
  const db = await driver();
  const columns: string[] = [];
  const params: SqlValue[] = [];
  const set = (column: string, value: SqlValue): void => {
    columns.push(`${column} = ?`);
    params.push(value);
  };

  if (patch.title !== undefined) set('title', patch.title);
  if (patch.status !== undefined) set('status', patch.status);
  if (patch.dueDate !== undefined) set('due_date', patch.dueDate);
  if (patch.completedAt !== undefined) set('completed_at', patch.completedAt);
  if (patch.sortOrder !== undefined) set('sort_order', patch.sortOrder);

  if (columns.length === 0) return null;

  set('updated_at', Date.now());
  params.push(id);

  await db.run(`UPDATE milestones SET ${columns.join(', ')} WHERE id = ? AND deleted_at IS NULL;`, params);

  const row = await db.first<MilestoneRow>('SELECT * FROM milestones WHERE id = ?;', [id]);
  if (row) await recomputeGoalProgress(row.goal_id);
  announce(true);
  return row ? toMilestone(row) : null;
}

export async function softDeleteMilestone(id: string): Promise<void> {
  const db = await driver();
  const now = Date.now();
  const row = await db.first<MilestoneRow>('SELECT goal_id FROM milestones WHERE id = ?;', [id]);
  await db.run(
    'UPDATE milestones SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL;',
    [now, now, id],
  );
  if (row) await recomputeGoalProgress(row.goal_id);
  announce(true);
}


/* ----------------------------------------------------------------- tasks */

export interface TaskListFilter {
  goalId?: string;
  milestoneId?: string;
  statuses?: readonly TaskStatus[];
  /** Restrict to tasks planned for one local day. */
  plannedDate?: string;
  /** Open tasks planned for a day earlier than `plannedDate`. */
  overdueOnly?: boolean;
  limit?: number;
}

/**
 * Tasks matching a filter.
 *
 * `overdueOnly` reuses `plannedDate` as the *reference* day rather than an equality
 * match. That distinction matters: a naive combination of "planned_date = today" and
 * "planned_date < today" is unsatisfiable, and the list would silently come back empty.
 * When `overdueOnly` is set the equality clause is skipped entirely.
 */
export async function listTasks(filter: TaskListFilter = {}): Promise<Task[]> {
  const db = await driver();
  const statuses = filter.statuses ?? null;
  const overdue = filter.overdueOnly ? 1 : 0;
  const date = filter.plannedDate ?? null;

  const rows = await db.all<TaskRow>(
    `SELECT * FROM tasks
      WHERE deleted_at IS NULL
        AND (? IS NULL OR goal_id = ?)
        AND (? IS NULL OR milestone_id = ?)
        AND (? IS NULL OR status IN (SELECT value FROM json_each(?)))
        AND (? = 1 OR ? IS NULL OR planned_date = ?)
        AND (? = 0 OR (status != 'done' AND planned_date IS NOT NULL AND planned_date < ?))
      ORDER BY
        CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        planned_date IS NULL, planned_date ASC,
        sort_order ASC, created_at ASC
      LIMIT ?;`,
    [
      filter.goalId ?? null,
      filter.goalId ?? null,
      filter.milestoneId ?? null,
      filter.milestoneId ?? null,
      statuses ? statuses.length : null,
      statuses ? JSON.stringify(statuses) : null,
      overdue,
      date,
      date,
      overdue,
      date,
      // A hard cap so a pathological dataset cannot lock up the UI thread.
      filter.limit ?? 200,
    ],
  );

  return rows.map(toTask);
}

export async function getTask(id: string): Promise<Task | null> {
  const db = await driver();
  const row = await db.first<TaskRow>('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL;', [
    id,
  ]);
  return row ? toTask(row) : null;
}

export interface TaskInsert {
  title: string;
  notes: string | null;
  goalId: string | null;
  milestoneId: string | null;
  priority: TaskPriority;
  plannedDate: string | null;
  dueDate: string | null;
  estimateMin: number | null;
  /** Set by the recurrence service when materialising an occurrence of a rule. */
  recurringFromTaskId?: string | null;
}

export async function insertTask(input: TaskInsert): Promise<Task> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  const orderRow = await db.first<{ next: number }>(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM tasks WHERE planned_date IS ?;',
    [input.plannedDate],
  );

  await db.run(
    `INSERT INTO tasks
       (id, title, notes, goal_id, milestone_id, priority, status, planned_date,
        due_date, estimate_min, sort_order, recurring_from_task_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.title,
      input.notes,
      input.goalId,
      input.milestoneId,
      input.priority,
      input.plannedDate,
      input.dueDate,
      input.estimateMin,
      orderRow?.next ?? 0,
      input.recurringFromTaskId ?? null,
      now,
      now,
    ],
  );

  announce(input.goalId !== null);
  const created = await getTask(id);
  if (!created) throw new Error(`Task ${id} vanished immediately after insert`);
  return created;
}

/**
 * Finds the occurrence of a repeat rule planned for a day.
 *
 * The dedicated lookup exists because the alternative — scanning every task planned for
 * the day and matching on title — is both slower and wrong: two rules can legitimately
 * share a title, and a title edit would silently orphan every past occurrence.
 */
export async function findOccurrence(
  recurringFromTaskId: string,
  plannedDate: string,
): Promise<Task | null> {
  const db = await driver();
  const row = await db.first<TaskRow>(
    `SELECT * FROM tasks
      WHERE recurring_from_task_id = ? AND planned_date = ? AND deleted_at IS NULL
      LIMIT 1;`,
    [recurringFromTaskId, plannedDate],
  );
  return row ? toTask(row) : null;
}

export interface TaskPatch {
  title?: string;
  notes?: string | null;
  goalId?: string | null;
  milestoneId?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  plannedDate?: string | null;
  dueDate?: string | null;
  completedAt?: number | null;
  estimateMin?: number | null;
  sortOrder?: number;
}

export async function updateTask(id: string, patch: TaskPatch): Promise<Task | null> {
  const db = await driver();
  const columns: string[] = [];
  const params: SqlValue[] = [];
  const set = (column: string, value: SqlValue): void => {
    columns.push(`${column} = ?`);
    params.push(value);
  };

  if (patch.title !== undefined) set('title', patch.title);
  if (patch.notes !== undefined) set('notes', patch.notes);
  if (patch.goalId !== undefined) set('goal_id', patch.goalId);
  if (patch.milestoneId !== undefined) set('milestone_id', patch.milestoneId);
  if (patch.priority !== undefined) set('priority', patch.priority);
  if (patch.status !== undefined) set('status', patch.status);
  if (patch.plannedDate !== undefined) set('planned_date', patch.plannedDate);
  if (patch.dueDate !== undefined) set('due_date', patch.dueDate);
  if (patch.completedAt !== undefined) set('completed_at', patch.completedAt);
  if (patch.estimateMin !== undefined) set('estimate_min', patch.estimateMin);
  if (patch.sortOrder !== undefined) set('sort_order', patch.sortOrder);

  if (columns.length === 0) return getTask(id);

  set('updated_at', Date.now());
  params.push(id);

  await db.run(`UPDATE tasks SET ${columns.join(', ')} WHERE id = ? AND deleted_at IS NULL;`, params);

  const row = await getTask(id);
  announce(row?.goalId !== null && row?.goalId !== undefined);
  return row;
}

export async function softDeleteTask(id: string): Promise<void> {
  const db = await driver();
  const now = Date.now();
  const row = await db.first<{ goal_id: string | null }>('SELECT goal_id FROM tasks WHERE id = ?;', [
    id,
  ]);
  await db.run('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL;', [
    now,
    now,
    id,
  ]);
  announce(row?.goal_id !== null && row?.goal_id !== undefined);
}

