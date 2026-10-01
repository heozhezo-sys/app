/**
 * Goal, milestone and task use-cases.
 *
 * Business rules live here, not in the repository and not in the UI:
 *  - validation of user input,
 *  - legal status transitions (delegated to `stateTransitions`),
 *  - stamping `completed_at` so completion dates are historical facts,
 *  - keeping derived progress in step with milestone changes.
 */

import * as repo from '@/repositories/goalsRepository';
import {
  assertGoalTransition,
  assertMilestoneTransition,
  assertTaskTransition,
} from './stateTransitions';
import { ValidationError } from './errors';
import { logger } from '@/utils/logger';
import { validateTitle, sanitiseText, validatePositiveInt } from '@/utils/validation';
import { isDateKey, todayKey, type DateKey } from '@/utils/dates';
import type {
  Goal,
  GoalCreateInput,
  GoalStatus,
  GoalSummary,
  GoalUpdateInput,
  Milestone,
  MilestoneCreateInput,
  MilestoneStatus,
  Task,
  TaskCreateInput,
  TaskStatus,
  TaskUpdateInput,
} from '@/types/goals';

function requireTitle(title: string): string {
  const clean = sanitiseText(title ?? '');
  const error = validateTitle(clean);
  if (error) throw new ValidationError({ title: error });
  return clean;
}

function optionalDate(value: string | null | undefined, field: string): string | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  const key = value.trim();
  if (!isDateKey(key)) throw new ValidationError({ [field]: 'Use YYYY-MM-DD' });
  return key;
}

function optionalEstimate(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const error = validatePositiveInt(value, { min: 0, max: 24 * 60 });
  if (error) throw new ValidationError({ estimateMin: error });
  return value;
}

/* ----------------------------------------------------------------- goals */

export async function listGoals(includeArchived = false): Promise<GoalSummary[]> {
  return repo.listGoals({ includeArchived });
}

export async function listOpenGoals(): Promise<GoalSummary[]> {
  return repo.listGoals({ statuses: ['active', 'paused'] });
}

export async function getGoal(id: string): Promise<Goal | null> {
  return repo.getGoal(id);
}

export async function createGoal(input: GoalCreateInput): Promise<Goal> {
  return repo.insertGoal({
    title: requireTitle(input.title),
    description: input.description ? sanitiseText(input.description) : null,
    category: input.category ?? null,
    colorIndex: input.colorIndex ?? 0,
    targetDate: optionalDate(input.targetDate, 'targetDate'),
  });
}

export async function updateGoal(id: string, input: GoalUpdateInput): Promise<Goal | null> {
  const patch: Parameters<typeof repo.updateGoal>[1] = {};

  if (input.title !== undefined) patch.title = requireTitle(input.title);
  if (input.description !== undefined) {
    patch.description = input.description ? sanitiseText(input.description) : null;
  }
  if (input.category !== undefined) patch.category = input.category;
  if (input.colorIndex !== undefined) patch.colorIndex = input.colorIndex;
  if (input.targetDate !== undefined) patch.targetDate = optionalDate(input.targetDate, 'targetDate');

  if (input.progressPct !== undefined) {
    // Only honoured when there is nothing to derive from. Otherwise progress_pct is a
    // cache of the milestone calculation and a manual value would be overwritten
    // moments later, which would be a lie to the user.
    const milestones = await repo.listMilestones(id);
    if (milestones.length > 0) {
      throw new ValidationError({ progressPct: 'Progress is calculated from your milestones' });
    }
    const error = validatePositiveInt(input.progressPct, { min: 0, max: 100 });
    if (error) throw new ValidationError({ progressPct: error });
    patch.progressPct = input.progressPct;
  }

  return repo.updateGoal(id, patch);
}

/**
 * Changes a goal's status, refusing illegal transitions.
 *
 * Completion and archival timestamps are stamped here so they are recorded once and
 * never re-derived from a value that could change.
 */
export async function setGoalStatus(id: string, next: GoalStatus): Promise<Goal | null> {
  const goal = await repo.getGoal(id);
  if (!goal) throw new ValidationError({ id: 'That goal no longer exists' });

  assertGoalTransition(goal.status, next);

  const now = Date.now();
  const patch: Parameters<typeof repo.updateGoal>[1] = { status: next };

  if (next === 'completed') {
    patch.completedAt = goal.completedAt ?? now;
    patch.progressPct = 100;
  }
  if (next === 'archived') patch.archivedAt = now;
  if (goal.status === 'archived' && next !== 'archived') patch.archivedAt = null;
  // Reopening a finished goal must not leave a stale completion date behind.
  if (goal.status === 'completed' && next !== 'completed') patch.completedAt = null;

  return repo.updateGoal(id, patch);
}

export async function deleteGoal(id: string): Promise<void> {
  await repo.softDeleteGoal(id);
}

/* ------------------------------------------------------------ milestones */

export async function listMilestones(goalId: string): Promise<Milestone[]> {
  return repo.listMilestones(goalId);
}

export async function createMilestone(input: MilestoneCreateInput): Promise<Milestone> {
  const goal = await repo.getGoal(input.goalId);
  if (!goal) throw new ValidationError({ goalId: 'That goal no longer exists' });

  return repo.insertMilestone({
    goalId: input.goalId,
    title: requireTitle(input.title),
    dueDate: optionalDate(input.dueDate, 'dueDate'),
  });
}

export async function setMilestoneStatus(id: string, next: MilestoneStatus): Promise<Milestone | null> {
  const current = await repo.getMilestone(id);
  if (!current) throw new ValidationError({ id: 'That milestone no longer exists' });

  assertMilestoneTransition(current.status, next);

  return repo.updateMilestone(id, {
    status: next,
    completedAt: next === 'completed' ? (current.completedAt ?? Date.now()) : null,
  });
}

export async function deleteMilestone(id: string): Promise<void> {
  await repo.softDeleteMilestone(id);
}
/* ----------------------------------------------------------------- tasks */

export async function listTasks(filter: Parameters<typeof repo.listTasks>[0]): Promise<Task[]> {
  return repo.listTasks(filter);
}

export async function getTask(id: string): Promise<Task | null> {
  return repo.getTask(id);
}

export async function createTask(input: TaskCreateInput): Promise<Task> {
  const title = requireTitle(input.title);

  // A task must not reference a milestone belonging to a different goal, or the detail
  // screen would silently file it under the wrong parent.
  if (input.milestoneId && input.goalId) {
    const milestones = await repo.listMilestones(input.goalId);
    if (!milestones.some((m) => m.id === input.milestoneId)) {
      throw new ValidationError({ milestoneId: 'That milestone belongs to a different goal' });
    }
  }

  return repo.insertTask({
    title,
    notes: input.notes ? sanitiseText(input.notes) : null,
    goalId: input.goalId ?? null,
    milestoneId: input.milestoneId ?? null,
    priority: input.priority ?? 'medium',
    plannedDate: optionalDate(input.plannedDate, 'plannedDate'),
    dueDate: optionalDate(input.dueDate, 'dueDate'),
    estimateMin: optionalEstimate(input.estimateMin),
  });
}

export async function updateTask(id: string, input: TaskUpdateInput): Promise<Task | null> {
  const patch: Parameters<typeof repo.updateTask>[1] = {};

  if (input.title !== undefined) patch.title = requireTitle(input.title);
  if (input.notes !== undefined) patch.notes = input.notes ? sanitiseText(input.notes) : null;
  if (input.goalId !== undefined) patch.goalId = input.goalId;
  if (input.milestoneId !== undefined) patch.milestoneId = input.milestoneId;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.plannedDate !== undefined) patch.plannedDate = optionalDate(input.plannedDate, 'plannedDate');
  if (input.dueDate !== undefined) patch.dueDate = optionalDate(input.dueDate, 'dueDate');
  if (input.estimateMin !== undefined) patch.estimateMin = optionalEstimate(input.estimateMin);
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;

  return repo.updateTask(id, patch);
}

/** Marks a task done or reopens it, stamping or clearing the completion time. */
export async function setTaskStatus(id: string, next: TaskStatus): Promise<Task | null> {
  const task = await repo.getTask(id);
  if (!task) throw new ValidationError({ id: 'That task no longer exists' });

  assertTaskTransition(task.status, next);

  return repo.updateTask(id, {
    status: next,
    // The schema forbids a done task without a completion time, so the two are always
    // written together.
    completedAt: next === 'done' ? (task.completedAt ?? Date.now()) : null,
  });
}

/** Completes a task if it is open, reopens it if it is done. */
export async function toggleTask(id: string): Promise<{ completed: boolean }> {
  const task = await repo.getTask(id);
  if (!task) throw new ValidationError({ id: 'That task no longer exists' });

  if (task.status === 'done') {
    await setTaskStatus(id, 'todo');
    return { completed: false };
  }
  // An archived task re-enters the flow at 'todo', which is always a legal target.
  await setTaskStatus(id, 'done');
  return { completed: true };
}

export async function deleteTask(id: string): Promise<void> {
  await repo.softDeleteTask(id);
}

/** Tasks planned for a day, plus anything still open from an earlier day. */
export async function tasksForDay(date: DateKey = todayKey()): Promise<Task[]> {
  try {
    const open: TaskStatus[] = ['todo', 'in_progress'];
    const planned = await repo.listTasks({ plannedDate: date, statuses: open });
    const overdue = await repo.listTasks({ plannedDate: date, overdueOnly: true, statuses: open });
    const seen = new Set(planned.map((t) => t.id));
    return [...planned, ...overdue.filter((t) => !seen.has(t.id))];
  } catch (error) {
    logger.error('Failed to load tasks for day', error);
    throw error;
  }
}

