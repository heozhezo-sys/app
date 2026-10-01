import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, Section, StateView } from '@/components/Layout';
import { useSetCompletionForDate, useHabitDetail } from '@/features/habits/hooks/useHabits';
import { addDays, dateRange, formatDate, todayKey } from '@/utils/dates';
import type { HabitLog } from '@/types/habits';

/**
 * Habit detail: history and derived statistics.
 *
 * Every number shown here is computed from the log rows, so correcting or removing a
 * past entry immediately corrects the statistics rather than leaving a stale total.
 */
export default function HabitDetailScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ id?: string }>();
  const habitId = typeof params.id === 'string' ? params.id : '';

  const detail = useHabitDetail(habitId);
  const setCompletion = useSetCompletionForDate();

  const today = todayKey();
  const window14 = dateRange(addDays(today, -13), today);
  const habit = detail.data?.habit ?? null;
  const byDate = new Map<string, HabitLog>();
  for (const log of detail.data?.logs ?? []) byDate.set(log.logDate, log);

  if (detail.status === 'loading') {
    return (
      <Screen>
        <StateView state="loading" loadingLabel="Loading habit" />
      </Screen>
    );
  }

  if (detail.status === 'error' || !habit) {
    return (
      <Screen>
        <StateView
          state="error"
          title="Habit not available"
          errorMessage={detail.error?.message ?? 'This habit may have been deleted.'}
          onRetry={() => void detail.refresh()}
        />
      </Screen>
    );
  }

  const stats = detail.data?.stats ?? null;

  return (
    <Screen>
      <AppText variant="title" accessibilityRole="header">
        {habit.title}
      </AppText>
      {habit.description ? (
        <>
          <Spacer size="xs" />
          <AppText tone="muted">{habit.description}</AppText>
        </>
      ) : null}

      <Spacer size="lg" />

      <Card>
        <View style={styles.statRow}>
          <Stat label="Current streak" value={String(stats?.currentStreak ?? 0)} />
          <Stat label="Longest" value={String(stats?.longestStreak ?? 0)} />
          <Stat label="Total" value={String(stats?.totalCompletions ?? 0)} />
        </View>
        <Spacer size="md" />
        <AppText variant="caption" tone="muted">
          {stats
            ? `${stats.completedLast30Days} of ${stats.scheduledLast30Days} scheduled days done in the last 30`
            : 'Computing your history'}
        </AppText>
      </Card>

      <Spacer size="lg" />

      <Section title="Last 14 days">
        <Card>
          <View style={styles.weekRow}>
            {window14.map((date) => {
              const done = byDate.has(date);
              return (
                <Button
                  key={date}
                  label={done ? '✓' : '·'}
                  size="compact"
                  variant={done ? 'primary' : 'secondary'
                  }
                  onPress={() => void setCompletion.run(habit.id, date, !done)}
                  accessibilityLabel={`${formatDate(date)}: ${done ? 'done' : 'not done'}`}
                  accessibilityHint={done ? 'Double tap to remove this entry.' : 'Double tap to mark done.'}
                  testID={`day-${date}`}
                />
              );
            })}
          </View>
          <Spacer size="sm" />
          <AppText variant="micro" tone="faint">
            Tap a day to correct its history.
          </AppText>
        </Card>
      </Section>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <AppText variant="title" numeric>
        {value}
      </AppText>
      <AppText variant="micro" tone="muted" align="center">
        {label}
      </AppText>
    </View>
  );
}

const styles = {
  statRow: { flexDirection: 'row', alignItems: 'flex-start' } as const,
  weekRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 } as const,
};
