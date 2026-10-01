/**
 * Habits feature hooks.
 *
 * Screens use these and nothing below. That is what keeps UI free of database and
 * business logic, per the architecture contract.
 */

import { useCallback, useMemo } from 'react';

import { CHANNELS } from '@/database/database';
import { useAction, useAsyncResource } from '@/hooks/useAsyncResource';
import * as service from '@/services/habitsService';
import { addDays, todayKey, type DateKey } from '@/utils/dates';
import { getHabit, getLogsBetween } from '@/repositories/habitsRepository';
import type { Habit, HabitLog, HabitStats } from '@/types/habits';

export interface HabitDetail {
  habit: Habit;
  logs: HabitLog[];
  stats: HabitStats;
}

/** One habit, its recent history and its derived statistics. */
export function useHabitDetail(habitId: string) {
  const load = useCallback(async (): Promise<HabitDetail | null> => {
    if (!habitId) return null;
    const habit = await getHabit(habitId);
    if (!habit) return null;

    const to = todayKey();
    const from = addDays(to, -29);
    const [logs, stats] = await Promise.all([
      getLogsBetween(habitId, from, to),
      service.getStats(habit),
    ]);

    return { habit, logs, stats };
  }, [habitId]);

  return useAsyncResource(load, CHANNELS.habits, { enabled: habitId !== '' });
}

/** Corrects history for a specific past day. */
export function useSetCompletionForDate() {
  return useAction((habitId: string, date: DateKey, completed: boolean) =>
    service.setCompletion(habitId, date, completed),
  );
}


/** Habits scheduled for a given day, with that day's completion state. */
export function useHabitsForDate(date: DateKey = todayKey()) {
  const load = useCallback(() => service.listHabitsForDate(date), [date]);
  const resource = useAsyncResource(load, CHANNELS.habits, { deps: [date] });

  const toggle = useAction(async (habitId: string) => service.toggleCompletion(habitId, date));

  const completedCount = useMemo(
    () => resource.data?.filter((h) => h.completedToday).length ?? 0,
    [resource.data],
  );

  return {
    ...resource,
    date,
    completedCount,
    totalCount: resource.data?.length ?? 0,
    toggle,
  };
}

/** Every habit, including archived, for the management screen. */
export function useAllHabits(includeArchived = false) {
  const load = useCallback(async () => {
    const { listHabits } = await import('@/repositories/habitsRepository');
    return listHabits(includeArchived);
  }, [includeArchived]);

  return useAsyncResource(load, CHANNELS.habits);
}

export function useCreateHabit() {
  return useAction((input: Parameters<typeof service.createHabit>[0]) => service.createHabit(input));
}

export function useUpdateHabit() {
  return useAction((id: string, input: Parameters<typeof service.updateHabit>[1]) =>
    service.updateHabit(id, input),
  );
}

export function useArchiveHabit() {
  return useAction((id: string) => service.archiveHabit(id));
}

export function useRestoreHabit() {
  return useAction((id: string) => service.restoreHabit(id));
}

export function useDeleteHabit() {
  return useAction((id: string) => service.deleteHabit(id));
}

/** Statistics for one habit. Cheap enough to recompute per visit. */
export function useHabitStats(habit: Habit | null, now?: Date) {
  const load = useCallback(async (): Promise<HabitStats | null> => {
    if (!habit) return null;
    return service.getStats(habit, now);
  }, [habit, now]);

  return useAsyncResource(load, CHANNELS.habits, { enabled: habit !== null });
}
