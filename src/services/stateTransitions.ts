/**
 * Goal, milestone and task state machines.
 *
 * The specification requires: "Do not allow invalid state transitions."
 *
 * This module is deliberately pure — no database, no React, no I/O — so the rules can
 * be exhaustively tested. `goalsService` is the only caller that writes these values;
 * anything else asking for an illegal transition gets a clear rejection instead of a
 * corrupted record.
 *
 * The design rule behind the tables below: a status that represents *finished work*
 * (`completed`, `cancelled`) is only reversible through `archived`. Silently reopening
 * a cancelled goal would erase the fact that it was cancelled.
 */

import type { GoalStatus, MilestoneStatus, TaskStatus } from '@/types/goals';

/** Which status changes are legal from each starting state. */
export const GOAL_TRANSITIONS: Readonly<Record<GoalStatus, readonly GoalStatus[]>> = {
  active: ['paused', 'completed', 'cancelled', 'archived'],
  // A paused goal can resume, be cancelled, or be shelved.
  paused: ['active', 'cancelled', 'archived'],
  // Terminal: only archiving (and un-archiving) is left.
  completed: ['archived'],
  cancelled: ['archived'],
  // Archiving is reversible so a goal can be brought back into the active list.
  archived: ['active', 'paused', 'completed', 'cancelled'],
};

export const MILESTONE_TRANSITIONS: Readonly<Record<MilestoneStatus, readonly MilestoneStatus[]>> = {
  pending: ['in_progress', 'completed', 'skipped'],
  in_progress: ['pending', 'completed', 'skipped'],
  completed: ['pending', 'in_progress'],
  // Skipping is reversible: a user may change their mind about a milestone.
  skipped: ['pending', 'in_progress'],
};

export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  todo: ['in_progress', 'done', 'archived'],
  in_progress: ['todo', 'done', 'archived'],
  // Reopening a completed task is allowed — plans change.
  done: ['todo', 'in_progress', 'archived'],
  archived: ['todo'],
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly entity: 'goal' | 'milestone' | 'task',
    readonly from: string,
    readonly to: string,
    readonly allowed: readonly string[],
  ) {
    super(
      `A ${entity} cannot go from "${from}" to "${to}". ` +
        `Allowed from "${from}": ${allowed.length > 0 ? allowed.join(', ') : 'nothing'}.`,
    );
    this.name = 'InvalidTransitionError';
  }
}

function assertTransition<S extends string>(
  entity: 'goal' | 'milestone' | 'task',
  table: Readonly<Record<S, readonly S[]>>,
  from: S,
  to: S,
): void {
  if (from === to) return;
  const allowed = table[from] ?? [];
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(entity, from, to, allowed);
  }
}

export function canTransitionGoal(from: GoalStatus, to: GoalStatus): boolean {
  return from === to || (GOAL_TRANSITIONS[from] ?? []).includes(to);
}

export function canTransitionMilestone(from: MilestoneStatus, to: MilestoneStatus): boolean {
  return from === to || (MILESTONE_TRANSITIONS[from] ?? []).includes(to);
}

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || (TASK_TRANSITIONS[from] ?? []).includes(to);
}

export function assertGoalTransition(from: GoalStatus, to: GoalStatus): void {
  assertTransition('goal', GOAL_TRANSITIONS, from, to);
}

export function assertMilestoneTransition(from: MilestoneStatus, to: MilestoneStatus): void {
  assertTransition('milestone', MILESTONE_TRANSITIONS, from, to);
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  assertTransition('task', TASK_TRANSITIONS, from, to);
}

/** Statuses that represent work the user has finished with, for filtered lists. */
export const GOAL_CLOSED_STATUSES: readonly GoalStatus[] = ['completed', 'cancelled'];

export function isGoalOpen(status: GoalStatus): boolean {
  return status === 'active' || status === 'paused';
}
