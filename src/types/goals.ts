/**
 * Domain types for goals, milestones and tasks.
 *
 * The chain is Goal -> Milestone -> Task, as documented in `FEATURES/GOALS.md`.
 * A task may belong to a goal, to a milestone, or to neither (a standalone to-do).
 */

export type GoalStatus = 'active' | 'paused' | 'completed' | 'cancelled' | 'archived';

export type MilestoneStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'archived';

export type TaskPriority = 'low' | 'medium' | 'high';

export type GoalCategory =
  | 'fitness'
  | 'health'
  | 'education'
  | 'career'
  | 'finance'
  | 'relationships'
  | 'personal'
  | 'reading'
  | 'productivity';

export const GOAL_CATEGORIES: readonly GoalCategory[] = [
  'fitness',
  'health',
  'education',
  'career',
  'finance',
  'relationships',
  'personal',
  'reading',
  'productivity',
];

export const TASK_PRIORITIES: readonly TaskPriority[] = ['low', 'medium', 'high'];

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  category: GoalCategory | null;
  colorIndex: number;
  status: GoalStatus;
  /** 0-100. Derived from milestones when any exist, otherwise set by the user. */
  progressPct: number;
  /** Local calendar day, `YYYY-MM-DD`. */
  targetDate: string | null;
  startedAt: number;
  completedAt: number | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Milestone {
  id: string;
  goalId: string;
  title: string;
  status: MilestoneStatus;
  dueDate: string | null;
  completedAt: number | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  goalId: string | null;
  milestoneId: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  /** Local calendar day the user intends to do this. */
  plannedDate: string | null;
  dueDate: string | null;
  completedAt: number | null;
  estimateMin: number | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** A goal plus the counts a list row needs, computed in one query. */
export interface GoalSummary extends Goal {
  totalMilestones: number;
  completedMilestones: number;
  totalTasks: number;
  completedTasks: number;
}

export interface GoalCreateInput {
  title: string;
  description?: string | null;
  category?: GoalCategory | null;
  colorIndex?: number;
  targetDate?: string | null;
}

export interface GoalUpdateInput {
  title?: string;
  description?: string | null;
  category?: GoalCategory | null;
  colorIndex?: number;
  targetDate?: string | null;
  /** Only honoured when the goal has no milestones; otherwise progress is derived. */
  progressPct?: number;
}

export interface MilestoneCreateInput {
  goalId: string;
  title: string;
  dueDate?: string | null;
}

export interface TaskCreateInput {
  title: string;
  notes?: string | null;
  goalId?: string | null;
  milestoneId?: string | null;
  priority?: TaskPriority;
  plannedDate?: string | null;
  dueDate?: string | null;
  estimateMin?: number | null;
}

export interface TaskUpdateInput {
  title?: string;
  notes?: string | null;
  goalId?: string | null;
  milestoneId?: string | null;
  priority?: TaskPriority;
  plannedDate?: string | null;
  dueDate?: string | null;
  estimateMin?: number | null;
  sortOrder?: number;
}
