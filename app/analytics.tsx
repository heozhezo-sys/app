/**
 * Analytics.
 *
 * `FEATURES/ANALYTICS.md` asks for trends over time. Every figure here is derived on read
 * from the records themselves — there is no rollup table — so deleting a workout changes
 * last month's number too, which is the behaviour a user expects even if it costs a query.
 *
 * The wording rule for this screen is strict: the summaries describe what happened and
 * never imply whether it was good. `analyticsService` writes them and this screen only
 * chooses which ones to show.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, Section, StateView } from '@/components/Layout';
import {
  PERIOD_LABELS,
  PERIOD_TYPES,
  describePeriod,
  formatMetric,
  primaryMetrics,
  useAnalyticsComparison,
  useAnalyticsReport,
} from '@/features/analytics/hooks/useAnalytics';
import type { Metric, PeriodType, Trend } from '@/features/analytics/hooks/useAnalytics';
import { useToday } from '@/features/finance/hooks/useFinance';
import { addDays } from '@/utils/dates';
import { useTheme } from '@/theme/ThemeProvider';
import { seriesColor } from '@/theme/colors';

/**
 * A trend as a word, never as a judgement.
 *
 * "Up 12%" says what changed. "Improved 12%" would be the app grading the user, which is
 * exactly the tone `FEATURES/ANALYTICS.md` rules out.
 */
function trendText(trend: Trend | null): { label: string; tone: 'muted' | 'accent' | 'faint' } {
  if (!trend || trend.delta === 0) return { label: 'unchanged', tone: 'faint' };
  // A jump from nothing has no percentage. Saying "up 100%" would imply it doubled.
  if (trend.percentChange === null) {
    return trend.delta > 0
      ? { label: 'first recorded', tone: 'accent' }
      : { label: 'last recorded', tone: 'muted' };
  }
  const percent = `${Math.abs(trend.percentChange)}%`;
  return trend.delta > 0
    ? { label: `up ${percent}`, tone: 'accent' }
    : { label: `down ${percent}`, tone: 'muted' };
}

/** A plain bar sparkline. Decorative, and hidden from assistive tech. */
function Sparkline({ series, tint }: { series: Metric['series']; tint: string }): React.ReactElement {
  const values = series.map((point) => point.value ?? 0);
  const peak = Math.max(...values, 1);

  return (
    <View
      style={styles.sparkline}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {series.map((point) => (
        <View
          key={point.date}
          style={{
            flex: 1,
            minWidth: 2,
            height: `${Math.max(3, ((point.value ?? 0) / peak) * 100)}%`,
            borderRadius: 1,
            // A day with no record is a gap, not a zero, so it is drawn faintly.
            backgroundColor: point.value === null ? 'transparent' : tint,
            opacity: point.value === null ? 0.25 : 1,
          }}
        />
      ))}
    </View>
  );
}

export default function AnalyticsScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const today = useToday();

  const [periodType, setPeriodType] = useState<PeriodType>('month');
  const [offset, setOffset] = useState(0);

  // Stepping by period, not by day: paging a month view a day at a time would take 31
  // taps to see last month.
  const anchor = useMemo(() => addDays(today, offset * stepDays(periodType)), [offset, periodType, today]);

  const report = useAnalyticsReport(anchor, periodType);
  const comparison = useAnalyticsComparison(anchor, periodType);

  const step = useCallback(
    (direction: -1 | 1) => setOffset((current) => current + direction),
    [],
  );

  const data = report.data;
  const primaries = data ? primaryMetrics(data) : [];

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.xl,
        }}
      >
        <AppText variant="display" accessibilityRole="header">
          Analytics
        </AppText>
        <Spacer size="xs" />
        <AppText variant="caption" tone="muted">
          {data ? describePeriod(data.period) : 'Loading…'} ·{' '}
          {data
            ? `${data.activeDays} of ${data.period.days} days with something recorded`
            : ''}
        </AppText>

        <Spacer size="md" />

        <View style={styles.wrapRow}>
          {PERIOD_TYPES.map((option) => (
            <View key={option} style={styles.chip}>
              <Button
                label={PERIOD_LABELS[option]}
                onPress={() => {
                  setPeriodType(option);
                  setOffset(0);
                }}
                variant={periodType === option ? 'primary' : 'secondary'}
                size="compact"
                selected={periodType === option}
                testID={`analytics-period-${option}`}
              />
            </View>
          ))}
        </View>

        <Spacer size="sm" />
        <View style={styles.pager}>
          <Button
            label="Earlier"
            onPress={() => step(-1)}
            variant="ghost"
            size="compact"
            accessibilityHint="Show the previous period"
            testID="analytics-earlier"
          />
          <Button
            label="Later"
            onPress={() => step(1)}
            variant="ghost"
            size="compact"
            disabled={offset >= 0}
            accessibilityHint="Show the next period"
            testID="analytics-later"
          />
        </View>

        <Spacer size="md" />

        {report.status === 'loading' || !data ? (
          <StateView state="loading" loadingLabel="Crunching your records" />
        ) : primaries.length === 0 ? (
          <StateView
            state="empty"
            emptyTitle="Nothing to add up yet"
            emptyBody="Log a habit, a workout, some sleep or a few pages of reading and this fills in."
          />
        ) : (
          <>
            {primaries.map((metric, index) => {
              const trend = trendText(metric.trend);
              return (
                <Card key={metric.key} style={{ marginBottom: theme.spacing.md }}>
                  <View style={styles.metricHeader}>
                    <View style={styles.grow}>
                      <AppText variant="caption" tone="muted">
                        {metric.label}
                      </AppText>
                      <AppText variant="title">{formatMetric(metric)}</AppText>
                    </View>
                    <AppText variant="caption" tone={trend.tone}>
                      {trend.label}
                    </AppText>
                  </View>
                  <Sparkline series={metric.series} tint={seriesColor(index)} />
                  <Spacer size="xs" />
                  <AppText variant="caption" tone="faint">
                    {metric.summary}
                  </AppText>
                </Card>
              );
            })}

            {comparison.data ? (
              <Section title="Against the period before">
                <Card flush>
                  {comparison.data.metrics.map((entry, index) => (
                    <View key={entry.key}>
                      {index > 0 && <View style={styles.divider} />}
                      <View style={styles.comparisonRow}>
                        <AppText variant="body" style={styles.grow} numberOfLines={1}>
                          {entry.label}
                        </AppText>
                        <AppText variant="caption" tone="muted">
                          {entry.current}
                        </AppText>
                        <AppText variant="caption" tone="faint">
                          was {entry.previous}
                        </AppText>
                      </View>
                    </View>
                  ))}
                </Card>
              </Section>
            ) : null}

            <Section title="Everything else">
              <Card flush>
                {Object.values(data.metrics)
                  .filter((metric) => !primaries.some((primary) => primary.key === metric.key))
                  .map((metric, index) => (
                    <View key={metric.key}>
                      {index > 0 && <View style={styles.divider} />}
                      <View style={styles.comparisonRow}>
                        <AppText variant="body" style={styles.grow} numberOfLines={1}>
                          {metric.label}
                        </AppText>
                        <AppText variant="body" weight="600">
                          {formatMetric(metric)}
                        </AppText>
                      </View>
                    </View>
                  ))}
              </Card>
            </Section>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/** How far one step moves the anchor for a given period. */
function stepDays(type: PeriodType): number {
  switch (type) {
    case 'day':
      return 1;
    case 'week':
      return 7;
    case 'month':
      return 30;
    case 'year':
      return 365;
    default:
      return 1;
  }
}

const styles = StyleSheet.create({
  metricHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  comparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sparkline: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 32,
    marginTop: 12,
    gap: 2,
  },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { marginRight: 8, marginBottom: 8 },
  pager: { flexDirection: 'row', justifyContent: 'space-between' },
  grow: { flex: 1 },
  divider: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.2,
    marginHorizontal: 16,
  },
});
