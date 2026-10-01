/**
 * Achievement catalogue.
 *
 * `FEATURES/ACHIEVEMENTS.md` asks for "optional milestones such as first habit, streaks,
 * workouts, books and reading time", with "unlocked state and unlock date", and requires
 * that users can **disable gamification**.
 *
 * Two decisions follow from that spec:
 *
 * 1. Achievements are **data**, not schema, so they are seeded at runtime like the
 *    exercise and sport catalogues (ADR-0015) rather than baked into a shipped migration.
 *    Adding an achievement is a code change, never an upgrade.
 * 2. Every achievement is defined by a `metric` + integer `threshold`, and progress is
 *    always **derived from historical records** (ARCHITECTURE.md: "Historical events are
 *    the source of truth"). Nothing here stores a counter that could drift from the logs
 *    it claims to summarise.
 *
 * `metric` is a closed union on purpose: an evaluator that accepted an arbitrary string
 * would silently report 0 progress for a typo, which looks like "no achievement" rather
 * than like a bug.
 */

/**
 * The quantities an achievement can be measured in.
 *
 * Every one of these is derivable from stored records. Adding a metric here means adding
 * both its SQL and its evaluator branch — there is no generic fallback.
 */
export const ACHIEVEMENT_METRICS = [
  'habit_logs',
  'habit_longest_streak',
  'goals_created',
  'goals_completed',
  'tasks_completed',
  'workouts',
  'sport_sessions',
  'mobility_sessions',
  'books_added',
  'books_finished',
  'reading_minutes',
  'focus_sessions',
  'focus_minutes',
  'journal_entries',
  'water_days',
  'sleep_nights',
  'recovery_days',
  'finance_transactions',
  'distinct_days_logged',
] as const;

export type AchievementMetric = (typeof ACHIEVEMENT_METRICS)[number];

export type AchievementCategory =
  | 'habits'
  | 'goals'
  | 'fitness'
  | 'books'
  | 'focus'
  | 'journal'
  | 'health'
  | 'finance'
  | 'milestone';

export interface AchievementDefinition {
  /** Stable, human-readable code. Persisted, so it must never change once shipped. */
  code: string;
  title: string;
  description: string;
  category: AchievementCategory;
  metric: AchievementMetric;
  /** Progress at or above which the achievement unlocks. Always a positive integer. */
  threshold: number;
  /**
   * Hidden until unlocked.
   *
   * A secret achievement shows as "???" rather than spoiling its own existence in the
   * list. It is still fully functional; only its title and description are withheld.
   */
  isSecret?: boolean;
}

/**
 * The built-in catalogue.
 *
 * Ordered from easiest to hardest within each category, so a newly seeded database
 * lists them in a sensible progression.
 */
export const ACHIEVEMENT_CATALOGUE: readonly AchievementDefinition[] = [
  /* habits */
  { code: 'first_habit', title: 'First habit', description: 'Create your first habit.', category: 'habits', metric: 'habit_logs', threshold: 1 },
  { code: 'habit_50', title: 'Fifty reps', description: 'Log 50 habit check-ins.', category: 'habits', metric: 'habit_logs', threshold: 50 },
  { code: 'habit_365', title: 'A full year', description: 'Log 365 habit check-ins.', category: 'habits', metric: 'habit_logs', threshold: 365 },
  { code: 'streak_7', title: 'One week strong', description: 'Reach a 7-day habit streak.', category: 'habits', metric: 'habit_longest_streak', threshold: 7 },
  { code: 'streak_30', title: 'One month strong', description: 'Reach a 30-day habit streak.', category: 'habits', metric: 'habit_longest_streak', threshold: 30 },
  { code: 'streak_100', title: 'Century streak', description: 'Reach a 100-day habit streak.', category: 'habits', metric: 'habit_longest_streak', threshold: 100 },

  /* goals */
  { code: 'first_goal', title: 'A direction', description: 'Create your first goal.', category: 'goals', metric: 'goals_created', threshold: 1 },
  { code: 'goal_complete', title: 'Finished', description: 'Complete a goal.', category: 'goals', metric: 'goals_completed', threshold: 1 },
  { code: 'goals_5', title: 'Five finished', description: 'Complete 5 goals.', category: 'goals', metric: 'goals_completed', threshold: 5 },
  { code: 'tasks_100', title: 'Century of tasks', description: 'Complete 100 tasks.', category: 'goals', metric: 'tasks_completed', threshold: 100 },

  /* fitness */
  { code: 'first_workout', title: 'First workout', description: 'Log your first workout.', category: 'fitness', metric: 'workouts', threshold: 1 },
  { code: 'workouts_25', title: 'Quarter century', description: 'Log 25 workouts.', category: 'fitness', metric: 'workouts', threshold: 25 },
  { code: 'workouts_100', title: 'Century of workouts', description: 'Log 100 workouts.', category: 'fitness', metric: 'workouts', threshold: 100 },
  { code: 'first_sport', title: 'Out and about', description: 'Log your first sport session.', category: 'fitness', metric: 'sport_sessions', threshold: 1 },
  { code: 'sport_sessions_50', title: 'Regular athlete', description: 'Log 50 sport sessions.', category: 'fitness', metric: 'sport_sessions', threshold: 50 },
  { code: 'first_mobility', title: 'Moved', description: 'Log your first mobility session.', category: 'fitness', metric: 'mobility_sessions', threshold: 1 },
  { code: 'mobility_50', title: 'Staying loose', description: 'Log 50 mobility sessions.', category: 'fitness', metric: 'mobility_sessions', threshold: 50 },

  /* books */
  { code: 'first_book', title: 'First book', description: 'Add a book to your library.', category: 'books', metric: 'books_added', threshold: 1 },
  { code: 'books_10', title: 'Shelf built', description: 'Add 10 books to your library.', category: 'books', metric: 'books_added', threshold: 10 },
  { code: 'first_finish', title: 'Finished it', description: 'Finish a book.', category: 'books', metric: 'books_finished', threshold: 1 },
  { code: 'finish_10', title: 'Ten books', description: 'Finish 10 books.', category: 'books', metric: 'books_finished', threshold: 10 },
  { code: 'reading_10h', title: 'Ten hours in', description: 'Read for 600 minutes in total.', category: 'books', metric: 'reading_minutes', threshold: 600 },
  { code: 'reading_100h', title: 'A hundred hours', description: 'Read for 6000 minutes in total.', category: 'books', metric: 'reading_minutes', threshold: 6000 },

  /* focus */
  { code: 'first_focus', title: 'Deep work', description: 'Complete your first focus session.', category: 'focus', metric: 'focus_sessions', threshold: 1 },
  { code: 'focus_25', title: 'Twenty-five deep', description: 'Complete 25 focus sessions.', category: 'focus', metric: 'focus_sessions', threshold: 25 },
  { code: 'focus_10h', title: 'Ten focused hours', description: 'Accumulate 600 minutes of focused work.', category: 'focus', metric: 'focus_minutes', threshold: 600 },

  /* journal */
  { code: 'first_entry', title: 'Dear diary', description: 'Write your first journal entry.', category: 'journal', metric: 'journal_entries', threshold: 1 },
  { code: 'journal_50', title: 'Fifty pages', description: 'Write 50 journal entries.', category: 'journal', metric: 'journal_entries', threshold: 50 },
  { code: 'journal_365', title: 'A year of pages', description: 'Write 365 journal entries.', category: 'journal', metric: 'journal_entries', threshold: 365, isSecret: true },

  /* health */
  { code: 'water_7', title: 'Well watered', description: 'Log water on 7 separate days.', category: 'health', metric: 'water_days', threshold: 7 },
  { code: 'sleep_7', title: 'Rested', description: 'Log sleep on 7 separate nights.', category: 'health', metric: 'sleep_nights', threshold: 7 },
  { code: 'recovery_7', title: 'Tuned in', description: 'Rate your recovery on 7 separate days.', category: 'health', metric: 'recovery_days', threshold: 7 },

  /* finance */
  { code: 'first_transaction', title: 'On the books', description: 'Record your first transaction.', category: 'finance', metric: 'finance_transactions', threshold: 1 },
  { code: 'transactions_100', title: 'A hundred entries', description: 'Record 100 transactions.', category: 'finance', metric: 'finance_transactions', threshold: 100 },

  /* milestones */
  { code: 'days_30', title: 'A month of showing up', description: 'Record something on 30 separate days.', category: 'milestone', metric: 'distinct_days_logged', threshold: 30 },
  { code: 'days_100', title: 'A hundred days', description: 'Record something on 100 separate days.', category: 'milestone', metric: 'distinct_days_logged', threshold: 100 },
  { code: 'days_365', title: 'A year with yourself', description: 'Record something on 365 separate days.', category: 'milestone', metric: 'distinct_days_logged', threshold: 365 },
];

const BY_CODE = new Map(ACHIEVEMENT_CATALOGUE.map((entry) => [entry.code, entry]));

export function findAchievement(code: string): AchievementDefinition | undefined {
  return BY_CODE.get(code);
}

/** Categories in display order, so the achievements screen can group without sorting. */
export const ACHIEVEMENT_CATEGORY_ORDER: readonly AchievementCategory[] = [
  'milestone',
  'habits',
  'goals',
  'fitness',
  'books',
  'focus',
  'journal',
  'health',
  'finance',
];

export const ACHIEVEMENT_CATEGORY_LABELS: Record<AchievementCategory, string> = {
  habits: 'Habits',
  goals: 'Goals',
  fitness: 'Fitness',
  books: 'Reading',
  focus: 'Focus',
  journal: 'Journal',
  health: 'Health',
  finance: 'Finance',
  milestone: 'Milestones',
};

/** What a metric is measured in, for "3 of 10" style progress text. */
export const ACHIEVEMENT_METRIC_LABELS: Record<AchievementMetric, string> = {
  habit_logs: 'check-ins',
  habit_longest_streak: 'days',
  goals_created: 'goals',
  goals_completed: 'goals',
  tasks_completed: 'tasks',
  workouts: 'workouts',
  sport_sessions: 'sessions',
  mobility_sessions: 'sessions',
  books_added: 'books',
  books_finished: 'books',
  reading_minutes: 'minutes',
  focus_sessions: 'sessions',
  focus_minutes: 'minutes',
  journal_entries: 'entries',
  water_days: 'days',
  sleep_nights: 'nights',
  recovery_days: 'days',
  finance_transactions: 'transactions',
  distinct_days_logged: 'days',
};

/**
 * Subjects a personal record can be about.
 *
 * Deliberately distinct from {@link AchievementMetric}: a metric is a *quantity* ("how
 * many workouts"), a subject is a *thing* ("fitness"). `personal_records` is keyed on the
 * subject, which is why it must not be typed as a metric.
 */
export const PERSONAL_RECORD_SUBJECTS = [
  'habits',
  'fitness',
  'mobility',
  'reading',
  'focus',
  'journal',
  'finance',
  'health',
] as const;

export type PersonalRecordSubject = (typeof PERSONAL_RECORD_SUBJECTS)[number];

/**
 * Every metric that accumulates over time, for which a personal record is worth keeping.
 *
 * `minimum` is the value below which a "best" is meaningless — nobody wants a personal
 * record of reading 1 minute.
 */
export const PERSONAL_RECORD_METRICS: readonly {
  metric: AchievementMetric;
  unit: string;
  minimum: number;
  scope: 'user';
  subject: PersonalRecordSubject;
}[] = [
  { metric: 'habit_longest_streak', unit: 'days', minimum: 2, scope: 'user', subject: 'habits' },
  { metric: 'workouts', unit: 'workouts', minimum: 2, scope: 'user', subject: 'fitness' },
  { metric: 'sport_sessions', unit: 'sessions', minimum: 2, scope: 'user', subject: 'fitness' },
  { metric: 'mobility_sessions', unit: 'sessions', minimum: 2, scope: 'user', subject: 'mobility' },
  { metric: 'books_finished', unit: 'books', minimum: 1, scope: 'user', subject: 'reading' },
  { metric: 'reading_minutes', unit: 'minutes', minimum: 30, scope: 'user', subject: 'reading' },
  { metric: 'focus_sessions', unit: 'sessions', minimum: 2, scope: 'user', subject: 'focus' },
  { metric: 'focus_minutes', unit: 'minutes', minimum: 25, scope: 'user', subject: 'focus' },
  { metric: 'journal_entries', unit: 'entries', minimum: 2, scope: 'user', subject: 'journal' },
  { metric: 'finance_transactions', unit: 'transactions', minimum: 2, scope: 'user', subject: 'finance' },
];
