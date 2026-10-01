/**
 * Analytics feature hooks.
 *
 * An analytics report is a derived read, so there is no write path here at all. The
 * subscription channel is `today` because every metric is derived from records that
 * already announce their own writes — subscribing to a channel that nothing notifies
 * would leave the screen stale forever.
 */

import { CHANNELS } from '@/database/database';
import { useAsyncResource } from '@/hooks/useAsyncResource';
import * as service from '@/services/analyticsService';
import type { PeriodType } from '@/analytics/periods';
import type { DateKey } from '@/utils/dates';

/** Every metric for the period containing `anchor`. */
export function useAnalyticsReport(anchor: DateKey, type: PeriodType = 'month') {
  return useAsyncResource(() => service.reportFor(anchor, type), CHANNELS.today, {
    deps: [anchor, type],
  });
}

/** Side-by-side totals against the previous period. */
export function useAnalyticsComparison(anchor: DateKey, type: PeriodType = 'month') {
  return useAsyncResource(() => service.comparePeriods(anchor, type), CHANNELS.today, {
    deps: [anchor, type],
  });
}

/** The primary metrics first, in the order the service declares. */
export function primaryMetrics(report: service.AnalyticsReport): service.Metric[] {
  return service.PRIMARY_METRIC_KEYS.map((key) => report.metrics[key]).filter(
    (metric): metric is service.Metric => metric !== undefined,
  );
}

/** `March`, `Week of 9 March`, `2026`. */
export function describePeriod(period: service.AnalyticsReport['period']): string {
  switch (period.type) {
    case 'day':
      return period.from;
    case 'week':
      return `Week of ${period.from}`;
    case 'month': {
      const [year, month] = period.from.split('-').map(Number);
      const date = new Date(year ?? 1970, (month ?? 1) - 1, 1);
      return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }
    default:
      return period.key;
  }
}

export { PERIOD_LABELS, PERIOD_TYPES } from '@/analytics/periods';
export { formatMetric, formatMinutes, PRIMARY_METRIC_KEYS } from '@/services/analyticsService';
export type { Metric, AnalyticsReport, Period, PeriodType, Trend } from '@/services/analyticsService';