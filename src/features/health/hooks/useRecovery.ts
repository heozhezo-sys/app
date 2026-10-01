/**
 * Recovery feature hooks.
 *
 * Recovery is two things that share a screen: a set of daily 1-10 personal ratings, and
 * mobility sessions. Neither is a measurement and neither is interpreted — see
 * `src/services/recoveryService.ts` for why that rule is enforced at the service.
 */

import { CHANNELS } from '@/database/database';
import { useAction, useAsyncResource } from '@/hooks/useAsyncResource';
import * as service from '@/services/recoveryService';

/** One day's ratings, or `null` when nothing has been rated. */
export function useRecoveryDay(logDate?: string) {
  return useAsyncResource(() => service.recoveryForDay(logDate), CHANNELS.health, {
    deps: [logDate],
  });
}

/** Averages, trends and mobility totals over a trailing window. */
export function useRecoveryReport(logDate: string, days = 14) {
  return useAsyncResource(() => service.recoveryReport(logDate, days), CHANNELS.health, {
    deps: [logDate, days],
  });
}

/** Records or updates a whole day. Omitted ratings are cleared, not preserved. */
export function useRateDay() {
  return useAction((input: Parameters<typeof service.rateDay>[0]) => service.rateDay(input));
}

/** The 1-10 slider/stepper path: changes one rating and leaves the rest alone. */
export function useRateOne() {
  return useAction(
    (rating: Parameters<typeof service.rateOne>[0], value: number, logDate?: string) =>
      service.rateOne(rating, value, logDate),
  );
}

export function useRemoveRecoveryDay() {
  return useAction((id: string) => service.removeRecoveryDay(id));
}

export function useLogMobility() {
  return useAction((input: Parameters<typeof service.logMobility>[0]) =>
    service.logMobility(input),
  );
}

export function useRemoveMobility() {
  return useAction((id: string) => service.removeMobility(id));
}

export type { RecoveryRating } from '@/health/recoveryMath';
export type { MobilityKind } from '@/health/mobilityMath';
export { MOBILITY_KINDS, MOBILITY_KIND_LABELS } from '@/health/mobilityMath';
export { RATING_HINTS, RATING_LABELS, RATING_MAX, RATING_MIN, RECOVERY_RATINGS } from '@/health/recoveryMath';