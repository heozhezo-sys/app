/**
 * Achievements feature hooks.
 *
 * Evaluation is a read of history, so the screen simply asks for the overview and the
 * service does the rest. The subscription channel is `achievements` because unlocks are
 * written into their own tables rather than as a side effect of a habit log.
 */

import { CHANNELS } from '@/database/database';
import { useAction, useAsyncResource } from '@/hooks/useAsyncResource';
import * as service from '@/services/achievementsService';

/**
 * Grouped achievements, personal records and the derived metrics behind them.
 *
 * `disabled` is the user's gamification preference. It suppresses celebration, not
 * evaluation, so switching it back on shows real progress rather than a blank slate.
 */
export function useAchievementsOverview(disabled = false) {
  return useAsyncResource(() => service.overview(disabled), CHANNELS.achievements, {
    deps: [disabled],
  });
}

/** Recent unlocks for the Today strip. */
export function useRecentUnlocks(limit = 5) {
  return useAsyncResource(() => service.recentUnlocks(limit), CHANNELS.achievements, {
    deps: [limit],
  });
}

/**
 * Re-runs evaluation.
 *
 * Called after a write that could earn something. Idempotent, so calling it more often
 * than necessary is harmless — which matters because it is called from more than one place.
 *
 * `announce` defaults to true. Pass false for a background pass, so a screen that is only
 * refreshing does not fire a celebration the user has not earned in this moment.
 */
export function useEvaluateAchievements() {
  return useAction((options?: { announce?: boolean }) => service.evaluate(options ?? {}));
}

export { ACHIEVEMENT_CATEGORY_LABELS } from '@/achievements/catalogue';
export type { AchievementView, AchievementsOverview } from '@/services/achievementsService';