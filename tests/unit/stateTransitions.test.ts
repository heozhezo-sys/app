/**
 * Status transition rules.
 *
 * The specification says "Do not allow invalid state transitions", so this file
 * enumerates every state pair rather than sampling a few. A newly added status will
 * fail these tests until its transitions are defined, which is the point.
 */

import {
  GOAL_TRANSITIONS,
  MILESTONE_TRANSITIONS,
  TASK_TRANSITIONS,
  InvalidTransitionError,
  assertGoalTransition,
  assertMilestoneTransition,
  assertTaskTransition,
  canTransitionGoal,
  canTransitionMilestone,
  canTransitionTask,
  isGoalOpen,
  GOAL_CLOSED_STATUSES,
} from '@/services/stateTransitions';
import type { GoalStatus, MilestoneStatus, TaskStatus } from '@/types/goals';

const GOAL_STATES: GoalStatus[] = ['active', 'paused', 'completed', 'cancelled', 'archived'];
const MILESTONE_STATES: MilestoneStatus[] = ['pending', 'in_progress', 'completed', 'skipped'];
const TASK_STATES: TaskStatus[] = ['todo', 'in_progress', 'done', 'archived'];

describe('transition tables are exhaustive and self-consistent', () => {
  it('every goal status appears in the table', () => {
    expect(Object.keys(GOAL_TRANSITIONS).sort()).toEqual([...GOAL_STATES].sort());
    for (const from of GOAL_STATES) {
      for (const to of GOAL_TRANSITIONS[from]) {
        expect(GOAL_STATES).toContain(to);
      }
    }
  });

  it('every milestone status appears in the table', () => {
    expect(Object.keys(MILESTONE_TRANSITIONS).sort()).toEqual([...MILESTONE_STATES].sort());
    for (const from of MILESTONE_STATES) {
      for (const to of MILESTONE_TRANSITIONS[from]) {
        expect(MILESTONE_STATES).toContain(to);
      }
    }
  });

  it('every task status appears in the table', () => {
    expect(Object.keys(TASK_TRANSITIONS).sort()).toEqual([...TASK_STATES].sort());
    for (const from of TASK_STATES) {
      for (const to of TASK_TRANSITIONS[from]) {
        expect(TASK_STATES).toContain(to);
      }
    }
  });

  it('no table lists a state as transitioning to itself', () => {
    for (const [from, targets] of Object.entries(GOAL_TRANSITIONS)) {
      expect(targets).not.toContain(from);
    }
  });
});

describe('goal transitions', () => {
  it('permits the documented moves', () => {
    expect(canTransitionGoal('active', 'paused')).toBe(true);
    expect(canTransitionGoal('active', 'completed')).toBe(true);
    expect(canTransitionGoal('active', 'cancelled')).toBe(true);
    expect(canTransitionGoal('paused', 'active')).toBe(true);
    expect(canTransitionGoal('archived', 'active')).toBe(true);
    expect(canTransitionGoal('completed', 'archived')).toBe(true);
  });

  it('refuses to silently reopen a completed or cancelled goal', () => {
    // The user must go through `archived`; otherwise the record of having finished or
    // given up would quietly disappear.
    expect(canTransitionGoal('completed', 'active')).toBe(false);
    expect(canTransitionGoal('cancelled', 'active')).toBe(false);
    expect(canTransitionGoal('cancelled', 'completed')).toBe(false);
  });

  it('refuses to complete a paused or cancelled goal in one step', () => {
    expect(canTransitionGoal('paused', 'completed')).toBe(false);
    expect(canTransitionGoal('cancelled', 'completed')).toBe(false);
  });

  it('treats an unchanged status as legal', () => {
    for (const status of GOAL_STATES) {
      expect(canTransitionGoal(status, status)).toBe(true);
      expect(() => assertGoalTransition(status, status)).not.toThrow();
    }
  });

  it('rejects every undeclared pair', () => {
    for (const from of GOAL_STATES) {
      for (const to of GOAL_STATES) {
        const legal = from === to || GOAL_TRANSITIONS[from].includes(to);
        expect(canTransitionGoal(from, to)).toBe(legal);
      }
    }
  });

  it('throws a message naming the allowed targets', () => {
    expect(() => assertGoalTransition('completed', 'active')).toThrow(InvalidTransitionError);
    try {
      assertGoalTransition('completed', 'active');
    } catch (error) {
      const failure = error as InvalidTransitionError;
      expect(failure.entity).toBe('goal');
      expect(failure.from).toBe('completed');
      expect(failure.to).toBe('active');
      expect(failure.allowed).toEqual(['archived']);
      expect(failure.message).toContain('archived');
    }
  });

  it('classifies open and closed goals', () => {
    expect(isGoalOpen('active')).toBe(true);
    expect(isGoalOpen('paused')).toBe(true);
    expect(isGoalOpen('archived')).toBe(false);
    expect(GOAL_CLOSED_STATUSES).toEqual(['completed', 'cancelled']);
  });
});
describe('milestone transitions', () => {
  it('allows completing straight from pending', () => {
    expect(canTransitionMilestone('pending', 'completed')).toBe(true);
  });

  it('allows changing your mind about a skip', () => {
    expect(canTransitionMilestone('skipped', 'pending')).toBe(true);
    expect(canTransitionMilestone('completed', 'pending')).toBe(true);
  });

  it('rejects every undeclared pair', () => {
    for (const from of MILESTONE_STATES) {
      for (const to of MILESTONE_STATES) {
        const legal = from === to || MILESTONE_TRANSITIONS[from].includes(to);
        expect(canTransitionMilestone(from, to)).toBe(legal);
      }
    }
  });

  it('throws on an illegal move', () => {
    expect(() => assertMilestoneTransition('pending', 'nonsense' as MilestoneStatus)).toThrow();
  });
});

describe('task transitions', () => {
  it('allows reopening a finished task', () => {
    expect(canTransitionTask('done', 'todo')).toBe(true);
    expect(canTransitionTask('done', 'in_progress')).toBe(true);
  });

  it('only lets an archived task return to the top of the flow', () => {
    expect(canTransitionTask('archived', 'todo')).toBe(true);
    expect(canTransitionTask('archived', 'done')).toBe(false);
    expect(canTransitionTask('archived', 'in_progress')).toBe(false);
  });

  it('rejects every undeclared pair', () => {
    for (const from of TASK_STATES) {
      for (const to of TASK_STATES) {
        const legal = from === to || TASK_TRANSITIONS[from].includes(to);
        expect(canTransitionTask(from, to)).toBe(legal);
      }
    }
  });

  it('throws on an illegal move', () => {
    expect(() => assertTaskTransition('archived', 'done')).toThrow(InvalidTransitionError);
  });
});
