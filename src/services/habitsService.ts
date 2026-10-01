/**
 * Habit use-cases.
 *
 * Services own business rules. They validate input, call repositories, and shape
 * errors into something a screen can present. Screens never call repositories
 * directly for a write.
 */

import * as repo from '@/repositories/habitsRepository';
import { logger } from '@/utils/logger';
import { ValidationError } from './errors';
import { validateTime, validateTitle, sanitiseText, type FieldErrors } from '@/utils/validation';
import { todayKey, startOfWeek, addDays, type DateKey } from '@/utils/dates';
import type {
  Habit,
  HabitCreateInput,
  HabitStats,
  HabitUpdateInput,
  HabitWithTodayState,
} from '@/types/habits';

export { ValidationError };

export interface HabitFormValues {
  title: string;
  description: string;
  cadenceDays: number[];
  targetPerPeriod: string;
  reminderTime: string;
  colorIndex: number;
}

export function emptyHabitForm(): HabitFormValues {
  return {
    title: '',
    description: '',
    cadenceDays: [],
    targetPerPeriod: '1',
    reminderTime: '',
    colorIndex: 0,
  };
}

export function validateHabitForm(
  values: HabitFormValues,
): FieldErrors<keyof HabitFormValues> {
  const errors: FieldErrors<keyof HabitFormValues> = {};

  const titleError = validateTitle(values.title);
  if (titleError) errors.title = titleError;

  const target = Number(values.targetPerPeriod);
  if (values.targetPerPeriod.trim() !== '' && (!Number.isInteger(target) || target < 1)) {
    errors.targetPerPeriod = 'Whole number, 1 or more';
  }

  if (values.reminderTime.trim() !== '') {
    const timeError = validateTime(values.reminderTime.trim());
    if (timeError) errors.reminderTime = timeError;
  }

  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Next sort order, so a new habit lands at the end of the list. */
async function nextSortOrder(): Promise<number> {
  const habits = await repo.listHabits(true);
  return habits.reduce((max, h) => Math.max(max, h.sortOrder), -1) + 1;
}

export async function createHabit(input: HabitCreateInput): Promise<Habit> {
  const title = sanitiseText(input.title ?? '');
  const titleError = validateTitle(title);
  if (titleError) throw new ValidationError({ title: titleError });

  const target = input.targetPerPeriod ?? 1;
  if (!Number.isInteger(target) || target < 1) {
    throw new ValidationError({ targetPerPeriod: 'Whole number, 1 or more' });
  }

  if (input.reminderTime) {
    const timeError = validateTime(input.reminderTime);
    if (timeError) throw new ValidationError({ reminderTime: timeError });
  }

  const cadence = input.cadence ?? 'daily';
  const cadenceDays = input.cadenceDays ?? [];
  if (cadence === 'specific_days' && cadenceDays.length === 0) {
    throw new ValidationError({ cadenceDays: 'Pick at least one day' });
  }

  return repo.insertHabit({
    title,
    description: input.description ? sanitiseText(input.description) : null,
    icon: input.icon ?? null,
    colorIndex: input.colorIndex ?? 0,
    cadence,
    cadenceDays,
    targetPerPeriod: target,
    reminderTime: input.reminderTime ?? null,
    sortOrder: await nextSortOrder(),
  });
}

export async function updateHabit(id: string, input: HabitUpdateInput): Promise<Habit | null> {
  if (input.title !== undefined) {
    const titleError = validateTitle(input.title);
    if (titleError) throw new ValidationError({ title: titleError });
  }
  if (
    input.targetPerPeriod !== undefined &&
    (!Number.isInteger(input.targetPerPeriod) || input.targetPerPeriod < 1)
  ) {
    throw new ValidationError({ targetPerPeriod: 'Whole number, 1 or more' });
  }
  if (input.reminderTime) {
    const timeError = validateTime(input.reminderTime);
    if (timeError) throw new ValidationError({ reminderTime: timeError });
  }

  return repo.updateHabit(id, {
    ...input,
    ...(input.title !== undefined ? { title: sanitiseText(input.title) } : {}),
    ...(input.description !== undefined
      ? { description: input.description ? sanitiseText(input.description) : null }
      : {}),
  });
}

export async function archiveHabit(id: string): Promise<void> {
  await repo.setHabitArchived(id, true);
}

export async function restoreHabit(id: string): Promise<void> {
  await repo.setHabitArchived(id, false);
}

export async function deleteHabit(id: string): Promise<void> {
  await repo.softDeleteHabit(id);
}

/**
 * Toggles completion for a day.
 *
 * Returns the resulting state so the UI can announce the outcome without guessing,
 * and so a rapid double-tap settles on a predictable value.
 */
export async function toggleCompletion(
  habitId: string,
  date: DateKey = todayKey(),
): Promise<{ completed: boolean }> {
  const logs = await repo.getLogsBetween(habitId, date, date);
  if (logs.length > 0) {
    await repo.removeCompletion(habitId, date);
    return { completed: false };
  }
  await repo.logCompletion(habitId, date);
  return { completed: true };
}

export async function setCompletion(
  habitId: string,
  date: DateKey,
  completed: boolean,
): Promise<void> {
  if (completed) await repo.logCompletion(habitId, date);
  else await repo.removeCompletion(habitId, date);
}

/** Habits scheduled for a day, decorated with that day's completion state. */
export async function listHabitsForDate(
  date: DateKey = todayKey(),
): Promise<HabitWithTodayState[]> {
  const habits = await repo.listHabits();
  if (habits.length === 0) return [];

  const from = startOfWeek(date, 1);
  const to = addDays(from, 6);
  const logs = await repo.getLogsForRange(from, to);

  const byHabit = new Map<string, Set<string>>();
  for (const log of logs) {
    let set = byHabit.get(log.habitId);
    if (!set) {
      set = new Set();
      byHabit.set(log.habitId, set);
    }
    set.add(log.logDate);
  }

  return habits
    .filter((habit) => repo.isScheduledOn(habit, date))
    .map((habit) => {
      const dates = byHabit.get(habit.id) ?? new Set<string>();
      return {
        ...habit,
        completedToday: dates.has(date),
        completedThisPeriod: dates.size,
        scheduledForDate: date,
      };
    });
}

export async function getStats(habit: Habit, now?: Date): Promise<HabitStats> {
  try {
    return await repo.computeHabitStats(habit, now);
  } catch (error) {
    logger.error(`Failed to compute stats for habit ${habit.id}`, error);
    throw error;
  }
}
