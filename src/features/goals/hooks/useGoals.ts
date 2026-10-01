/**
 * Goals and tasks feature hooks.
 *
 * Screens use these and nothing below.
 */

import { useCallback } from 'react';

import { CHANNELS } from '@/database/database';
import { useAction, useAsyncResource } from '@/hooks/useAsyncResource';
import * as service from '@/services/goalsService';
import { todayKey, type DateKey } from '@/utils/dates';
import type {
  Goal,
  GoalCreateInput,
  GoalStatus,
  GoalSummary,
  GoalUpdateInput,
  Milestone,
  Task,
  TaskCreateInput,
  TaskStatus,
  TaskUpdateInput,
} from '@/types/goals';

export interface GoalDetailData {
  goal: Goal;
  milestones: Milestone[];
  tasks: Task[];
}

export function useGoals(includeArchived = false) {
  const load = useCallback(
    () => service.listGoals(includeArchived),
    [includeArchived],
  );
  return useAsyncResource<GoalSummary[]>(load, CHANNELS.goals);
}

export function useGoalDetail(goalId: string) {
  const load = useCallback(async (): Promise<GoalDetailData | null> => {
    if (!goalId) return null;
    const goal = await service.getGoal(goalId);
    if (!goal) return null;
    const [milestones, tasks] = await Promise.all([
      service.listMilestones(goalId),
      service.listTasks({ goalId }),
    ]);
    return { goal, milestones, tasks };
  }, [goalId]);

  return useAsyncResource(load, CHANNELS.goals, { enabled: goalId !== '' });
}

/** Tasks planned for a day plus anything overdue. */
export function useTasksForDay(date: DateKey = todayKey()) {
  const load = useCallback(() => service.tasksForDay(date), [date]);
  return useAsyncResource<Task[]>(load, CHANNELS.tasks, { deps: [date] });
}

export function useToggleTask() {
  return useAction((id: string) => service.toggleTask(id));
}

export function useCreateGoal() {
  return useAction((input: GoalCreateInput) => service.createGoal(input));
}

export function useUpdateGoal() {
  return useAction((id: string, input: GoalUpdateInput) => service.updateGoal(id, input));
}

export function useSetGoalStatus() {
  return useAction((id: string, status: GoalStatus) => service.setGoalStatus(id, status));
}

export function useDeleteGoal() {
  return useAction((id: string) => service.deleteGoal(id));
}

export function useCreateMilestone() {
  return useAction((goalId: string, title: string) =>
    service.createMilestone({ goalId, title }),
  );
}

export function useSetMilestoneStatus() {
  return useAction((id: string, status: Milestone['status']) =>
    service.setMilestoneStatus(id, status),
  );
}

export function useCreateTask() {
  return useAction((input: TaskCreateInput) => service.createTask(input));
}

export function useUpdateTask() {
  return useAction((id: string, input: TaskUpdateInput) => service.updateTask(id, input));
}

export function useSetTaskStatus() {
  return useAction((id: string, status: TaskStatus) => service.setTaskStatus(id, status));
}

export function useDeleteTask() {
  return useAction((id: string) => service.deleteTask(id));
}
