/** Domain types for habits. Storage representation lives in the repository. */

export type HabitCadence = 'daily' | 'weekly' | 'specific_days';

export type HabitStatus = 'active' | 'archived';

export type HabitLogSource = 'manual' | 'quick_action' | 'import' | 'restored';

export interface Habit {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  /** Index into the theme's series palette. Not a raw colour. */
  colorIndex: number;
  cadence: HabitCadence;
  /** For `specific_days`: which weekdays, 0 = Sunday. */
  cadenceDays: number[];
  /** Target completions per period. Always >= 1. */
  targetPerPeriod: number;
  reminderTime: string | null;
  sortOrder: number;
  status: HabitStatus;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface HabitLog {
  id: string;
  habitId: string;
  /** Local calendar day, `YYYY-MM-DD`. */
  logDate: string;
  countValue: number;
  note: string | null;
  source: HabitLogSource;
  createdAt: number;
  updatedAt: number;
}

/** A habit decorated with today's derived state, for list rendering. */
export interface HabitWithTodayState extends Habit {
  completedToday: boolean;
  /** Completions so far in the current period (today / this week). */
  completedThisPeriod: number;
  /** Whether this habit is scheduled to be done on the given day. */
  scheduledForDate: string;
}

export interface HabitCreateInput {
  title: string;
  description?: string | null;
  icon?: string | null;
  colorIndex?: number;
  cadence?: HabitCadence;
  cadenceDays?: number[];
  targetPerPeriod?: number;
  reminderTime?: string | null;
}

export interface HabitUpdateInput {
  title?: string;
  description?: string | null;
  icon?: string | null;
  colorIndex?: number;
  cadence?: HabitCadence;
  cadenceDays?: number[];
  targetPerPeriod?: number;
  reminderTime?: string | null;
  sortOrder?: number;
}

export interface HabitStats {
  /** Consecutive scheduled days completed, counting back from today. */
  currentStreak: number;
  longestStreak: number;
  /** Completions in the trailing 30 days. */
  completedLast30Days: number;
  /** Compliant scheduled days in the trailing 30 days. */
  scheduledLast30Days: number;
  totalCompletions: number;
}
