/**
 * Achievements use cases.
 *
 * Responsibilities, in order:
 *  1. ensure the catalogue is present in the database (seeded at runtime, ADR-0015);
 *  2. derive every metric from historical records (never from stored counters);
 *  3. unlock whatever has newly reached its threshold, idempotently;
 *  4. maintain personal records.
 *
 * **Gamification can be turned off.** `FEATURES/ACHIEVEMENTS.md` requires "Allow users to
 * disable gamification". When disabled, evaluation still runs and personal records are
 * still maintained — only the *celebration* and the badges are withheld. Hiding the
 * screen must not stop the data being derived, because a user who re-enables it later
 * should find their real progress rather than a blank slate.
 */

import * as repository from '@/repositories/achievementsRepository';
import type { AchievementRow, PersonalRecord } from '@/repositories/achievementsRepository';
import { getDatabase } from '@/database/database';
import { logger } from '@/utils/logger';
import {
  ACHIEVEMENT_CATALOGUE,
  ACHIEVEMENT_CATEGORY_LABELS,
  ACHIEVEMENT_CATEGORY_ORDER,
  ACHIEVEMENT_METRIC_LABELS,
  PERSONAL_RECORD_METRICS,
  findAchievement,
  type AchievementCategory,
  type AchievementMetric,
} from '@/achievements/catalogue';
import {
  computeMetrics,
  isUnlocked,
  progressPercent,
  type MetricSnapshot,
} from '@/achievements/evaluator';

/** Injectable clock, so unlock dates are deterministic in tests. */
export type Clock = () => number;

let clock: Clock = () => Date.now();

export function setClock(next: Clock): void {
  clock = next;
}

export function resetClock(): void {
  clock = () => Date.now();
}

export interface AchievementView {
  id: string;
  code: string;
  category: AchievementCategory;
  metric: AchievementMetric;
  threshold: number;
  /** Current derived value of the metric. */
  current: number;
  /** 0-100, rounded down. */
  percent: number;
  unlocked: boolean;
  unlockedAt: number | null;
  /** Metric value when it unlocked, or null while locked. */
  progressAtUnlock: number | null;
  /** Suppressed title/description for a secret achievement that is still locked. */
  isSecret: boolean;
  /** What to actually render, honouring secrecy. */
  title: string;
  description: string | null;
  /** "3 of 10 check-ins", for assistive tech and for the row's secondary line. */
  progressLabel: string;
}

export interface AchievementGroup {
  category: AchievementCategory;
  label: string;
  items: AchievementView[];
}

export interface AchievementsOverview {
  groups: AchievementGroup[];
  unlockedCount: number;
  totalCount: number;
  /** Percentage of all achievements unlocked, 0-100. */
  percent: number;
  /** True when the user has switched gamification off. */
  disabled: boolean;
  /** Metric snapshot behind the current numbers, for debugging and analytics. */
  metrics: MetricSnapshot;
  records: PersonalRecord[];
}

/**
 * Ensures catalogue rows exist. Called on launch and before any evaluation.
 *
 * Idempotent, so this is safe on every start. Returns how many rows were new, which the
 * launch log uses to avoid printing on every cold start.
 */
export async function ensureCatalogue(): Promise<number> {
  const { driver } = await getDatabase();
  return repository.syncAchievementCatalogue(driver, ACHIEVEMENT_CATALOGUE);
}

/**
 * Evaluates progress and unlocks anything newly earned.
 *
 * Returns the achievements unlocked *by this call*. Running it twice returns an empty
 * array the second time, because the UNIQUE index on `achievement_unlocks` makes a repeat
 * insert a no-op — the idempotency is enforced by the database, not by a read-then-write
 * check that could race.
 */
export async function evaluate(options: { announce?: boolean } = {}): Promise<AchievementView[]> {
  const { driver } = await getDatabase();
  const now = clock();

  // The catalogue must exist before anything can be evaluated. Without this, a fresh
  // install would unlock nothing until the user happened to open the achievements
  // screen — progress is driven by writes, not by visits.
  await ensureCatalogue();

  const metrics = await computeMetrics(driver);
  const catalogue = await repository.listAchievements();
  const existingUnlocks = await repository.listUnlocks();
  const unlockedAtByAchievement = new Map(
    existingUnlocks.map((unlock) => [unlock.achievementId, unlock]),
  );

  const newlyUnlocked: AchievementView[] = [];

  for (const achievement of catalogue) {
    if (unlockedAtByAchievement.has(achievement.id)) continue;

    const current = metrics[achievement.metric];
    if (!isUnlocked(current, achievement.threshold)) continue;

    const written = await repository.insertUnlock({
      achievementId: achievement.id,
      unlockedAt: now,
      progressAtUnlock: current,
    });

    if (!written) continue;

    const view = toView({
      achievement,
      current,
      unlock: { unlockedAt: now, progressAtUnlock: current },
    });
    newlyUnlocked.push(view);

    if (options.announce !== false) {
      // Never log the title of a secret achievement; it would spoil itself in logcat.
      logger.info(
        view.isSecret ? 'Achievement unlocked (secret)' : `Achievement unlocked: ${view.title}`,
      );
    }
  }

  await refreshPersonalRecords(metrics, now);

  return newlyUnlocked;
}

/**
 * Updates personal records from a metric snapshot.
 *
 * Each `recordBest` call keeps the maximum ever seen, so this is safe to run on every
 * evaluation and returns the improvements that actually happened (used to tell the user
 * about a new record without a duplicate announcement).
 */
async function refreshPersonalRecords(
  metrics: MetricSnapshot,
  now: number,
): Promise<number> {
  let improvements = 0;

  for (const definition of PERSONAL_RECORD_METRICS) {
    const value = metrics[definition.metric];
    // Below the floor there is nothing worth calling a "best".
    if (value < definition.minimum) continue;

    const improved = await repository.recordBest({
      scope: definition.scope,
      subjectId: null,
      metric: definition.subject,
      value,
      unit: definition.unit,
      achievedAt: now,
    });
    if (improved) improvements += 1;
  }

  return improvements;
}

function toView(input: {
  achievement: AchievementRow;
  current: number;
  unlock: { unlockedAt: number; progressAtUnlock: number } | null;
}): AchievementView {
  const { achievement, current, unlock } = input;
  const definition = findAchievement(achievement.code);
  const category = definition?.category ?? 'milestone';

  // A secret achievement stays hidden until it is earned. Its progress is still tracked,
  // so re-enabling visibility later does not leak or lose anything.
  const hidden = achievement.isSecret && unlock === null;

  const unit = ACHIEVEMENT_METRIC_LABELS[achievement.metric];

  return {
    id: achievement.id,
    code: achievement.code,
    category,
    metric: achievement.metric,
    threshold: achievement.threshold,
    current,
    percent: progressPercent(current, achievement.threshold),
    unlocked: unlock !== null,
    unlockedAt: unlock?.unlockedAt ?? null,
    progressAtUnlock: unlock?.progressAtUnlock ?? null,
    isSecret: achievement.isSecret,
    title: hidden ? '???' : achievement.title,
    description: hidden ? null : achievement.description,
    progressLabel:
      unlock !== null
        ? `Unlocked`
        : `${current} of ${achievement.threshold} ${unit}`,
  };
}

/**
 * The full achievements view, grouped for display.
 *
 * Evaluation runs first so the numbers on screen are never stale relative to an unlock
 * that was earned a moment ago.
 */
export async function overview(disabled = false): Promise<AchievementsOverview> {
  await ensureCatalogue();
  await evaluate({ announce: false });

  const catalogue = await repository.listAchievements();
  const unlocks = await repository.listUnlocks();
  const records = await repository.listPersonalRecords();
  const { driver } = await getDatabase();
  const metrics = await computeMetrics(driver);

  const unlockByAchievement = new Map(unlocks.map((u) => [u.achievementId, u]));

  const views = catalogue.map((achievement) =>
    toView({
      achievement,
      current: metrics[achievement.metric],
      unlock: unlockByAchievement.get(achievement.id) ?? null,
    }),
  );

  // Group by category in the catalogue's declared order, so the screen never has to
  // invent a sort and the order is stable across platforms.
  const groups: AchievementGroup[] = [];
  for (const category of ACHIEVEMENT_CATEGORY_ORDER) {
    const items = views
      .filter((view) => view.category === category)
      .sort((a, b) => {
        // Unlocked first, then nearest to completion, then by threshold.
        if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
        if (b.percent !== a.percent) return b.percent - a.percent;
        return a.threshold - b.threshold;
      });
    if (items.length > 0) {
      groups.push({ category, label: ACHIEVEMENT_CATEGORY_LABELS[category], items });
    }
  }

  const unlockedCount = views.filter((view) => view.unlocked).length;
  const totalCount = views.length;

  return {
    groups,
    unlockedCount,
    totalCount,
    percent: progressPercent(unlockedCount, totalCount),
    disabled,
    metrics,
    records,
  };
}

/** Recent unlocks, newest first, for a strip on the Today dashboard. */
export async function recentUnlocks(limit = 5): Promise<AchievementView[]> {
  const catalogue = await repository.listAchievements();
  const unlocks = await repository.listUnlocks();
  const { driver } = await getDatabase();
  const metrics = await computeMetrics(driver);

  const byId = new Map(catalogue.map((a) => [a.id, a]));

  return unlocks
    .sort((a, b) => b.unlockedAt - a.unlockedAt)
    .slice(0, Math.max(1, Math.trunc(limit)))
    .flatMap((unlock) => {
      const achievement = byId.get(unlock.achievementId);
      if (!achievement) return [];
      return [
        toView({
          achievement,
          current: metrics[achievement.metric],
          unlock: { unlockedAt: unlock.unlockedAt, progressAtUnlock: unlock.progressAtUnlock },
        }),
      ];
    });
}

/** How close the user is to their next unlock, or null when everything is earned. */
export async function nextGoal(): Promise<AchievementView | null> {
  const catalogue = await repository.listAchievements();
  const unlocks = await repository.listUnlocks();
  const { driver } = await getDatabase();
  const metrics = await computeMetrics(driver);
  const unlockedIds = new Set(unlocks.map((u) => u.achievementId));

  const pending = catalogue
    .filter((achievement) => !unlockedIds.has(achievement.id))
    .map((achievement) =>
      toView({ achievement, current: metrics[achievement.metric], unlock: null }),
    )
    .filter((view) => view.current > 0)
    .sort((a, b) => b.percent - a.percent || a.threshold - b.threshold);

  return pending[0] ?? null;
}

export { ACHIEVEMENT_CATEGORY_LABELS, ACHIEVEMENT_CATEGORY_ORDER, computeMetrics };
export type { AchievementCategory, AchievementMetric };
